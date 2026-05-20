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

  // Development tem orquestração própria: lê chunks e dispara um Dev Agent
  // por chunk seguindo o build order. As outras stages disparam uma sessão única.
  if (nextStage === "development") {
    await startDevelopmentStage(cardId);
  } else {
    await startStage(cardId, overrideInitialMessage);
  }
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

  const featureId = card.feature.id;

  // Cancela TODOS os cards desta feature (pode haver mais de um por causa
  // de cards órfãos criados pela versão antiga do orquestrador).
  const { data: allCards } = await sb
    .from("cards")
    .select("id")
    .eq("feature_id", featureId);
  const cardIds = (allCards ?? []).map((c) => c.id);

  await sb
    .from("cards")
    .update({ status: "cancelled" })
    .eq("feature_id", featureId);

  // Fecha todos os gates abertos de todos os cards da feature
  if (cardIds.length > 0) {
    await sb
      .from("human_gates")
      .update({
        decision: "rejected",
        decision_reason: `cancelado: ${reason}`,
        decided_by: cancelledBy,
        decided_at: new Date().toISOString(),
      })
      .in("card_id", cardIds)
      .is("decision", null);

    await sb
      .from("card_stage_runs")
      .update({
        status: "failed",
        ended_at: new Date().toISOString(),
      })
      .in("card_id", cardIds)
      .eq("status", "running");
  }

  await sb
    .from("features")
    .update({
      cancelled_at: new Date().toISOString(),
      cancelled_reason: reason,
    })
    .eq("id", featureId);
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
// moveCardToStage: move o card pra QUALQUER stage (frente ou trás)
// Ex: voltar de development pra planning ("Refinamento Técnico")
// ============================================================
const ALL_STAGES: StageCode[] = [
  "discovery",
  "planning",
  "development",
  "qa",
  "done",
];

export async function moveCardToStage(
  cardId: string,
  targetStage: StageCode,
  dispatch: boolean = true
): Promise<void> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");
  if (!ALL_STAGES.includes(targetStage)) {
    throw new Error(`stage inválida: ${targetStage}`);
  }

  // Fecha gates abertos do card
  await sb
    .from("human_gates")
    .update({
      decision: "rejected",
      decision_reason: `movido manualmente para ${targetStage}`,
      decided_at: new Date().toISOString(),
    })
    .eq("card_id", cardId)
    .is("decision", null);

  // Marca runs em andamento como interrompidas
  await sb
    .from("card_stage_runs")
    .update({ status: "failed", ended_at: new Date().toISOString() })
    .eq("card_id", cardId)
    .eq("status", "running");

  // Atualiza features.current_stage
  await sb
    .from("features")
    .update({ current_stage: targetStage })
    .eq("id", card.feature_id);

  if (targetStage === "done") {
    await sb
      .from("cards")
      .update({ stage: "done", status: "done", claude_session_id: null })
      .eq("id", cardId);
    return;
  }

  // Move o card
  await sb
    .from("cards")
    .update({
      stage: targetStage,
      status: dispatch ? "queued" : "awaiting_review",
      claude_session_id: null,
    })
    .eq("id", cardId);

  if (dispatch) {
    if (targetStage === "development") {
      await startDevelopmentStage(cardId);
    } else {
      await startStage(cardId);
    }
  }
}

// ============================================================
// rerunStage: descarta o processamento da stage atual e refaz já
// ============================================================
export async function rerunStage(cardId: string): Promise<void> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*, feature:features(id)")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");

  const stage = card.stage as StageCode;

  // Fecha gates abertos
  await sb
    .from("human_gates")
    .update({
      decision: "rejected",
      decision_reason: "re-execução do estágio solicitada",
      decided_at: new Date().toISOString(),
    })
    .eq("card_id", cardId)
    .is("decision", null);

  // Marca todas as runs dessa stage como descartadas
  await sb
    .from("card_stage_runs")
    .update({ status: "failed", ended_at: new Date().toISOString() })
    .eq("card_id", cardId)
    .eq("stage", stage);

  // Se for development, reseta os chunks pra planned (refaz tudo)
  if (stage === "development") {
    await sb
      .from("chunks")
      .update({ status: "planned" })
      .eq("feature_id", card.feature.id);
  }

  // Limpa sessão e re-dispara
  await sb
    .from("cards")
    .update({ status: "queued", claude_session_id: null })
    .eq("id", cardId);

  if (stage === "development") {
    await startDevelopmentStage(cardId);
  } else {
    await startStage(cardId);
  }
}

