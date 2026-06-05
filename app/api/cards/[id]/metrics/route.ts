import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { recomputeCardMetrics, updateManualMetrics, getStageCostBreakdown, computeFeatureBaseline } from "@/lib/metrics";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // recalcula on-demand pra refletir cycle time atual
  try {
    await recomputeCardMetrics(params.id);
  } catch {
    /* best-effort */
  }

  const svc = createServiceClient();
  const { data } = await svc
    .from("card_metrics")
    .select("*")
    .eq("card_id", params.id)
    .maybeSingle();

  // moeda + parâmetros de baseline (pra calcular ROI da feature)
  let currency = "BRL";
  let baseline: any = null;
  if (data?.project_id) {
    const { data: s } = await svc
      .from("app_settings")
      .select(
        "metrics_currency, baseline_loc_per_dev_day, baseline_hours_per_day, baseline_dev_hourly, human_hourly_cost, baseline_hours_s, baseline_hours_m, baseline_hours_l, baseline_hours_xl, baseline_default_complexity, baseline_team_size, baseline_cost_mode"
      )
      .eq("project_id", data.project_id)
      .limit(1)
      .maybeSingle();
    currency = s?.metrics_currency ?? "BRL";
    if (data && s) {
      try {
        baseline = computeFeatureBaseline(data, s);
      } catch {
        baseline = null;
      }
    }
  }

  // breakdown por etapa (custo incremental + acumulado)
  let stageBreakdown: any = { stages: [], currency };
  try {
    stageBreakdown = await getStageCostBreakdown(params.id);
  } catch {
    /* best-effort */
  }

  return NextResponse.json({
    metrics: data,
    currency,
    stage_breakdown: stageBreakdown.stages,
    baseline,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const patch: { test_coverage_pct?: number | null; human_hours?: number | null } = {};
  if ("test_coverage_pct" in body)
    patch.test_coverage_pct =
      body.test_coverage_pct === null ? null : Number(body.test_coverage_pct);
  if ("human_hours" in body)
    patch.human_hours =
      body.human_hours === null ? null : Number(body.human_hours);

  await updateManualMetrics(params.id, patch);

  const svc = createServiceClient();
  const { data } = await svc
    .from("card_metrics")
    .select("*")
    .eq("card_id", params.id)
    .maybeSingle();
  return NextResponse.json({ metrics: data });
}
