import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";

export const runtime = "nodejs";

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = await getActiveProjectId(user.id);
  if (!projectId) return NextResponse.json({ environments: [], applications: [] });
  const svc = createServiceClient();

  const { data: applications } = await svc
    .from("project_repositories")
    .select("id, label, github_repo, default_base_branch")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  const { data: envs } = await svc
    .from("environments")
    .select("id, name, is_default, sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });

  const ids = (envs ?? []).map((e) => e.id);
  let branches: any[] = [];
  if (ids.length) {
    const { data: b } = await svc
      .from("environment_branches")
      .select("environment_id, repository_id, branch")
      .in("environment_id", ids);
    branches = b ?? [];
  }

  const environments = (envs ?? []).map((e) => ({
    ...e,
    branches: branches.filter((b) => b.environment_id === e.id),
  }));
  return NextResponse.json({ environments, applications: applications ?? [] });
}

export async function POST(req: Request) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = await getActiveProjectId(user.id);
  if (!projectId) return NextResponse.json({ error: "nenhum time ativo" }, { status: 400 });
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "nome obrigatório" }, { status: 400 });
  const svc = createServiceClient();

  const { data: env, error } = await svc
    .from("environments")
    .insert({ project_id: projectId, name: body.name, sort_order: body.sort_order ?? 0 })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // seed: cada aplicação aponta para sua branch base por padrão
  const { data: apps } = await svc
    .from("project_repositories")
    .select("id, default_base_branch")
    .eq("project_id", projectId);
  for (const a of apps ?? []) {
    await svc.from("environment_branches").insert({
      environment_id: env.id,
      repository_id: a.id,
      branch: a.default_base_branch ?? "main",
    });
  }
  return NextResponse.json({ environment: env });
}
