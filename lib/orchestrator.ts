/**
 * Orquestrador: um card por feature percorrendo as raias.
 * Agents carregados de agent_definitions (DB).
 * Histórico de execução em card_stage_runs.
 */
import { beta } from "@/lib/claude";
import { createServiceClient } from "@/lib/supabase/server";
import type { StageCode } from "@/lib/supabase/types";

const NEXT_STAGE: Record<StageCode, StageCode> = {
  discovery: "planning",
  planning: "development",
  development: "qa",
  qa: "done",
  done: "done",
};

function normalizeSlug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getAppSettings() {
  const sb = createServiceClient();
  const { data } = await sb
    .from("app_settings")
    .select("*")
    .eq("id", 1)
    .single();
  return (
    data ?? {
      auto_merge_prs: false,
      commit_to_existing_branch: false,
      auto_advance_after_pm: false,
      auto_advance_after_tl: false,
      default_base_branch: "main",
    }
  );
}

/**
 * Pega o agent que deve rodar para uma stage.
 * Pega o primeiro enabled por sort_order na agent_definitions, e o claude_agent_id
 * correspondente em agents.
 */
async function getAgentForStage(stage: string) {
  const sb = createServiceClient();
  const { data: def } = await sb
    .from("agent_definitions")
    .select("*")
    .eq("stage", stage)
    .eq("enabled", true)
    .order("sort_order", { ascending: true })
    .limit(1)
    .single();
  if (!def) throw new Error(`no enabled agent for stage ${stage}`);

  const { data: deployed } = await sb
    .from("agents")
    .select("*")
    .eq("role", def.role)
    .eq("is_current", true)
    .single();
  if (!deployed)
    throw new Error(`agent ${def.role} defined but not deployed; run /admin/setup`);

  return { def, deployed };
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
      config: { type: "cloud", networking: { type: "unrestricted" } },
    });
    await sb
      .from("features")
      .update({ claude_environment_id: env.id })
      .eq("id", featureId);
    feature.claude_environment_id = env.id;
  }

  return feature;
}

async function fetchAttachmentContents(featureId: string) {
  const sb = createServiceClient();
  const { data: attachments } = await sb
    .from("feature_attachments")
    .select("filename, storage_path")
    .eq("feature_id", featureId);

  if (!attachments || attachments.length === 0) return [];

  const results = [];
  const MAX_PER_FILE = 30000;

  for (const att of attachments) {
    const { data, error } = await sb.storage
      .from("feature-attachments")
      .download(att.storage_path);
    if (error || !data) continue;
    const text = await data.text();
    const truncated = text.length > MAX_PER_FILE;
    results.push({
      filename: att.filename,
      content: truncated ? text.slice(0, MAX_PER_FILE) : text,
      truncated,
    });
  }
  return results;
}

// ============================================================
// previewKickoff: monta initial_message sem disparar
// ============================================================
export async function previewKickoff(
  cardId: string,
  targetStage: StageCode
): Promise<{
  initial_message: string;
  agent_name: string;
  agent_id: string;
  model: string;
}> {
  const sb = createServiceClient();

  const { data: card } = await sb
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error(`card ${cardId} not found`);

  const { def, deployed } = await getAgentForStage(targetStage);

  const { data: feature } = await sb
    .from("features")
    .select("*")
    .eq("id", card.feature_id)
    .single();
  if (!feature) throw new Error("feature not found");

  const attachments = await fetchAttachmentContents(card.feature_id);
  const settings = await getAppSettings();

  const initial_message = defaultKickoff(
    { ...card, stage: targetStage },
    feature,
    attachments,
    settings
  );

  return {
    initial_message,
    agent_name: def.name,
    agent_id: deployed.claude_agent_id,
    model: def.model,
  };
}

