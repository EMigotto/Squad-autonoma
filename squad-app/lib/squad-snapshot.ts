// ============================================================
// Snapshot do squad: estado vivo para o chat assistente
// ============================================================
import { createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";

export type SnapshotCard = {
  id: string;
  slug: string;
  title: string;
  stage: string;
  status: string;
  app: string | null;
  branch: string | null;
  current_agent: string | null;
  current_model: string | null;
  elapsed_seconds: number | null;
  est_total_seconds_for_stage: number | null;
  est_remaining_seconds: number | null;
};

export type SquadSnapshot = {
  ok: boolean;
  active: boolean;
  project: { name: string; sigla: string } | null;
  generated_at: string;
  running: SnapshotCard[];
  waiting_review: SnapshotCard[];
  queued: SnapshotCard[];
  recent_completions: Array<{
    slug: string;
    title: string;
    stage: string;
    agent: string;
    model: string | null;
    duration_seconds: number;
    cost: number;
  }>;
  today: {
    tokens_in: number;
    tokens_out: number;
    total_cost: number;
    currency: string;
    completed_stages: number;
  };
  avg_stage_seconds: Record<string, number>;
};

function fmtSeconds(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

export async function getSquadSnapshot(userId: string): Promise<SquadSnapshot> {
  const sb = createServiceClient();
  const projectId = await getActiveProjectId(userId);
  if (!projectId) {
    return {
      ok: true,
      active: false,
      project: null,
      generated_at: new Date().toISOString(),
      running: [],
      waiting_review: [],
      queued: [],
      recent_completions: [],
      today: { tokens_in: 0, tokens_out: 0, total_cost: 0, currency: "BRL", completed_stages: 0 },
      avg_stage_seconds: {},
    };
  }

  const { data: project } = await sb
    .from("projects")
    .select("name, sigla")
    .eq("id", projectId)
    .single();

  // Cards não terminais do time ativo + dados da feature
  const { data: rawCards } = await sb
    .from("cards")
    .select(
      "id, stage, status, claude_session_id, feature:features!inner(project_id, slug, title, github_repo, working_branch, environment_id, repository_id)"
    )
    .in("status", ["running", "awaiting_review", "queued"])
    .eq("feature.project_id", projectId);
  const cards = rawCards ?? [];

  // Últimos stage_runs (running e recentes)
  const cardIds = cards.map((c) => c.id);
  const { data: runs } = cardIds.length
    ? await sb
        .from("card_stage_runs")
        .select("id, card_id, stage, status, agent_role, model, started_at, ended_at")
        .in("card_id", cardIds)
        .order("started_at", { ascending: false })
    : { data: [] as any[] };

  // Average duration per stage (project-wide, completed runs)
  const { data: completedRuns } = await sb
    .from("card_stage_runs")
    .select("stage, started_at, ended_at, agent_role, model, total_cost, card:cards!inner(feature:features!inner(slug, title, project_id))")
    .eq("status", "completed")
    .eq("card.feature.project_id", projectId)
    .order("ended_at", { ascending: false })
    .limit(200);

  const avgByStage: Record<string, { sum: number; n: number }> = {};
  for (const r of completedRuns ?? []) {
    if (!r.ended_at || !r.started_at) continue;
    const dur = (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 1000;
    if (dur <= 0 || dur > 24 * 3600) continue; // ignora outliers
    avgByStage[r.stage] = avgByStage[r.stage] || { sum: 0, n: 0 };
    avgByStage[r.stage].sum += dur;
    avgByStage[r.stage].n += 1;
  }
  const avg_stage_seconds: Record<string, number> = {};
  for (const k of Object.keys(avgByStage)) {
    avg_stage_seconds[k] = Math.round(avgByStage[k].sum / avgByStage[k].n);
  }

  // Hoje (00:00 local)
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today_iso = start.toISOString();
  let tokens_in = 0,
    tokens_out = 0,
    total_cost = 0,
    completed_stages = 0;
  for (const r of completedRuns ?? []) {
    if (!r.ended_at || new Date(r.ended_at) < start) continue;
    completed_stages += 1;
    total_cost += Number((r as any).total_cost ?? 0);
  }
  const { data: todayRuns } = await sb
    .from("card_stage_runs")
    .select("input_tokens, output_tokens, total_cost, ended_at, card:cards!inner(feature:features!inner(project_id))")
    .eq("card.feature.project_id", projectId)
    .gte("ended_at", today_iso);
  for (const r of todayRuns ?? []) {
    tokens_in += Number((r as any).input_tokens ?? 0);
    tokens_out += Number((r as any).output_tokens ?? 0);
  }
  const { data: settings } = await sb
    .from("app_settings")
    .select("metrics_currency")
    .eq("project_id", projectId)
    .limit(1)
    .maybeSingle();
  const currency = settings?.metrics_currency ?? "BRL";

  function toSnapshotCard(c: any): SnapshotCard {
    const f = c.feature ?? {};
    const runningRun = (runs ?? []).find(
      (r) => r.card_id === c.id && r.status === "running"
    );
    let elapsed: number | null = null;
    let est_total: number | null = null;
    let est_remaining: number | null = null;
    if (runningRun) {
      elapsed = Math.max(
        0,
        Math.round(
          (Date.now() - new Date(runningRun.started_at).getTime()) / 1000
        )
      );
      est_total = avg_stage_seconds[runningRun.stage] ?? null;
      if (est_total != null) est_remaining = Math.max(0, est_total - elapsed);
    }
    return {
      id: c.id,
      slug: f.slug,
      title: f.title,
      stage: c.stage,
      status: c.status,
      app: f.github_repo ?? null,
      branch: f.working_branch ?? null,
      current_agent: runningRun?.agent_role ?? null,
      current_model: runningRun?.model ?? null,
      elapsed_seconds: elapsed,
      est_total_seconds_for_stage: est_total,
      est_remaining_seconds: est_remaining,
    };
  }

  const running = cards.filter((c) => c.status === "running").map(toSnapshotCard);
  const waiting_review = cards
    .filter((c) => c.status === "awaiting_review")
    .map(toSnapshotCard);
  const queued = cards.filter((c) => c.status === "queued").map(toSnapshotCard);

  const recent_completions =
    (completedRuns ?? []).slice(0, 8).map((r: any) => ({
      slug: r.card?.feature?.slug,
      title: r.card?.feature?.title,
      stage: r.stage,
      agent: r.agent_role,
      model: r.model ?? null,
      duration_seconds:
        r.ended_at && r.started_at
          ? Math.round(
              (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 1000
            )
          : 0,
      cost: Number(r.total_cost ?? 0),
    }));

  return {
    ok: true,
    active: true,
    project: project as any,
    generated_at: new Date().toISOString(),
    running,
    waiting_review,
    queued,
    recent_completions,
    today: { tokens_in, tokens_out, total_cost, currency, completed_stages },
    avg_stage_seconds,
  };
}

// Versão em texto pra entrar como contexto no system prompt do assistente
export function snapshotAsText(s: SquadSnapshot): string {
  if (!s.active) return "(no active team)";
  const lines: string[] = [];
  lines.push(`Team: ${s.project?.name} (${s.project?.sigla})`);
  lines.push(`Snapshot at: ${s.generated_at}`);
  lines.push("");
  lines.push(`=== RUNNING NOW (${s.running.length}) ===`);
  for (const c of s.running) {
    lines.push(
      `- ${c.slug} "${c.title}" — stage=${c.stage}, agent=${c.current_agent ?? "?"} (${c.current_model ?? "?"}), elapsed=${
        c.elapsed_seconds != null ? fmtSeconds(c.elapsed_seconds) : "?"
      }, est_remaining=${
        c.est_remaining_seconds != null ? fmtSeconds(c.est_remaining_seconds) : "n/a"
      }, app=${c.app ?? "?"}, branch=${c.branch ?? "(env-default)"}`
    );
  }
  if (s.waiting_review.length > 0) {
    lines.push("");
    lines.push(`=== AWAITING HUMAN REVIEW (${s.waiting_review.length}) ===`);
    for (const c of s.waiting_review) {
      lines.push(`- ${c.slug} "${c.title}" — stage=${c.stage}`);
    }
  }
  if (s.queued.length > 0) {
    lines.push("");
    lines.push(`=== QUEUED (${s.queued.length}) ===`);
    for (const c of s.queued) {
      lines.push(`- ${c.slug} "${c.title}" — stage=${c.stage}`);
    }
  }
  lines.push("");
  lines.push(`=== TODAY ===`);
  lines.push(
    `Completed stage runs: ${s.today.completed_stages}, tokens in/out: ${s.today.tokens_in}/${s.today.tokens_out}, total cost so far: ${s.today.total_cost.toFixed(2)} ${s.today.currency}`
  );
  if (Object.keys(s.avg_stage_seconds).length > 0) {
    lines.push("");
    lines.push(`=== AVG STAGE DURATION (this team) ===`);
    for (const k of Object.keys(s.avg_stage_seconds)) {
      lines.push(`- ${k}: ${fmtSeconds(s.avg_stage_seconds[k])}`);
    }
  }
  if (s.recent_completions.length > 0) {
    lines.push("");
    lines.push(`=== RECENT COMPLETIONS ===`);
    for (const r of s.recent_completions.slice(0, 6)) {
      lines.push(
        `- ${r.slug} ${r.stage}: ${r.agent} (${r.model ?? "?"}) in ${fmtSeconds(r.duration_seconds)}, cost ${r.cost.toFixed(2)}`
      );
    }
  }
  return lines.join("\n");
}
