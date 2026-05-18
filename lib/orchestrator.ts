/**
 * Orquestrador: máquina de estados do Kanban.
 * Roda no SERVER (Route Handlers, Server Actions). Usa service role do Supabase.
 */
import { anthropic } from "@/lib/claude";
import { OUTCOMES } from "@/lib/agents";
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

const OUTCOME_KEY: Record<string, keyof typeof OUTCOMES | null> = {
  "pm:discovery": "pm",
  "tech_lead:planning": "tech_lead_planning",
  "tech_lead:development": null,
  "qa:qa": "qa",
};

// ============================================================
// Ensure feature resources (memory store + environment)
// ============================================================
async function ensureFeatureResources(featureId: string) {
  const sb = createServiceClient();
  const { data: feature, error } = await sb
    .from("features")
    .select("*")
    .eq("id", featureId)
    .single();
  if (error || !feature) throw new Error(`feature ${featureId} not found`);

  const updates: Record<string, string> = {};

  if (!feature.claude_memory_store_id) {
    // @ts-expect-error beta API
    const store = await anthropic.beta.memoryStores.create({
      name: `feature-${feature.slug}`,
    });
    updates.claude_memory_store_id = store.id;
  }

  if (!feature.claude_environment_id) {
    // @ts-expect-error beta API
    const env = await anthropic.beta.environments.create({
      container: {
        type: "ubuntu",
        packages: ["nodejs", "python3", "git", "build-essential"],
      },
      network: {
        allowed_domains: [
          "github.com",
          "api.github.com",
          "raw.githubusercontent.com",
          "registry.npmjs.org",
          "pypi.org",
          "files.pythonhosted.org",
        ],
      },
    });
    updates.claude_environment_id = env.id;
  }

  if (Object.keys(updates).length > 0) {
    await sb.from("features").update(updates).eq("id", featureId);
    Object.assign(feature, updates);
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
      `no current agent for role=${role}. Run \`npm run setup-agents\`.`
    );
  }

  const feature = await ensureFeatureResources(card.feature_id);

  const userMsg = initialMessage ?? defaultKickoff(card, feature);

  const resources = [
    {
      type: "github_repository" as const,
      url: `https://github.com/${feature.github_repo}`,
      mount_path: "/workspace/repo",
      authorization_token: process.env.GITHUB_TOKEN!,
    },
    {
      type: "memory_store" as const,
      memory_store_id: feature.claude_memory_store_id,
    },
  ];

  // @ts-expect-error beta API
  const session = await anthropic.beta.sessions.create({
    agent: agentRow.claude_agent_id,
    environment_id: feature.claude_environment_id,
    resources,
    initial_message: userMsg,
  });

  // Attach Outcome rubric if this (role, stage) has one
  const outcomeKey = OUTCOME_KEY[`${role}:${card.stage}`];
  if (outcomeKey) {
    const rubric = OUTCOMES[outcomeKey];
    // @ts-expect-error beta API
    await anthropic.beta.sessions.defineOutcome({
      session_id: session.id,
      criteria: rubric.criteria,
      max_iterations: rubric.max_iterations,
    });
  }

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

  // Close open gate
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
    await sb
      .from("cards")
      .update({ status: "rejected" })
      .eq("id", cardId);

    await startStage(
      cardId,
      `Your previous attempt was rejected by the human reviewer.\n\n` +
        `REASON:\n${reason}\n\n` +
        `Address this feedback specifically. Do not redo unrelated work.`
    );
    return;
  }

  // Approved
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
  card: { stage: string; feature_id: string },
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
      `Spawn Dev subagents in parallel respecting the dependency graph.\n` +
      `Code Reviewer Agent reviews each PR before notifying me.`
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