// ============================================================
// forceSyncSession: consulta o status real da sessão e destrava
// cards presos (sessão idle/ended mas card ainda "running")
// ============================================================
export async function forceSyncSession(cardId: string): Promise<{
  card_status: string;
  session_status: string;
  action: string;
}> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");

  if (!card.claude_session_id) {
    return {
      card_status: card.status,
      session_status: "none",
      action: "card sem sessão ativa — nada a sincronizar",
    };
  }

  // Consulta o status real da sessão
  let session: any = null;
  try {
    session = await beta.sessions.retrieve(card.claude_session_id);
  } catch (e) {
    return {
      card_status: card.status,
      session_status: "error",
      action: `falha ao consultar sessão: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  const rawStatus = String(session?.status ?? "unknown").toLowerCase();
  const isActive =
    rawStatus.includes("running") ||
    rawStatus.includes("pending") ||
    rawStatus.includes("starting") ||
    rawStatus.includes("progress");

  if (isActive) {
    return {
      card_status: card.status,
      session_status: rawStatus,
      action: "sessão ainda ativa — aguarde ou re-execute se travada",
    };
  }

  // Sessão terminou (idle/ended/completed/failed) mas card pode estar preso
  if (card.status !== "running") {
    return {
      card_status: card.status,
      session_status: rawStatus,
      action: "card já não estava em running — nenhuma ação necessária",
    };
  }

  // É uma sessão de chunk? Avança o pipeline de development
  const wasChunk = await handleChunkSessionIdle(card.claude_session_id);
  if (wasChunk) {
    return {
      card_status: "running",
      session_status: rawStatus,
      action: "chunk finalizado — próximo chunk disparado (ou stage concluída)",
    };
  }

  // Stage normal: força transição pra awaiting_review
  const summary = extractSessionSummary(session);
  await moveToAwaitingReview(cardId, card.stage, summary);

  return {
    card_status: "awaiting_review",
    session_status: rawStatus,
    action: "card destravado → aguardando revisão",
  };
}

// Move um card pra awaiting_review criando/atualizando o gate (reutilizável)
async function moveToAwaitingReview(
  cardId: string,
  stage: string,
  summary: string
): Promise<void> {
  const sb = createServiceClient();
  const roleForStage: Record<string, string> = {
    discovery: "pm",
    planning: "tech_lead",
    development: "tech_lead",
    qa: "qa",
  };
  const role = roleForStage[stage] ?? "admin";

  const { data: assignee } = await sb
    .from("user_profiles")
    .select("id")
    .eq("role", role)
    .limit(1)
    .single();

  await sb
    .from("card_stage_runs")
    .update({ summary })
    .eq("card_id", cardId)
    .eq("status", "running");

  await sb.from("cards").update({ status: "awaiting_review" }).eq("id", cardId);

  const { data: existingGate } = await sb
    .from("human_gates")
    .select("id")
    .eq("card_id", cardId)
    .is("decision", null)
    .single();

  if (!existingGate) {
    await sb.from("human_gates").insert({
      card_id: cardId,
      assignee_id: assignee?.id ?? null,
      summary,
      artifacts_json: [],
    });
  } else {
    await sb
      .from("human_gates")
      .update({ summary })
      .eq("id", existingGate.id);
  }
}

function extractSessionSummary(session: any): string {
  if (!session) return "(sem dados da sessão)";
  const messages = session?.messages ?? session?.events ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" && m.type !== "agent.message") continue;
    if (typeof m.content === "string") return m.content;
    for (const block of m.content ?? []) {
      if (block.type === "text") return block.text;
    }
  }
  return "(agente concluiu o turno)";
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
// ORQUESTRAÇÃO DE CHUNKS (development)
// ============================================================

// Mapeia o skill de um chunk para o role do Dev Agent
const SKILL_TO_ROLE: Record<string, string> = {
  backend: "dev_backend",
  frontend: "dev_frontend",
  infra: "dev_infra",
  data: "dev_backend", // fallback razoável
};

function extractSkillFromLabels(labels: string[]): string {
  for (const l of labels) {
    const m = l.match(/^skill:(\w+)/);
    if (m) return m[1];
  }
  // tenta achar no título via prefixo [backend], [frontend], etc
  return "backend";
}

/**
 * Lê as issues (chunks) do GitHub com label feat:<slug> e persiste em `chunks`.
 * Retorna os chunks ordenados por número da issue (proxy do build order).
 */
async function loadAndPersistChunks(
  featureId: string,
  repo: string,
  slug: string
): Promise<
  Array<{
    id: string;
    title: string;
    skill: string;
    github_issue_number: number;
    status: string;
  }>
> {
  const sb = createServiceClient();
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN não configurado");

  const url = `https://api.github.com/repos/${repo}/issues?state=all&labels=feat:${encodeURIComponent(
    slug
  )}&per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub issues API ${res.status}`);
  }
  const items = await res.json();
  const issues = (Array.isArray(items) ? items : []).filter(
    (it: any) => !it.pull_request
  );

  // Ordena por número da issue (ordem de criação ≈ build order do TL)
  issues.sort((a: any, b: any) => a.number - b.number);

  const result = [];
  for (const issue of issues) {
    const labels = (issue.labels ?? []).map((l: any) =>
      typeof l === "string" ? l : l.name
    );
    const skill = extractSkillFromLabels(labels);

    // Upsert do chunk (idempotente por github_issue_number)
    const { data: existing } = await sb
      .from("chunks")
      .select("id, status")
      .eq("feature_id", featureId)
      .eq("github_issue_number", issue.number)
      .single();

    let chunkId: string;
    let status: string;
    if (existing) {
      chunkId = existing.id;
      status = existing.status;
    } else {
      const { data: created } = await sb
        .from("chunks")
        .insert({
          feature_id: featureId,
          title: issue.title,
          description: (issue.body ?? "").slice(0, 2000),
          skill,
          github_issue_number: issue.number,
          status: "planned",
        })
        .select("id, status")
        .single();
      chunkId = created!.id;
      status = created!.status;
    }

    result.push({
      id: chunkId,
      title: issue.title,
      skill,
      github_issue_number: issue.number,
      status,
    });
  }

  return result;
}

/**
 * Entry point da stage de development: lê chunks e dispara o primeiro.
 */
export async function startDevelopmentStage(cardId: string): Promise<void> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*, feature:features(id, slug, github_repo)")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");

  const feature = card.feature as any;
  const chunks = await loadAndPersistChunks(
    feature.id,
    feature.github_repo,
    feature.slug
  );

  if (chunks.length === 0) {
    // Sem chunks — cai pro comportamento padrão (dispara dev agent genérico)
    await startStage(cardId);
    return;
  }

  await startNextChunk(cardId);
}

/**
 * Acha o próximo chunk 'planned' e dispara uma sessão de Dev Agent pra ele.
 * Se não houver mais chunks pendentes, marca o card como awaiting_review.
 * Chamado tanto no início da stage quanto pelo webhook quando um chunk termina.
 */
export async function startNextChunk(cardId: string): Promise<void> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*, feature:features(id, slug, github_repo, github_parent_issue, description, claude_environment_id)")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");
  const feature = card.feature as any;

  // Próximo chunk não concluído (planned), por ordem de issue
  const { data: nextChunk } = await sb
    .from("chunks")
    .select("*")
    .eq("feature_id", feature.id)
    .eq("status", "planned")
    .order("github_issue_number", { ascending: true })
    .limit(1)
    .single();

  if (!nextChunk) {
    // Todos os chunks foram trabalhados → development completo, gate humano
    await sb
      .from("cards")
      .update({ status: "awaiting_review", claude_session_id: null })
      .eq("id", cardId);

    // Cria gate pro Tech Lead humano revisar tudo antes de QA
    const { data: tlUser } = await sb
      .from("user_profiles")
      .select("id")
      .eq("role", "tech_lead")
      .limit(1)
      .single();

    const { data: openGate } = await sb
      .from("human_gates")
      .select("id")
      .eq("card_id", cardId)
      .is("decision", null)
      .single();

    if (!openGate) {
      await sb.from("human_gates").insert({
        card_id: cardId,
        stage: "development",
        assignee_id: tlUser?.id ?? null,
        summary:
          "Todos os chunks foram implementados. Revise os PRs antes de avançar para QA.",
      });
    }
    return;
  }

  // Escolhe o Dev Agent pelo skill do chunk
  const role = SKILL_TO_ROLE[nextChunk.skill] ?? "dev_backend";
  const { data: agentDef } = await sb
    .from("agent_definitions")
    .select("*")
    .eq("role", role)
    .eq("enabled", true)
    .single();

  // Fallback: se o role específico não existe/desabilitado, pega qualquer dev de development
  let chosenDef = agentDef;
  if (!chosenDef) {
    const { data: anyDev } = await sb
      .from("agent_definitions")
      .select("*")
      .eq("stage", "development")
      .eq("enabled", true)
      .order("sort_order", { ascending: true })
      .limit(1)
      .single();
    chosenDef = anyDev;
  }
  if (!chosenDef) throw new Error("nenhum Dev Agent habilitado em development");

  const { data: deployed } = await sb
    .from("agents")
    .select("*")
    .eq("role", chosenDef.role)
    .eq("is_current", true)
    .single();
  if (!deployed)
    throw new Error(`Dev Agent ${chosenDef.role} não deployado; rode /admin/setup`);

  // Garante environment
  const feat = await ensureFeatureEnvironment(feature.id);
  const attachments = await fetchAttachmentContents(feature.id);
  const settings = await getAppSettings();

  // Marca chunk como in_progress
  await sb
    .from("chunks")
    .update({ status: "in_progress" })
    .eq("id", nextChunk.id);

  // Monta o kickoff específico do chunk
  const userMsg = chunkKickoff(
    feature,
    nextChunk,
    chosenDef.role,
    attachments,
    settings
  );

  const session = await beta.sessions.create({
    agent: deployed.claude_agent_id,
    environment_id: feat.claude_environment_id,
    title: `${feature.slug} · chunk #${nextChunk.github_issue_number} (${chosenDef.role})`,
  });

  await beta.sessions.events.send(session.id, {
    events: [{ type: "user.message", content: [{ type: "text", text: userMsg }] }],
  });

  // Registra chunk_run e stage_run
  await sb.from("chunk_runs").insert({
    chunk_id: nextChunk.id,
    claude_session_id: session.id,
    claude_agent_id: deployed.id,
  });

  await sb.from("card_stage_runs").insert({
    card_id: cardId,
    stage: "development",
    agent_role: chosenDef.role,
    claude_session_id: session.id,
    status: "running",
    summary: `Chunk #${nextChunk.github_issue_number}: ${nextChunk.title}`,
  });

  await sb
    .from("cards")
    .update({
      claude_session_id: session.id,
      claude_agent_id: deployed.id,
      status: "running",
    })
    .eq("id", cardId);

  await sb.from("card_chat_messages").insert({
    card_id: cardId,
    session_id: session.id,
    role: "system",
    content: userMsg,
  });
}

