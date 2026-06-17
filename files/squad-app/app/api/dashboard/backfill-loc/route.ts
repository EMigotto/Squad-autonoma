import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { estimateFeatureLoc } from "@/lib/metrics";

export const runtime = "nodejs";
export const maxDuration = 300;

// POST: recalcula loc_estimate para features concluídas que ainda não têm LOC.
// Best-effort por feature; degrada graciosamente se o GitHub não responder.
export async function POST(req: Request) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") ?? "all";
    const teamId = url.searchParams.get("team_id");
    const projectId = url.searchParams.get("project_id");
    const force = url.searchParams.get("force") === "1";

    const svc = createServiceClient();
    let q = svc
      .from("card_metrics")
      .select("card_id, feature_id, loc_estimate, is_done, team_id, project_id")
      .eq("is_done", true);
    if (scope === "team" && teamId) q = q.eq("team_id", teamId);
    if (scope === "project" && projectId) q = q.eq("project_id", projectId);

    const { data: rows } = await q;
    const targets = (rows ?? []).filter(
      (r) => r.feature_id && (force || r.loc_estimate == null || Number(r.loc_estimate) <= 0)
    );

    let updated = 0;
    let measured = 0;
    const details: Array<{ feature_id: string; loc: number | null }> = [];
    for (const r of targets) {
      let loc: number | null = null;
      try {
        loc = await estimateFeatureLoc(r.feature_id as string);
      } catch {
        loc = null;
      }
      if (loc != null && loc > 0) {
        await svc
          .from("card_metrics")
          .update({ loc_estimate: loc, updated_at: new Date().toISOString() })
          .eq("card_id", r.card_id);
        updated++;
        measured += loc;
      }
      details.push({ feature_id: r.feature_id as string, loc });
    }

    return NextResponse.json({
      status: "ok",
      candidates: targets.length,
      updated,
      total_loc_measured: measured,
      details,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
