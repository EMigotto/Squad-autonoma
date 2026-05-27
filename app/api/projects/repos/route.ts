import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";

export const runtime = "nodejs";

// Lista os repositórios do projeto ativo
export async function GET() {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const projectId = await getActiveProjectId(user.id);
  if (!projectId) return NextResponse.json({ repos: [] });

  const svc = createServiceClient();
  const { data: repos } = await svc
    .from("project_repositories")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  return NextResponse.json({ repos: repos ?? [], project_id: projectId });
}

// Adiciona um repositório ao projeto ativo
export async function POST(req: Request) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const projectId = await getActiveProjectId(user.id);
  if (!projectId)
    return NextResponse.json({ error: "nenhum projeto ativo" }, { status: 400 });

  const body = await req.json();
  if (!body.github_repo) {
    return NextResponse.json({ error: "github_repo obrigatório" }, { status: 400 });
  }

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("project_repositories")
    .insert({
      project_id: projectId,
      github_repo: body.github_repo,
      label: body.label || body.github_repo,
      default_base_branch: body.default_base_branch || "main",
      description: body.description || null,
      depends_on: body.depends_on || null,
      app_type: body.app_type === "existing" ? "existing" : "new",
      app_kind: body.app_kind || null,
      tech_stack: body.tech_stack || null,
      instructions_path: body.instructions_path || "CLAUDE.md",
    })
    .select()
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ repo: data });
}

// Remove um repositório
export async function DELETE(req: Request) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const repoId = url.searchParams.get("id");
  if (!repoId)
    return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const projectId = await getActiveProjectId(user.id);
  const svc = createServiceClient();

  // Não deixa remover se há features usando esse repo
  const { count } = await svc
    .from("features")
    .select("id", { count: "exact", head: true })
    .eq("repository_id", repoId);
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      { error: `há ${count} feature(s) usando este repositório` },
      { status: 409 }
    );
  }

  await svc
    .from("project_repositories")
    .delete()
    .eq("id", repoId)
    .eq("project_id", projectId);

  return NextResponse.json({ status: "deleted" });
}
