import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Agrega métricas para o dashboard.
 * Query params:
 *   - scope: "all" | "team" | "project"
 *   - team_id, project_id (conforme scope)
 */
export async function GET(req: Request) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "all";
  const teamId = url.searchParams.get("team_id");
  const projectId = url.searchParams.get("project_id");

  const svc = createServiceClient();
  let query = svc.from("card_metrics").select("*");
  if (scope === "team" && teamId) query = query.eq("team_id", teamId);
  if (scope === "project" && projectId) query = query.eq("project_id", projectId);

  const { data: rows } = await query;
  const metrics = rows ?? [];

  // ---- KPIs globais (cards concluídos) ----
  const done = metrics.filter((m) => m.is_done);
  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const cycleDays = done
    .map((m) => Number(m.cycle_time_hours) / 24)
    .filter((v) => v > 0);
  const withGates = metrics.filter((m) => m.gates_total > 0);
  const firstPassRate = withGates.length
    ? (withGates.filter((m) => m.first_pass).length / withGates.length) * 100
    : 0;
  const coverage = metrics
    .filter((m) => m.test_coverage_pct != null)
    .map((m) => Number(m.test_coverage_pct));
  const costs = done
    .map((m) => Number(m.total_cost))
    .filter((v) => v > 0);

  const summary = {
    total_cards: metrics.length,
    done_cards: done.length,
    avg_cycle_days: +avg(cycleDays).toFixed(1),
    first_pass_rate: +firstPassRate.toFixed(0),
    avg_coverage: +avg(coverage).toFixed(0),
    avg_cost: +avg(costs).toFixed(2),
  };

  // ---- evolução semana a semana ----
  const byWeek: Record<string, any> = {};
  for (const m of metrics) {
    const wk = m.iso_week;
    if (!wk) continue;
    if (!byWeek[wk])
      byWeek[wk] = { week: wk, cycle: [], cov: [], cost: [], gatesOk: 0, gatesTot: 0 };
    if (m.is_done && Number(m.cycle_time_hours) > 0)
      byWeek[wk].cycle.push(Number(m.cycle_time_hours) / 24);
    if (m.test_coverage_pct != null) byWeek[wk].cov.push(Number(m.test_coverage_pct));
    if (m.is_done && Number(m.total_cost) > 0) byWeek[wk].cost.push(Number(m.total_cost));
    if (m.gates_total > 0) {
      byWeek[wk].gatesTot++;
      if (m.first_pass) byWeek[wk].gatesOk++;
    }
  }
  const weekly = Object.values(byWeek)
    .sort((a: any, b: any) => a.week.localeCompare(b.week))
    .map((w: any) => ({
      week: w.week,
      cycle_days: +avg(w.cycle).toFixed(1),
      coverage: +avg(w.cov).toFixed(0),
      cost: +avg(w.cost).toFixed(2),
      first_pass_rate: w.gatesTot ? +((w.gatesOk / w.gatesTot) * 100).toFixed(0) : 0,
    }));

  // ---- ROI / baseline humano ----
  // Carrega parâmetros por projeto (LOC/dia, horas/dia, custo dev) com defaults.
  const { data: settingsRows } = await svc
    .from("app_settings")
    .select(
      "project_id, baseline_loc_per_dev_day, baseline_hours_per_day, baseline_dev_hourly, human_hourly_cost"
    );
  const settingsByProject: Record<string, any> = {};
  for (const s of settingsRows ?? []) settingsByProject[s.project_id] = s;

  const roiByWeek: Record<string, number> = {};
  let baselineCostTotal = 0;
  let actualCostTotal = 0;
  let baselineDaysTotal = 0;
  let cycleDaysTotal = 0;
  let roiFeatures = 0;
  let locTotal = 0;

  for (const m of done) {
    const loc = Number(m.loc_estimate ?? 0);
    if (!loc || loc <= 0) continue;
    const cfg = settingsByProject[m.project_id] ?? {};
    const locPerDay = Number(cfg.baseline_loc_per_dev_day) || 50;
    const hoursPerDay = Number(cfg.baseline_hours_per_day) || 6;
    const devHourly =
      Number(cfg.baseline_dev_hourly) > 0
        ? Number(cfg.baseline_dev_hourly)
        : Number(cfg.human_hourly_cost) || 120;

    const baselineDays = loc / locPerDay;
    const baselineHours = baselineDays * hoursPerDay;
    const baselineCost = baselineHours * devHourly;
    const actualCost = Number(m.total_cost) || 0;
    const cycleDays = Number(m.cycle_time_hours) / 24;

    baselineCostTotal += baselineCost;
    actualCostTotal += actualCost;
    baselineDaysTotal += baselineDays;
    cycleDaysTotal += cycleDays > 0 ? cycleDays : 0;
    locTotal += loc;
    roiFeatures++;

    const wk = m.iso_week;
    if (wk) roiByWeek[wk] = (roiByWeek[wk] ?? 0) + (baselineCost - actualCost);
  }

  const roi = {
    features_considered: roiFeatures,
    loc_total: locTotal,
    baseline_cost_total: +baselineCostTotal.toFixed(2),
    actual_cost_total: +actualCostTotal.toFixed(2),
    savings_money: +(baselineCostTotal - actualCostTotal).toFixed(2),
    savings_pct: baselineCostTotal > 0
      ? +(((baselineCostTotal - actualCostTotal) / baselineCostTotal) * 100).toFixed(0)
      : 0,
    baseline_days_total: +baselineDaysTotal.toFixed(1),
    cycle_days_total: +cycleDaysTotal.toFixed(1),
    days_saved: +(baselineDaysTotal - cycleDaysTotal).toFixed(1),
  };
  const roiWeekly = Object.entries(roiByWeek)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, saving]) => ({ week, saving: +saving.toFixed(2) }));

  return NextResponse.json({ summary, weekly, roi, roiWeekly });
}
