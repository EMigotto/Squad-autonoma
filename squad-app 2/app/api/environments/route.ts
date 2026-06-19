import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";

export const runtime = "nodejs";

// GET ?repository_id=X -> ambientes daquela aplicação.
// Sem repository_id -> todos os ambientes das aplicações do time ativo.
export async function GET(req: Request) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const repositoryId = url.searchParams.get("repository_id");
  const svc = createServiceClient();

  if (repositoryId) {
    const { data } = await svc
      .from("environments")
      .select("id, name, branch, is_default, sort_order, repository_id, promotes_to_id")
      .eq("repository_id", repositoryId)
      .order("sort_order", { ascending: true });
    return NextResponse.json({ environments: data ?? [] });
  }

  const projectId = await getActiveProjectId(user.id);
  if (!projectId) return NextResponse.json({ environments: [] });
  const { data } = await svc
    .from("environments")
    .select("id, name, branch, is_default, sort_order, repository_id, promotes_to_id")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });
  return NextResponse.json({ environments: data ?? [] });
}

// POST { repository_id, name, branch } -> cria ambiente (branch) da aplicação
export async function POST(req: Request) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = await getActiveProjectId(user.id);
  if (!projectId) return NextResponse.json({ error: "nenhum time ativo" }, { status: 400 });
  const body = await req.json();
  if (!body.repository_id) return NextResponse.json({ error: "repository_id obrigatório" }, { status: 400 });
  if (!body.name) return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("environments")
    .insert({
      project_id: projectId,
      repository_id: body.repository_id,
      name: body.name,
      branch: body.branch || "main",
      sort_order: body.sort_order ?? 0,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ environment: data });
}
