import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { computeFeatureBaseline } from "@/lib/metrics";

export const runtime = "nodejs";

/**
 * Gráficos comparativos manual×squad usam CUMULATIVO (média acumulada / saving
 * running sum). Média de período cai quando entra uma feature menor e confunde
 * a leitura; a média acumulada estabiliza e nunca cai artificialmente.
 */
export async function GET(req: Request) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "all";
  const teamId = url.searchParams.get("team_id");
  const projectId = url.searchParams.get("project_id");
  const granularity = url.searchParams.get("granularity") === "day" ? "day" : "week";

  const svc = createServiceClient();
  let query = svc.from("card_metrics").select("*");
  if (scope === "team" && teamId) query = query.eq("team_id", teamId);
  if (scope === "project" && projectId) query = query.eq("project_id", projectId);
  const { data: rows } = await query;
  const metrics = rows ?? [];
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  const done = metrics.filter((m) => m.is_done);
  const cycleDays = done.map((m) => Number(m.cycle_time_hours) / 24).filter((v) => v > 0);
  const withGates = metrics.filter((m) => m.gates_total > 0);
  const firstPassRate = withGates.length
    ? (withGates.filter((m) => m.first_pass).length / withGates.length) * 100 : 0;
  const coverage = metrics.filter((m) => m.test_coverage_pct != null).map((m) => Number(m.test_coverage_pct));
  const costs = done.map((m) => Number(m.total_cost)).filter((v) => v > 0);

  const summary = {
    total_cards: metrics.length,
    done_cards: done.length,
    avg_cycle_days: +avg(cycleDays).toFixed(1),
    first_pass_rate: +firstPassRate.toFixed(0),
    avg_coverage: +avg(coverage).toFixed(0),
    avg_cost: +avg(costs).toFixed(2),
  };

  const { data: settingsRows } = await svc.from("app_settings").select(
    "project_id, baseline_loc_per_dev_day, baseline_hours_per_day, baseline_dev_hourly, human_hourly_cost, baseline_hours_s, baseline_hours_m, baseline_hours_l, baseline_hours_xl, baseline_default_complexity, baseline_team_size, baseline_cost_mode"
  );
  const cfgBy: Record<string, any> = {};
  for (const s of settingsRows ?? []) cfgBy[s.project_id] = s;

  const bucketKey = (m: any): string | null => {
    if (granularity === "week") return m.iso_week ?? null;
    const c = m.completed_at ?? m.started_at;
    return c ? new Date(c).toISOString().slice(0, 10) : null;
  };

  type B = { label: string; cycle: number[]; cov: number[]; cost: number[]; mCycle: number[]; mCost: number[]; gOk: number; gTot: number; saving: number };
  const byB: Record<string, B> = {};
  let baselineCostTotal = 0, actualCostTotal = 0, baselineDaysTotal = 0, cycleDaysTotal = 0;
  let roiFeatures = 0, locTotal = 0, viaLoc = 0, viaComplexity = 0;
  let mCostAcc = 0, sCostAcc = 0, mDaysAcc = 0, sDaysAcc = 0;

  for (const m of metrics) {
    const k = bucketKey(m);
    if (k && !byB[k]) byB[k] = { label: k, cycle: [], cov: [], cost: [], mCycle: [], mCost: [], gOk: 0, gTot: 0, saving: 0 };
    const b = k ? byB[k] : null;
    if (b) {
      if (m.is_done && Number(m.cycle_time_hours) > 0) b.cycle.push(Number(m.cycle_time_hours) / 24);
      if (m.test_coverage_pct != null) b.cov.push(Number(m.test_coverage_pct));
      if (m.gates_total > 0) { b.gTot++; if (m.first_pass) b.gOk++; }
    }
    if (m.is_done) {
      const bl = computeFeatureBaseline(m, cfgBy[m.project_id] ?? {});
      if (b) { b.cost.push(bl.actual_cost); b.mCycle.push(bl.lifecycle_days); b.mCost.push(bl.manual_cost); b.saving += bl.saving_money; }
      baselineCostTotal += bl.manual_cost; actualCostTotal += bl.actual_cost;
      baselineDaysTotal += bl.lifecycle_days; cycleDaysTotal += bl.actual_days;
      roiFeatures++; mCostAcc += bl.manual_cost; sCostAcc += bl.actual_cost;
      mDaysAcc += bl.lifecycle_days; sDaysAcc += bl.actual_days;
      if (bl.method === "loc") { viaLoc++; locTotal += Number(m.loc_estimate ?? 0); } else viaComplexity++;
    }
  }

  const sorted = Object.values(byB).sort((a, b) => a.label.localeCompare(b.label));
  let cCyS = 0, cCyN = 0, cCoS = 0, cCoN = 0, cMCyS = 0, cMCyN = 0, cMCoS = 0, cMCoN = 0, cSav = 0;
  const weekly = sorted.map((b) => {
    cCyS += b.cycle.reduce((s, v) => s + v, 0); cCyN += b.cycle.length;
    cCoS += b.cost.reduce((s, v) => s + v, 0); cCoN += b.cost.length;
    cMCyS += b.mCycle.reduce((s, v) => s + v, 0); cMCyN += b.mCycle.length;
    cMCoS += b.mCost.reduce((s, v) => s + v, 0); cMCoN += b.mCost.length;
    cSav += b.saving;
    return {
      week: b.label,
      cycle_days: +avg(b.cycle).toFixed(1),
      coverage: +avg(b.cov).toFixed(0),
      cost: +avg(b.cost).toFixed(2),
      manual_cycle_days: +avg(b.mCycle).toFixed(1),
      manual_cost: +avg(b.mCost).toFixed(2),
      saving: +b.saving.toFixed(2),
      first_pass_rate: b.gTot ? +((b.gOk / b.gTot) * 100).toFixed(0) : 0,
      cum_cycle_days: cCyN ? +(cCyS / cCyN).toFixed(1) : 0,
      cum_cost: cCoN ? +(cCoS / cCoN).toFixed(2) : 0,
      cum_manual_cycle_days: cMCyN ? +(cMCyS / cMCyN).toFixed(1) : 0,
      cum_manual_cost: cMCoN ? +(cMCoS / cMCoN).toFixed(2) : 0,
      cum_saving: +cSav.toFixed(2),
    };
  });

  const roi = {
    features_considered: roiFeatures, via_loc: viaLoc, via_complexity: viaComplexity, loc_total: locTotal,
    baseline_cost_total: +baselineCostTotal.toFixed(2),
    actual_cost_total: +actualCostTotal.toFixed(2),
    savings_money: +(baselineCostTotal - actualCostTotal).toFixed(2),
    savings_pct: baselineCostTotal > 0 ? +(((baselineCostTotal - actualCostTotal) / baselineCostTotal) * 100).toFixed(0) : 0,
    baseline_days_total: +baselineDaysTotal.toFixed(1),
    cycle_days_total: +cycleDaysTotal.toFixed(1),
    days_saved: +(baselineDaysTotal - cycleDaysTotal).toFixed(1),
    manual_avg_cost: roiFeatures ? +(mCostAcc / roiFeatures).toFixed(2) : 0,
    squad_avg_cost: roiFeatures ? +(sCostAcc / roiFeatures).toFixed(2) : 0,
    manual_avg_days: roiFeatures ? +(mDaysAcc / roiFeatures).toFixed(1) : 0,
    squad_avg_days: roiFeatures ? +(sDaysAcc / roiFeatures).toFixed(1) : 0,
    speedup: sDaysAcc > 0 ? +((mDaysAcc / sDaysAcc)).toFixed(1) : 0,
    team_size_used: (() => { const r = (settingsRows ?? []).map((x: any) => Number(x.baseline_team_size) || 0).filter((v: number) => v > 0); return r.length ? r[0] : 4; })(),
    cost_mode_used: (() => { const r = (settingsRows ?? []).map((x: any) => x.baseline_cost_mode).filter((v: any) => v); return r[0] ?? "team"; })(),
    granularity,
  };
  const roiWeekly = weekly.map((w) => ({ week: w.week, saving: w.cum_saving }));
  return NextResponse.json({ summary, weekly, roi, roiWeekly, granularity });
}