/**
 * Chamado pelo webhook quando uma sessão de chunk termina.
 * Marca o chunk como done e dispara o próximo (ou finaliza a stage).
 * Retorna true se era um chunk (e foi tratado), false caso contrário.
 */
export async function handleChunkSessionIdle(
  sessionId: string
): Promise<boolean> {
  const sb = createServiceClient();

  // É uma sessão de chunk?
  const { data: chunkRun } = await sb
    .from("chunk_runs")
    .select("*, chunk:chunks(id, feature_id)")
    .eq("claude_session_id", sessionId)
    .single();

  if (!chunkRun) return false; // não é chunk; deixa o handler normal cuidar

  // Marca chunk como done e o run como finalizado
  await sb
    .from("chunks")
    .update({ status: "done" })
    .eq("id", chunkRun.chunk_id);
  await sb
    .from("chunk_runs")
    .update({ finished_at: new Date().toISOString() })
    .eq("id", chunkRun.id);

  // Marca o stage_run dessa sessão como completed
  await sb
    .from("card_stage_runs")
    .update({ status: "completed", ended_at: new Date().toISOString() })
    .eq("claude_session_id", sessionId);

  // Acha o card da feature
  const featureId = (chunkRun.chunk as any).feature_id;
  const { data: card } = await sb
    .from("cards")
    .select("id")
    .eq("feature_id", featureId)
    .eq("stage", "development")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (card) {
    // Dispara o próximo chunk (ou finaliza a stage)
    await startNextChunk(card.id);
  }

  return true;
}