// ============================================================
// startStage: cria sessão pro stage atual do card
// ============================================================
export async function startStage(
  cardId: string,
  initialMessage?: string,
  prependContext?: string
): Promise<string> {
  const sb = createServiceClient();

  const { data: card, error: cardErr } = await sb
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (cardErr || !card) throw new Error(`card ${cardId} not found`);

  const stage = card.stage as StageCode;
  const { def, deployed } = await getAgentForStage(stage);

  const feature = await ensureFeatureEnvironment(card.feature_id);
  const attachments = await fetchAttachmentContents(card.feature_id);
  const settings = await getAppSettings();

  let userMsg: string;
  if (initialMessage) {
    userMsg = initialMessage;
  } else {
    const base = defaultKickoff(
      { ...card, stage },
      feature,
      attachments,
      settings
    );
    userMsg = prependContext ? `${prependContext}\n\n${base}` : base;
  }

  const session = await beta.sessions.create({
    agent: deployed.claude_agent_id,
    environment_id: feature.claude_environment_id,
    title: `${feature.slug} · ${stage}`,
  });

  await beta.sessions.events.send(session.id, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text: userMsg }],
      },
    ],
  });

  // Atualiza card e registra stage_run
  await sb
    .from("cards")
    .update({
      claude_session_id: session.id,
      claude_agent_id: deployed.id,
      status: "running",
    })
    .eq("id", cardId);

  await sb.from("card_stage_runs").insert({
    card_id: cardId,
    stage,
    agent_role: def.role,
    claude_session_id: session.id,
    status: "running",
  });

  await sb.from("card_chat_messages").insert({
    card_id: cardId,
    session_id: session.id,
    role: "system",
    content: userMsg,
  });

  return session.id;
}

// ============================================================
// chatWithAgent: continua conversa em sessão existente
// ============================================================
export async function chatWithAgent(
  cardId: string,
  message: string,
  sentBy?: string
): Promise<{ session_id: string }> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error(`card ${cardId} not found`);
  if (!card.claude_session_id)
    throw new Error("card has no active session yet");

  await beta.sessions.events.send(card.claude_session_id, {
    events: [
      { type: "user.message", content: [{ type: "text", text: message }] },
    ],
  });

  await sb.from("cards").update({ status: "running" }).eq("id", cardId);
  await sb.from("card_chat_messages").insert({
    card_id: cardId,
    session_id: card.claude_session_id,
    role: "user",
    content: message,
    sent_by: sentBy ?? null,
  });

  return { session_id: card.claude_session_id };
}

// ============================================================
// advanceCard: MESMO CARD avança de stage (não cria novo)
// ============================================================
export async function advanceCard(
  cardId: string,
  decision: "approved" | "rejected",
  reason?: string,
  decidedBy?: string,
  overrideInitialMessage?: string
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

  // Fecha o gate atual
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

  // Marca o stage_run atual como completed/failed
  await sb
    .from("card_stage_runs")
    .update({
      status: decision === "approved" ? "completed" : "failed",
      ended_at: new Date().toISOString(),
    })
    .eq("card_id", cardId)
    .eq("stage", card.stage)
    .eq("status", "running");

  if (decision === "rejected") {
    // MESMO CARD, MESMO STAGE — só dispara nova sessão
    await sb
      .from("cards")
      .update({
        status: "queued",
        claude_session_id: null, // limpa sessão antiga (fica em stage_runs)
      })
      .eq("id", cardId);

    const rejectionContext =
      `--- REJECTION FEEDBACK ---\n` +
      `Your previous attempt was REJECTED.\n\nREASON:\n${reason}\n\n` +
      `Address this feedback specifically. Reuse the task context below.\n` +
      `--- end rejection feedback ---`;

    await startStage(cardId, undefined, rejectionContext);
    return;
  }

  // APROVADO: avança o MESMO card pra próxima stage
  const nextStage = NEXT_STAGE[card.stage as StageCode];

  // Marca features.current_stage também
  await sb
    .from("features")
    .update({ current_stage: nextStage })
    .eq("id", card.feature_id);

  if (nextStage === "done") {
    await sb
      .from("cards")
      .update({ status: "done", stage: "done", claude_session_id: null })
      .eq("id", cardId);
    return;
  }

  // Mesmo card, nova stage
  await sb
    .from("cards")
    .update({
      stage: nextStage,
      status: "queued",
      claude_session_id: null,
    })
    .eq("id", cardId);

  await startStage(cardId, overrideInitialMessage);
}

// ============================================================
// cancelCard
// ============================================================
export async function cancelCard(
  cardId: string,
  reason: string,
  cancelledBy?: string
): Promise<void> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*, feature:features(id)")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");

  await sb.from("cards").update({ status: "cancelled" }).eq("id", cardId);

  await sb
    .from("human_gates")
    .update({
      decision: "rejected",
      decision_reason: `cancelado: ${reason}`,
      decided_by: cancelledBy,
      decided_at: new Date().toISOString(),
    })
    .eq("card_id", cardId)
    .is("decision", null);

  await sb
    .from("card_stage_runs")
    .update({
      status: "failed",
      ended_at: new Date().toISOString(),
    })
    .eq("card_id", cardId)
    .eq("status", "running");

  await sb
    .from("features")
    .update({
      cancelled_at: new Date().toISOString(),
      cancelled_reason: reason,
    })
    .eq("id", card.feature.id);
}

