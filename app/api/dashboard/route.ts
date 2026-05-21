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

  return NextResponse.json({ summary, weekly });
}
