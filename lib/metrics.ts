import { createServiceClient } from "@/lib/supabase/server";
import { computeCostUSD } from "@/lib/pricing";

/**
 * Calcula a semana ISO (YYYY-Www) de uma data.
 */
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((d.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Recalcula e persiste as métricas de um card. Idempotente — chamável a
 * qualquer momento (avanço de etapa, decisão de gate, conclusão, sync).
 */
export async function recomputeCardMetrics(cardId: string): Promise<void> {
  const sb = createServiceClient();

  const { data: card } = await sb
    .from("cards")
    .select(
      "id, stage, status, created_at, updated_at, feature:features(id, project_id, created_at)"
    )
    .eq("id", cardId)
    .single();
  if (!card) return;

  const feature = card.feature as any;
  const projectId = feature?.project_id ?? null;

  // team do projeto (pra filtrar dashboard por time)
  let teamId: string | null = null;
  if (projectId) {
    const { data: proj } = await sb
      .from("projects")
      .select("team_id")
      .eq("id", projectId)
      .single();
    teamId = proj?.team_id ?? null;
  }

  // config de custos do projeto
  let hourly = 0,
    inMtok = 0,
    outMtok = 0;
  if (projectId) {
    const { data: settings } = await sb
      .from("app_settings")
      .select("human_hourly_cost, token_cost_input_mtok, token_cost_output_mtok")
      .eq("project_id", projectId)
      .limit(1)
      .maybeSingle();
    hourly = Number(settings?.human_hourly_cost ?? 0);
    inMtok = Number(settings?.token_cost_input_mtok ?? 0);
    outMtok = Number(settings?.token_cost_output_mtok ?? 0);
  }

  // --- 1. cycle time ---
  const startedAt = new Date(feature?.created_at ?? card.created_at);
  const isDone = card.stage === "done" || card.status === "done";
  const completedAt = isDone ? new Date(card.updated_at) : null;
  const endRef = completedAt ?? new Date();
  const cycleHours =
    Math.max(0, endRef.getTime() - startedAt.getTime()) / 3_600_000;

  // --- 2. taxa de aprovação (gates) ---
  const { data: gates } = await sb
    .from("human_gates")
    .select("decision")
    .eq("card_id", cardId);
  const decided = (gates ?? []).filter((g) => g.decision);
  const gatesTotal = decided.length;
  const gatesRejected = decided.filter((g) => g.decision === "rejected").length;
  const firstPass = gatesTotal > 0 ? gatesRejected === 0 : null;

  // --- preserva campos manuais/captados já existentes ---
  const { data: existing } = await sb
    .from("card_metrics")
    .select("test_coverage_pct, human_hours, input_tokens, output_tokens, loc_estimate, complexity")
    .eq("card_id", cardId)
    .maybeSingle();

  // --- SOMA DOS RUNS DE ETAPA (fonte de verdade pro custo) ---
  const { data: runs } = await sb
    .from("card_stage_runs")
    .select("input_tokens, output_tokens, token_cost, human_hours, human_cost, total_cost")
    .eq("card_id", cardId);
  let sIn = 0,
    sOut = 0,
    sTokenCost = 0,
    sHours = 0,
    sHumanCost = 0,
    sTotal = 0;
  for (const r of runs ?? []) {
    sIn += Number((r as any).input_tokens ?? 0);
    sOut += Number((r as any).output_tokens ?? 0);
    sTokenCost += Number((r as any).token_cost ?? 0);
    sHours += Number((r as any).human_hours ?? 0);
    sHumanCost += Number((r as any).human_cost ?? 0);
    sTotal += Number((r as any).total_cost ?? 0);
  }
  const hasRunData =
    sIn > 0 || sOut > 0 || sTokenCost > 0 || sHumanCost > 0 || sTotal > 0 || sHours > 0;

  // Tokens: prefere o que foi acumulado nos runs; senão usa o legado em card_metrics
  const inputTokens = hasRunData ? sIn : Number(existing?.input_tokens ?? 0);
  const outputTokens = hasRunData ? sOut : Number(existing?.output_tokens ?? 0);

  // human_hours: se temos runs, soma das durações; senão usa o valor manual; senão estima
  const humanHours = hasRunData
    ? +sHours.toFixed(2)
    : existing?.human_hours != null
    ? Number(existing.human_hours)
    : +(gatesTotal * 0.25).toFixed(2);

  // --- 4. custo (sempre soma dos runs quando houver, com fallback legado) ---
  const tokenCostLegacy =
    (inputTokens / 1_000_000) * inMtok + (outputTokens / 1_000_000) * outMtok;
  const humanCostLegacy = humanHours * hourly;

  const tokenCost = hasRunData ? +sTokenCost.toFixed(4) : +tokenCostLegacy.toFixed(4);
  const humanCost = hasRunData ? +sHumanCost.toFixed(2) : +humanCostLegacy.toFixed(2);
  const totalCost = hasRunData ? +sTotal.toFixed(2) : +(tokenCostLegacy + humanCostLegacy).toFixed(2);

  // --- LOC da feature (referência de mercado p/ baseline humano) ---
  // Mede uma vez, na conclusão, via GitHub compare (base...working).
  let locEstimate: number | null = existing?.loc_estimate ?? null;
  if (isDone && locEstimate == null && feature?.id) {
    try {
      locEstimate = await estimateFeatureLoc(feature.id);
    } catch {
      locEstimate = null;
    }
  }

  await sb.from("card_metrics").upsert(
    {
      card_id: cardId,
      feature_id: feature?.id ?? null,
      project_id: projectId,
      team_id: teamId,
      cycle_time_hours: +cycleHours.toFixed(2),
      started_at: startedAt.toISOString(),
      completed_at: completedAt?.toISOString() ?? null,
      is_done: isDone,
      gates_total: gatesTotal,
      gates_rejected: gatesRejected,
      first_pass: firstPass,
      test_coverage_pct: existing?.test_coverage_pct ?? null,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      token_cost: tokenCost,
      human_hours: humanHours,
      human_cost: humanCost,
      total_cost: totalCost,
      loc_estimate: locEstimate,
      complexity: existing?.complexity ?? null,
      iso_week: isoWeek(completedAt ?? startedAt),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "card_id" }
  );
}

/**
 * Acumula uso de tokens de uma sessão no card (best-effort, chamado no sync).
 */
export async function addTokenUsage(
  cardId: string,
  input: number,
  output: number
): Promise<void> {
  if (!input && !output) return;
  const sb = createServiceClient();
  const { data: m } = await sb
    .from("card_metrics")
    .select("input_tokens, output_tokens")
    .eq("card_id", cardId)
    .maybeSingle();
  await sb.from("card_metrics").upsert(
    {
      card_id: cardId,
      input_tokens: Number(m?.input_tokens ?? 0) + input,
      output_tokens: Number(m?.output_tokens ?? 0) + output,
    },
    { onConflict: "card_id" }
  );
  await recomputeCardMetrics(cardId);
}

/**
 * Atualiza campos manuais (cobertura de testes, horas humanas) e recalcula.
 */
export async function updateManualMetrics(
  cardId: string,
  patch: { test_coverage_pct?: number | null; human_hours?: number | null }
): Promise<void> {
  const sb = createServiceClient();
  await sb.from("card_metrics").upsert(
    { card_id: cardId, ...patch },
    { onConflict: "card_id" }
  );
  await recomputeCardMetrics(cardId);
}

// ============================================================
// captureSessionUsage: persiste tokens + custos por etapa
// ============================================================
// Chamado quando uma sessão completa. Lê usage do objeto session da Anthropic
// (best-effort — se o campo não existir, fica 0) e grava no card_stage_run.
export async function captureSessionUsage(
  cardId: string,
  sessionId: string,
  sessionUsage: { input_tokens?: number; output_tokens?: number } | null | undefined
): Promise<void> {
  const inTok = Number(sessionUsage?.input_tokens ?? 0);
  const outTok = Number(sessionUsage?.output_tokens ?? 0);
  // Mesmo sem usage, ainda vamos computar o custo HUMANO da etapa pela duração.

  const sb = createServiceClient();
  // localiza o stage_run pela session_id (último daquele card)
  const { data: run } = await sb
    .from("card_stage_runs")
    .select("id, card_id, input_tokens, output_tokens, started_at, ended_at, model, agent_role, feature:cards!inner(feature:features(project_id))")
    .eq("card_id", cardId)
    .eq("claude_session_id", sessionId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!run) return;

  // câmbio + override manual + custo/hora POR PAPEL do agente
  const projectId = (run as any)?.feature?.feature?.project_id;
  const agentRole: string | null = (run as any)?.agent_role ?? null;
  let usdToBrl = 5.0, hourly = 0, overrideIn = 0, overrideOut = 0;
  if (projectId) {
    const { data: s } = await sb
      .from("app_settings")
      .select("token_cost_input_mtok, token_cost_output_mtok, usd_to_brl")
      .eq("project_id", projectId)
      .limit(1)
      .maybeSingle();
    overrideIn = Number(s?.token_cost_input_mtok ?? 0);
    overrideOut = Number(s?.token_cost_output_mtok ?? 0);
    usdToBrl = Number(s?.usd_to_brl ?? 5.0);
    // custo/hora vem das PESSOAS com o papel mapeado do agente
    hourly = await getHourlyRateForAgent(projectId, agentRole);
  }

  // tokens são cumulativos no objeto session — só atualiza se vier maior
  const newIn = Math.max(inTok, Number((run as any).input_tokens ?? 0));
  const newOut = Math.max(outTok, Number((run as any).output_tokens ?? 0));

  // Custo de tokens: AUTOMÁTICO pela tabela de preços (USD→BRL).
  // Se o admin configurou override manual em R$/Mtok, esse override prevalece.
  let tokenCost: number;
  if (overrideIn > 0 || overrideOut > 0) {
    tokenCost = (newIn / 1_000_000) * overrideIn + (newOut / 1_000_000) * overrideOut;
  } else {
    const usd = computeCostUSD((run as any).model, newIn, newOut);
    tokenCost = usd * usdToBrl;
  }

  // duração da etapa em horas (proxy para custo humano — tempo do revisor)
  const started = new Date((run as any).started_at);
  const ended = (run as any).ended_at ? new Date((run as any).ended_at) : new Date();
  const hours = Math.max(0, (ended.getTime() - started.getTime()) / 3_600_000);
  const humanCost = hours * hourly;

  await sb
    .from("card_stage_runs")
    .update({
      input_tokens: newIn,
      output_tokens: newOut,
      token_cost: +tokenCost.toFixed(4),
      human_hours: +hours.toFixed(3),
      human_cost: +humanCost.toFixed(2),
      total_cost: +(tokenCost + humanCost).toFixed(2),
    })
    .eq("id", (run as any).id);

  // rolla pro card_metrics
  await recomputeCardMetrics(cardId);
}

// ============================================================
// getStageCostBreakdown: para a UI do detalhe — custo por etapa + acumulado
// ============================================================
export async function getStageCostBreakdown(cardId: string): Promise<{
  stages: Array<{
    id: string;
    stage: string;
    agent_role: string | null;
    model: string | null;
    started_at: string;
    ended_at: string | null;
    status: string;
    input_tokens: number;
    output_tokens: number;
    token_cost: number;
    human_hours: number;
    human_cost: number;
    total_cost: number;
    running_total: number;
  }>;
  currency: string;
}> {
  const sb = createServiceClient();
  const { data: runs } = await sb
    .from("card_stage_runs")
    .select(
      "id, stage, agent_role, model, started_at, ended_at, status, input_tokens, output_tokens, token_cost, human_hours, human_cost, total_cost"
    )
    .eq("card_id", cardId)
    .order("started_at", { ascending: true });

  // moeda do projeto
  const { data: card } = await sb
    .from("cards")
    .select("feature:features(project_id)")
    .eq("id", cardId)
    .single();
  const projectId = (card as any)?.feature?.project_id;
  let currency = "BRL";
  if (projectId) {
    const { data: s } = await sb
      .from("app_settings")
      .select("metrics_currency")
      .eq("project_id", projectId)
      .limit(1)
      .maybeSingle();
    currency = s?.metrics_currency ?? "BRL";
  }

  let acc = 0;
  const stages = (runs ?? []).map((r: any) => {
    acc += Number(r.total_cost ?? 0);
    return {
      id: r.id,
      stage: r.stage,
      agent_role: r.agent_role,
      model: r.model ?? null,
      started_at: r.started_at,
      ended_at: r.ended_at,
      status: r.status,
      input_tokens: Number(r.input_tokens ?? 0),
      output_tokens: Number(r.output_tokens ?? 0),
      token_cost: Number(r.token_cost ?? 0),
      human_hours: Number(r.human_hours ?? 0),
      human_cost: Number(r.human_cost ?? 0),
      total_cost: Number(r.total_cost ?? 0),
      running_total: +acc.toFixed(2),
    };
  });
  return { stages, currency };
}

// ============================================================
// Custo/hora por PAPEL do agente: usa pessoas cadastradas no time
// ============================================================
// Mapeia o agent_role da etapa para o cargo (PM, Tech Lead, Dev, QA) e
// devolve a média salário/horas das pessoas com aquele cargo. Fallback:
// app_settings.human_hourly_cost (o legado, um valor único pro time todo).
export function mapAgentRoleToPersonRole(agentRole: string | null | undefined): string {
  if (!agentRole) return "dev";
  const r = agentRole.toLowerCase();
  if (r === "pm") return "pm";
  if (r === "tech_lead" || r === "code_reviewer") return "tech_lead";
  if (r === "qa") return "qa";
  // dev_backend / dev_frontend / dev_infra / outros → "dev"
  return "dev";
}

export async function getHourlyRateForAgent(
  projectId: string,
  agentRole: string | null | undefined
): Promise<number> {
  const sb = createServiceClient();
  const personRole = mapAgentRoleToPersonRole(agentRole);
  const { data: people } = await sb
    .from("project_people")
    .select("monthly_salary, monthly_hours")
    .eq("project_id", projectId)
    .eq("role", personRole);
  const rates: number[] = [];
  for (const p of people ?? []) {
    const sal = Number((p as any).monthly_salary ?? 0);
    const hrs = Number((p as any).monthly_hours ?? 0);
    if (sal > 0 && hrs > 0) rates.push(sal / hrs);
  }
  if (rates.length > 0) {
    return rates.reduce((a, b) => a + b, 0) / rates.length;
  }
  // fallback: rate global do time (legado)
  const { data: settings } = await sb
    .from("app_settings")
    .select("human_hourly_cost")
    .eq("project_id", projectId)
    .limit(1)
    .maybeSingle();
  return Number(settings?.human_hourly_cost ?? 0);
}

/**
 * Estima as linhas de código produzidas por uma feature, comparando a branch
 * de trabalho com a branch raiz no GitHub (additions do compare). Usado como
 * referência de mercado para o baseline humano. Best-effort: 0 se falhar.
 */
export async function estimateFeatureLoc(featureId: string): Promise<number | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  const sb = createServiceClient();
  const { data: feature } = await sb
    .from("features")
    .select("working_branch, source_branch, repository_id")
    .eq("id", featureId)
    .maybeSingle();
  if (!feature?.working_branch) return null;

  let repo = "";
  if (feature.repository_id) {
    const { data: r } = await sb
      .from("project_repositories")
      .select("github_repo")
      .eq("id", feature.repository_id)
      .maybeSingle();
    repo = r?.github_repo ?? "";
  }
  if (!repo) return null;

  const base = feature.source_branch || "main";
  const head = feature.working_branch;

  // 1) tenta o compare base...working (funciona enquanto a branch existe)
  if (base !== head) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
    );
    if (res.ok) {
      const data = await res.json();
      const files = Array.isArray(data?.files) ? data.files : [];
      const additions = files.reduce((s: number, f: any) => s + (f.additions ?? 0), 0);
      if (additions > 0) return additions;
    }
  }

  // 2) fallback (feature já mergeada / branch removida): soma additions dos
  // PRs cujo head é a branch de trabalho.
  try {
    const owner = repo.split("/")[0];
    const listRes = await fetch(
      `https://api.github.com/repos/${repo}/pulls?state=all&head=${encodeURIComponent(`${owner}:${head}`)}&per_page=20`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
    );
    if (listRes.ok) {
      const prs = await listRes.json();
      let total = 0;
      for (const pr of Array.isArray(prs) ? prs : []) {
        const det = await fetch(`https://api.github.com/repos/${repo}/pulls/${pr.number}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
        });
        if (det.ok) {
          const d = await det.json();
          total += d?.additions ?? 0;
        }
      }
      if (total > 0) return total;
    }
  } catch {
    /* ignore */
  }
  return null;
}