function chunkKickoff(
  feature: {
    slug: string;
    github_repo: string;
    github_parent_issue: number | null;
  },
  chunk: { github_issue_number: number; title: string; skill: string },
  role: string,
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
    `Owner: ${owner}\nRepo name: ${repo}\n` +
    `Token: ${token}\n` +
    `Clone URL: https://x-access-token:${token}@github.com/${feature.github_repo}.git\n` +
    `API auth header: Authorization: token ${token}\n` +
    `Default base branch: ${settings.default_base_branch}\n---\n`;

  let workflowBlock: string;
  if (settings.commit_to_existing_branch) {
    workflowBlock =
      `\n--- Workflow mode: COMMIT-DIRECT ---\n` +
      `Commit directly to '${settings.default_base_branch}'. No PR.\n---\n`;
  } else if (settings.auto_merge_prs) {
    workflowBlock =
      `\n--- Workflow mode: AUTO-MERGE ---\n` +
      `Open PR, wait for CI, merge with squash.\n---\n`;
  } else {
    workflowBlock =
      `\n--- Workflow mode: PR-REVIEW (default) ---\n` +
      `Open a DRAFT PR. Human reviews and merges.\n---\n`;
  }

  let attachmentBlock = "";
  if (attachments.length > 0 && role === "dev_frontend") {
    attachmentBlock =
      `\n--- Approved prototypes (${attachments.length}) ---\n` +
      `Your implementation MUST be 1:1 with these prototypes.\n\n` +
      attachments
        .map(
          (a, i) =>
            `### Prototype ${i + 1}: ${a.filename}\n\n\`\`\`html\n${a.content}\n\`\`\``
        )
        .join("\n\n") +
      `\n---\n`;
  }

  return (
    `IMPLEMENT this chunk for feature '${feature.slug}'.\n\n` +
    `CHUNK: issue #${chunk.github_issue_number} — ${chunk.title}\n` +
    `Skill: ${chunk.skill}\n\n` +
    `STEPS (you MUST write actual code, not just plan):\n` +
    `1. Clone the repo using the credentials below.\n` +
    `2. Read the full issue #${chunk.github_issue_number} via GitHub API for scope and acceptance criteria.\n` +
    `3. Read docs/features/${feature.slug}/prd.md, adr.md, acceptance-criteria.md and any prototypes.\n` +
    `4. Create branch feat/${feature.slug}/${chunk.github_issue_number}-impl from ${settings.default_base_branch}.\n` +
    `5. WRITE THE CODE that implements this chunk. Create/modify the actual source files in the repo.\n` +
    `6. Run lint, typecheck and tests locally before committing.\n` +
    `7. Commit with a clear message and push the branch.\n` +
    `8. Open a DRAFT PR with body "Closes #${chunk.github_issue_number}". Add label status:in-review.\n` +
    `9. End your turn with the PR URL and a summary of files changed.\n\n` +
    `IMPORTANT: Stay strictly within the scope of issue #${chunk.github_issue_number}. ` +
    `Do not implement other chunks. Disable git commit signing with -c commit.gpgsign=false. ` +
    `Set a git identity before committing.` +
    credBlock +
    workflowBlock +
    attachmentBlock
  );
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
