import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";
import { provisionTeamAgents } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = createServiceClient();
  const { data: projects } = await svc
    .from("projects")
    .select("*, team:teams(id, name)")
    .order("created_at", { ascending: true });

  const activeProjectId = await getActiveProjectId(user.id);

  return NextResponse.json({
    projects: projects ?? [],
    active_project_id: activeProjectId,
  });
}

export async function POST(req: Request) {
  try {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    if (!body.name || !body.sigla) {
      return NextResponse.json(
        { error: "name e sigla são obrigatórios" },
        { status: 400 }
      );
    }

    const svc = createServiceClient();

    // Resolve o time: usa o team_id do body, ou o primeiro time do usuário,
    // ou cria um time novo se o usuário não tem nenhum.
    let teamId = body.team_id;
    if (!teamId) {
      const { data: membership } = await svc
        .from("team_members")
        .select("team_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      teamId = membership?.team_id;
    }
    if (!teamId) {
      const { data: team } = await svc
        .from("teams")
        .insert({ name: body.team_name ?? "Meu Time", created_by: user.id })
        .select("id")
        .single();
      teamId = team!.id;
      await svc
        .from("team_members")
        .insert({ team_id: teamId, user_id: user.id, role: "owner" });
    }

    const { data: project, error } = await svc
      .from("projects")
      .insert({
        team_id: teamId,
        name: body.name,
        sigla: body.sigla.toUpperCase().slice(0, 10),
        github_repo: body.github_repo ?? null,
        default_base_branch: body.default_base_branch ?? "main",
        app_type: body.app_type === "existing" ? "existing" : "new",
        app_kind: body.app_kind ?? null,
        tech_stack: body.tech_stack ?? null,
        instructions_path: body.instructions_path || "CLAUDE.md",
        created_by: user.id,
      })
      .select()
      .single();
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    // Cria app_settings default pro projeto
    await svc
      .from("app_settings")
      .insert({ project_id: project.id, default_base_branch: "main" });

    // Dispara a criação dos agentes DESTE time (com o sufixo da sigla no nome).
    // Best-effort: se falhar, o time é criado mesmo assim e o usuário pode
    // rodar /admin/setup depois.
    let agents_provisioned = false;
    try {
      await provisionTeamAgents(project.id);
      agents_provisioned = true;
    } catch (e) {
      console.error("[projects] provisionTeamAgents falhou", e);
    }

    return NextResponse.json({ project, agents_provisioned });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
