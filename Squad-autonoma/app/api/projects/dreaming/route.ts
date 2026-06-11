import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";
import { dreamProject } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = await getActiveProjectId(user.id);
  if (!projectId) return NextResponse.json({ learnings: [] });
  const svc = createServiceClient();
  const { data } = await svc
    .from("project_learnings")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  return NextResponse.json({ learnings: data ?? [] });
}

export async function POST(req: Request) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const projectId = await getActiveProjectId(user.id);
    if (!projectId) return NextResponse.json({ error: "nenhum projeto ativo" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    // adicionar um aprendizado manual
    if (body.action === "add" && body.content) {
      const svc = createServiceClient();
      const { data } = await svc.from("project_learnings").insert({
        project_id: projectId,
        kind: body.kind ?? "insight",
        content: body.content,
      }).select().single();
      return NextResponse.json({ learning: data });
    }

    // disparar dreaming (consolidação)
    const result = await dreamProject(projectId);
    return NextResponse.json({ status: "ok", ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