export async function completeCardEarly(
  cardId: string,
  completedBy?: string
): Promise<void> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*, feature:features(id)")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");

  await sb
    .from("cards")
    .update({ status: "done", stage: "done" })
    .eq("id", cardId);

  await sb
    .from("human_gates")
    .update({
      decision: "approved",
      decision_reason: "concluído antecipadamente",
      decided_by: completedBy,
      decided_at: new Date().toISOString(),
    })
    .eq("card_id", cardId)
    .is("decision", null);

  await sb
    .from("features")
    .update({
      current_stage: "done",
      completed_early_at: new Date().toISOString(),
    })
    .eq("id", card.feature.id);
}

// ============================================================
// createFeature
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

  return { feature_id: feature.id, card_id: card.id };
}

export async function kickoffFirstStage(cardId: string): Promise<string> {
  return startStage(cardId);
}

// ============================================================
// defaultKickoff
// ============================================================
function defaultKickoff(
  card: { stage: string },
  feature: {
    slug: string;
    title: string;
    description: string | null;
    github_repo: string;
    github_parent_issue: number | null;
  },
  attachments: Array<{ filename: string; content: string; truncated: boolean }>,
  settings: {
    auto_merge_prs: boolean;
    commit_to_existing_branch: boolean;
    default_base_branch: string;
  }
): string {
  const token = process.env.GITHUB_TOKEN ?? "(GITHUB_TOKEN_NOT_SET)";
  const [owner, repo] = feature.github_repo.split("/");

  const credBlock =
    `\n--- GitHub credentials ---\n` +
    `Repo: ${feature.github_repo}\n` +
    `Owner: ${owner}\n` +
    `Repo name: ${repo}\n` +
    `Token: ${token}\n` +
    `Clone URL: https://x-access-token:${token}@github.com/${feature.github_repo}.git\n` +
    `API auth header: Authorization: token ${token}\n` +
    `Default base branch: ${settings.default_base_branch}\n---\n`;

  let workflowBlock = "";
  if (settings.commit_to_existing_branch) {
    workflowBlock =
      `\n--- Workflow mode: COMMIT-DIRECT ---\n` +
      `Commit directly to '${settings.default_base_branch}'. No new branch, no PR.\n---\n`;
  } else if (settings.auto_merge_prs) {
    workflowBlock =
      `\n--- Workflow mode: AUTO-MERGE ---\n` +
      `Open PR, wait for CI, merge with squash.\n---\n`;
  } else {
    workflowBlock =
      `\n--- Workflow mode: PR-REVIEW (default) ---\n` +
      `Open DRAFT PR. Human merges.\n---\n`;
  }

  let attachmentBlock = "";
  if (attachments.length > 0) {
    attachmentBlock =
      `\n--- Approved prototypes (${attachments.length} file${
        attachments.length > 1 ? "s" : ""
      }) ---\n` +
      `Source of truth for UI. Save each to docs/features/<slug>/prototypes/.\n\n` +
      attachments
        .map(
          (a, i) =>
            `### Prototype ${i + 1}: ${a.filename}${
              a.truncated ? " (TRUNCATED)" : ""
            }\n\n\`\`\`html\n${a.content}\n\`\`\``
        )
        .join("\n\n") +
      `\n---\n`;
  }

  const stage = card.stage;
  if (stage === "discovery") {
    return (
      `Build the spec for feature '${feature.title}' (slug: ${feature.slug}).\n\n` +
      `Initial description:\n${feature.description}\n` +
      credBlock +
      workflowBlock +
      attachmentBlock
    );
  }
  if (stage === "planning") {
    return (
      `The PM PR for '${feature.slug}' has been merged.\n` +
      `Read docs/features/${feature.slug}/prd.md, acceptance-criteria.md, prototypes.\n` +
      `Produce ADR and decompose into chunks. Parent issue: #${feature.github_parent_issue}.` +
      credBlock +
      workflowBlock +
      attachmentBlock
    );
  }
  if (stage === "development") {
    return (
      `Chunks for '${feature.slug}' planned. Recommend Dev Agent order.` +
      credBlock +
      workflowBlock +
      attachmentBlock
    );
  }
  if (stage === "qa") {
    return (
      `Dev PRs for '${feature.slug}' merged. Write tests, run CI.` +
      credBlock +
      workflowBlock +
      attachmentBlock
    );
  }
  throw new Error(`no kickoff template for stage ${stage}`);
}
