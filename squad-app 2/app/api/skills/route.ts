import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";

export const runtime = "nodejs";

// Visão do PROJETO: catálogo (globais + custom do projeto), associações globais
// (herdadas) e overrides do projeto, + papéis dos agentes implantados.
export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = await getActiveProjectId(user.id);
  const svc = createServiceClient();

  const { data: skills } = await svc
    .from("skills_catalog").select("*")
    .or(`project_id.is.null,project_id.eq.${projectId}`)
    .order("source");
  const { data: globalAssoc } = await svc
    .from("agent_skills").select("agent_role, skill_catalog_id, enabled").is("project_id", null);
  const { data: projAssoc } = await svc
    .from("agent_skills").select("agent_role, skill_catalog_id, enabled").eq("project_id", projectId);
  const { data: agents } = await svc
    .from("agent_definitions").select("role, name").eq("project_id", projectId).eq("enabled", true);

  return NextResponse.json({
    skills: skills ?? [],
    global_associations: globalAssoc ?? [],
    project_associations: projAssoc ?? [],
    agents: agents ?? [],
  });
}
