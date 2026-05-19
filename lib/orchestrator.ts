/**
 * Orquestrador: máquina de estados do Kanban.
 * Passa GITHUB_TOKEN dentro da initial_message do agente para git auth direto.
 */
import { beta } from "@/lib/claude";
import { createServiceClient } from "@/lib/supabase/server";
import type { StageCode } from "@/lib/supabase/types";

const STAGE_TO_ROLE: Record<StageCode, string> = {
  discovery: "pm",
  planning: "tech_lead",
  development: "tech_lead",
  qa: "qa",
  done: "admin",
};

const NEXT_STAGE: Record<StageCode, StageCode> = {
  discovery: "planning",
  planning: "development",
  development: "qa",
  qa: "done",
  done: "done",
};

// Normaliza slug: tira acentos, lowercase, troca não-alfanum por hífen
function normalizeSlug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function ensureFeatureEnvironment(featureId: string) {
  const sb = createServiceClient();
  const { data: feature, error } = await sb
    .from("features")
    .select("*")
    .eq("id", featureId)
    .single();
  if (error || !feature) throw new Error(`feature ${featureId} not found`);

  if (!feature.claude_environment_id) {
    const env = await beta.environments.create({
      name: `env-${normalizeSlug(feature.slug)}`,
      config: {
        type: "cloud",
        networking: { type: "unrestricted" },
      },
    });
    await sb
      .from("features")
      .update({ claude_environment_id: env.id })
      .eq("id", featureId);
    feature.claude_environment_id = env.id;
  }

  return feature;
}

export async function startStage(
  cardId: string,
  initialMessage?: string
): Promise<string> {
  const sb = createServiceClient();

  const { data: card, error: cardErr } = await sb
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (cardErr || !card) throw new Error(`card ${cardId} not found`);

  const role = STAGE_TO_ROLE[card.stage as StageCode];
  const { data: agentRow, error: agentErr } = await sb
    .from("agents")
    .select("*")
    .eq("role", role)
    .eq("is_current", true)
    .single();
  if (agentErr || !agentRow) {
    throw new Error(
      `no current agent for role=${role}. Run /admin/setup first.`
    );
  }

  const feature = await ensureFeatureEnvironment(card.feature_id);

  const userMsg = initialMessage ?? defaultKickoff(card, feature);

  const session = await beta.sessions.create({
    agent: agentRow.claude_agent_id,
    environment_id: feature.claude_environment_id,
    title: `${feature.slug} · ${card.stage}`,
  });

  await beta.sessions.events.send(session.id, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text: userMsg }],
      },
    ],
  });

  await sb
    .from("cards")
    .update({
      claude_session_id: session.id,
      claude_agent_id: agentRow.id,
      status: "running",
    })
    .eq("id", cardId);

  return session.id;
}

export async function advanceCard(
  cardId: string,
  decision: "approved" | "rejected",
  reason?: string,
  decidedBy?: string
): Promise<void> {
  if (decision === "rejected" && !reason) {
    throw new Error("rejection requires a reason");
  }

  const sb = createServiceClient();

  const { data: card } = await sb
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error(`card ${cardId} not found`);
  if (card.status !== "awaiting_review") {
    throw new Error(`card is ${card.status}; cannot advance`);
  }

  await sb
    .from("human_gates")
    .update({
      decision,
      decision_reason: reason,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
    })
    .eq("card_id", cardId)
    .is("decision", null);

  if (decision === "rejected") {
    await sb.from("cards").update({ status: "rejected" }).eq("id", cardId);
    await startStage(
      cardId,
      `Your previous attempt was rejected by the human reviewer.\n\n` +
        `REASON:\n${reason}\n\n` +
        `Address this feedback specifically. Do not redo unrelated work.`
    );
    return;
  }

  await sb.from("cards").update({ status: "approved" }).eq("id", cardId);

  const nextStage = NEXT_STAGE[card.stage as StageCode];
  await sb
    .from("features")
    .update({ current_stage: nextStage })
    .eq("id", card.feature_id);

  if (nextStage === "done") {
    await sb.from("cards").update({ status: "done" }).eq("id", cardId);
    return;
  }

  const { data: newCard } = await sb
    .from("cards")
    .insert({
      feature_id: card.feature_id,
      stage: nextStage,
      status: "queued",
    })
    .select("id")
    .single();

  if (newCard) {
    await startStage(newCard.id);
  }
}

export async function createFeature(input: {
  slug: string;
  title: string;
  description: string;
  github_repo: string;
  github_parent_issue: number;
  created_by?: string;
}): Promise<{ feature_id: string; card_id: string }> {
  const sb = createServiceClient();

  // Normaliza o slug aqui, no ponto de entrada
  const normalizedSlug = normalizeSlug(input.slug);

  const { data: feature, error: fErr } = await sb
    .from("features")
    .insert({ ...input, slug: normalizedSlug })
    .select("id")
    .single();
  if (fErr || !feature) throw fErr ?? new Error("failed to create feature");

  const { data: card, error: cErr } = await sb
    .from("cards")
    .insert({
      feature_id: feature.id,
      stage: "discovery",
      status: "queued",
    })
    .select("id")
    .single();
  if (cErr || !card) throw cErr ?? new Error("failed to create card");

  await startStage(card.id);
  return { feature_id: feature.id, card_id: card.id };
}

function defaultKickoff(
  card: { stage: string },
  feature: {
    slug: string;
    title: string;
    description: string | null;
    github_repo: string;
    github_parent_issue: number | null;
  }
): string {
  const token = process.env.GITHUB_TOKEN ?? "(missing)";
  const [owner, repo] = feature.github_repo.split("/");

  const credBlock =
    `\n--- GitHub credentials ---\n` +
    `Repo: ${feature.github_repo}\n` +
    `Owner: ${owner}\n` +
    `Repo name: ${repo}\n` +
    `Token: ${token}\n` +
    `Clone URL: https://x-access-token:${token}@github.com/${feature.github_repo}.git\n` +
    `API auth header: Authorization: token ${token}\n` +
    `---\n`;

  const stage = card.stage;
  if (stage === "discovery") {
    return (
      `Build the spec for feature '${feature.title}' (slug: ${feature.slug}).\n\n` +
      `Initial description:\n${feature.description}\n` +
      credBlock +
      `\nWhen done, open the draft PR via the GitHub API and reply with the URL.`
    );
  }
  if (stage === "planning") {
    return (
      `The PM PR for feature '${feature.slug}' has been merged.\n` +
      `Read docs/features/${feature.slug}/prd.md and acceptance-criteria.md.\n` +
      `Produce the ADR and decompose into chunks (one sub-issue per chunk).\n` +
      `Parent issue: #${feature.github_parent_issue}.` +
      credBlock
    );
  }
  if (stage === "development") {
    return (
      `All chunks for feature '${feature.slug}' are planned.\n` +
      `List the chunks ready to start (no blocking dependencies) and the suggested order. ` +
      `I will dispatch Dev Agents one by one based on your recommendation.` +
      credBlock
    );
  }
  if (stage === "qa") {
    return (
      `All Dev PRs for feature '${feature.slug}' are merged into ` +
      `feat/${feature.slug}/integration.\n` +
      `Write the test suite, ensure CI is green, and report coverage.` +
      credBlock
    );
  }
  throw new Error(`no kickoff template for stage ${stage}`);
}
