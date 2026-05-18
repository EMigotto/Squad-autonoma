/**
 * Orquestrador: máquina de estados do Kanban.
 * Versão simplificada compatível com Managed Agents public beta.
 *
 * Removido nesta versão:
 * - memory_store (research preview)
 * - define_outcome (research preview)
 *
 * Cada session tem só o repo GitHub montado. Contexto entre etapas
 * passa pelo próprio repo (PRD/ADR/PRs em markdown) e pelos initial_messages.
 */
import { anthropic } from "@/lib/claude";
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

// ============================================================
// Ensure environment for the feature (created on first stage)
// ============================================================
async function ensureFeatureEnvironment(featureId: string) {
  const sb = createServiceClient();
  const { data: feature, error } = await sb
    .from("features")
    .select("*")
    .eq("id", featureId)
    .single();
  if (error || !feature) throw new Error(`feature ${featureId} not found`);

  if (!feature.claude_environment_id) {
    // @ts-expect-error beta API types ainda evoluindo
    const env = await anthropic.beta.environments.create({
      name: `env-${feature.slug}`,
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

// ============================================================
// start_stage: create a Claude session for this card
// ============================================================
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

  // @ts-expect-error beta API
  const session = await anthropic.beta.sessions.create({
    agent: agentRow.claude_agent_id,
    environment_id: feature.claude_environment_id,
    title: `${feature.slug} · ${card.stage}`,
  });

  // Manda a mensagem inicial via events.send
  // @ts-expect-error beta API
  await anthropic.beta.sessions.events.send(session.id, {
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

// ============================================================
// advance_card: apply human decision
// ============================================================
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

// ============================================================
// create_feature: kick off the whole pipeline
// ============================================================
export async function createFeature(input: {
  slug: string;
  title: string;
  description: string;
  github_repo: string;
  github_parent_issue: number;
  created_by?: string;
}): Promise<{ feature_id: string; card_id: string }> {
  const sb = createServiceClient();

  const { data: feature, error: fErr } = await sb
    .from("features")
    .insert(input)
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

// ============================================================
// Default kickoff messages by stage
// ============================================================
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
  const stage = card.stage;
  if (stage === "discovery") {
    return (
      `Build the spec for feature '${feature.title}' (slug: ${feature.slug}).\n\n` +
      `Initial description:\n${feature.description}\n\n` +
      `Repo: ${feature.github_repo}\n` +
      `When done, open the draft PR and reply with the URL.`
    );
  }
  if (stage === "planning") {
    return (
      `The PM PR for feature '${feature.slug}' has been merged.\n` +
      `Read docs/features/${feature.slug}/prd.md and acceptance-criteria.md.\n` +
      `Produce the ADR and decompose into chunks (one sub-issue per chunk).\n` +
      `Parent issue: #${feature.github_parent_issue}.`
    );
  }
  if (stage === "development") {
    return (
      `All chunks for feature '${feature.slug}' are planned.\n` +
      `List the chunks ready to start (no blocking dependencies) and the suggested order. ` +
      `I will dispatch Dev Agents one by one based on your recommendation.`
    );
  }
  if (stage === "qa") {
    return (
      `All Dev PRs for feature '${feature.slug}' are merged into ` +
      `feat/${feature.slug}/integration.\n` +
      `Write the test suite, ensure CI is green, and report coverage.`
    );
  }
  throw new Error(`no kickoff template for stage ${stage}`);
}
