import { createServiceClient } from "@/lib/supabase/server";

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
    .select("test_coverage_pct, human_hours, input_tokens, output_tokens")
    .eq("card_id", cardId)
    .maybeSingle();

  const inputTokens = Number(existing?.input_tokens ?? 0);
  const outputTokens = Number(existing?.output_tokens ?? 0);

  // human_hours: usa o valor informado, senão estima 0.25h por gate decidido
  const humanHours =
    existing?.human_hours != null
      ? Number(existing.human_hours)
      : +(gatesTotal * 0.25).toFixed(2);

  // --- 4. custo ---
  const tokenCost =
    (inputTokens / 1_000_000) * inMtok + (outputTokens / 1_000_000) * outMtok;
  const humanCost = humanHours * hourly;
  const totalCost = tokenCost + humanCost;

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
      token_cost: +tokenCost.toFixed(4),
      human_hours: humanHours,
      human_cost: +humanCost.toFixed(2),
      total_cost: +totalCost.toFixed(2),
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
