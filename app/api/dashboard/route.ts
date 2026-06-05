import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { computeFeatureBaseline } from "@/lib/metrics";

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
  const granularity =
    url.searchParams.get("granularity") === "day" ? "day" : "week";

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

  // ---- parâmetros de baseline por projeto (com TEAM mode) ----
  const { data: settingsRows } = await svc
    .from("app_settings")
    .select(
      "project_id, baseline_loc_per_dev_day, baseline_hours_per_day, baseline_dev_hourly, human_hourly_cost, baseline_hours_s, baseline_hours_m, baseline_hours_l, baseline_hours_xl, baseline_default_complexity, baseline_team_size, baseline_cost_mode"
    );
  const settingsByProject: Record<string, any> = {};
  for (const s of settingsRows ?? []) settingsByProject[s.project_id] = s;

  const bucketKeyOf = (m: any): string | null => {
    if (granularity === "week") return m.iso_week ?? null;
    const c = m.completed_at ?? m.started_at;
    if (!c) return null;
    return new Date(c).toISOString().slice(0, 10);
  };

  // ---- evolução por bucket (semana ou dia) + comparativo manual x squad ----
  type Bucket = {
    label: string;
    cycle: number[];
    cov: number[];
    cost: number[];
    manualCycle: number[];
    manualCost: number[];
    gatesOk: number;
    gatesTot: number;
    saving: number;
  };
  const byBucket: Record<string, Bucket> = {};
  let baselineCostTotal = 0;
  let actualCostTotal = 0;
  let baselineDaysTotal = 0;
  let cycleDaysTotal = 0;
  let roiFeatures = 0;
  let locTotal = 0;
  let viaLoc = 0;
  let viaComplexity = 0;
  let manualAvgCostAcc = 0;
  let squadAvgCostAcc = 0;
  let manualAvgDaysAcc = 0;
  let squadAvgDaysAcc = 0;

  for (const m of metrics) {
    const k = bucketKeyOf(m);
    if (k && !byBucket[k])
      byBucket[k] = {
        label: k,
        cycle: [],
        cov: [],
        cost: [],
        manualCycle: [],
        manualCost: [],
        gatesOk: 0,
        gatesTot: 0,
        saving: 0,
      };
    const b = k ? byBucket[k] : null;
    if (b) {
      if (m.is_done && Number(m.cycle_time_hours) > 0)
        b.cycle.push(Number(m.cycle_time_hours) / 24);
      if (m.test_coverage_pct != null) b.cov.push(Number(m.test_coverage_pct));
      if (m.gates_total > 0) {
        b.gatesTot++;
        if (m.first_pass) b.gatesOk++;
      }
    }

    if (m.is_done) {
      const cfg = settingsByProject[m.project_id] ?? {};
      const bl = computeFeatureBaseline(m, cfg);
      if (b) {
        b.cost.push(bl.actual_cost);
        b.manualCycle.push(bl.lifecycle_days);
        b.manualCost.push(bl.manual_cost);
        b.saving += bl.saving_money;
      }
      baselineCostTotal += bl.manual_cost;
      actualCostTotal += bl.actual_cost;
      baselineDaysTotal += bl.lifecycle_days;
      cycleDaysTotal += bl.actual_days;
      roiFeatures++;
      manualAvgCostAcc += bl.manual_cost;
      squadAvgCostAcc += bl.actual_cost;
      manualAvgDaysAcc += bl.lifecycle_days;
      squadAvgDaysAcc += bl.actual_days;
      if (bl.method === "loc") {
        viaLoc++;
        locTotal += Number(m.loc_estimate ?? 0);
      } else viaComplexity++;
    }
  }

  const weekly = Object.values(byBucket)
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((b) => ({
      week: b.label,
      cycle_days: +avg(b.cycle).toFixed(1),
      coverage: +avg(b.cov).toFixed(0),
      cost: +avg(b.cost).toFixed(2),
      manual_cycle_days: +avg(b.manualCycle).toFixed(1),
      manual_cost: +avg(b.manualCost).toFixed(2),
      saving: +b.saving.toFixed(2),
      first_pass_rate: b.gatesTot ? +((b.gatesOk / b.gatesTot) * 100).toFixed(0) : 0,
    }));

  const roi = {
    features_considered: roiFeatures,
    via_loc: viaLoc,
    via_complexity: viaComplexity,
    loc_total: locTotal,
    baseline_cost_total: +baselineCostTotal.toFixed(2),
    actual_cost_total: +actualCostTotal.toFixed(2),
    savings_money: +(baselineCostTotal - actualCostTotal).toFixed(2),
    savings_pct:
      baselineCostTotal > 0
        ? +(((baselineCostTotal - actualCostTotal) / baselineCostTotal) * 100).toFixed(0)
        : 0,
    baseline_days_total: +baselineDaysTotal.toFixed(1),
    cycle_days_total: +cycleDaysTotal.toFixed(1),
    days_saved: +(baselineDaysTotal - cycleDaysTotal).toFixed(1),
    manual_avg_cost: roiFeatures > 0 ? +(manualAvgCostAcc / roiFeatures).toFixed(2) : 0,
    squad_avg_cost: roiFeatures > 0 ? +(squadAvgCostAcc / roiFeatures).toFixed(2) : 0,
    manual_avg_days: roiFeatures > 0 ? +(manualAvgDaysAcc / roiFeatures).toFixed(1) : 0,
    squad_avg_days: roiFeatures > 0 ? +(squadAvgDaysAcc / roiFeatures).toFixed(1) : 0,
    team_size_used: (() => {
      const rs = (settingsRows ?? [])
        .map((r: any) => Number(r.baseline_team_size) || 0)
        .filter((v: number) => v > 0);
      return rs.length ? rs[0] : 4;
    })(),
    cost_mode_used: (() => {
      const rs = (settingsRows ?? [])
        .map((r: any) => r.baseline_cost_mode)
        .filter((v: any) => v);
      return rs[0] ?? "team";
    })(),
    granularity,
  };
  const roiWeekly = weekly.map((w) => ({ week: w.week, saving: w.saving }));

  return NextResponse.json({ summary, weekly, roi, roiWeekly, granularity });
}
