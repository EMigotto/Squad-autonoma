import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";
import { onboardProject } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const projectId = await getActiveProjectId(user.id);
    if (!projectId) return NextResponse.json({ error: "nenhum projeto ativo" }, { status: 400 });
    const result = await onboardProject(projectId);
    return NextResponse.json({ status: "ok", ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
