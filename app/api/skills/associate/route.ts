import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = await getActiveProjectId(user.id);
  if (!projectId) return NextResponse.json({ error: "nenhum time ativo" }, { status: 400 });

  const body = await req.json();
  const { agent_role, skill_catalog_id, enabled } = body;
  if (!agent_role || !skill_catalog_id)
    return NextResponse.json({ error: "agent_role e skill_catalog_id obrigatórios" }, { status: 400 });

  const svc = createServiceClient();
  if (enabled) {
    const { error } = await svc.from("agent_skills").upsert(
      { project_id: projectId, agent_role, skill_catalog_id, enabled: true },
      { onConflict: "project_id,agent_role,skill_catalog_id" }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    await svc.from("agent_skills")
      .delete()
      .eq("project_id", projectId)
      .eq("agent_role", agent_role)
      .eq("skill_catalog_id", skill_catalog_id);
  }
  return NextResponse.json({ ok: true });
}
