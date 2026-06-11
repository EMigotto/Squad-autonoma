import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";

export const runtime = "nodejs";

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = await getActiveProjectId(user.id);
  if (!projectId) return NextResponse.json({ knowledge: [] });
  const svc = createServiceClient();
  const { data } = await svc
    .from("project_knowledge")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  return NextResponse.json({ knowledge: data ?? [] });
}

export async function POST(req: Request) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = await getActiveProjectId(user.id);
  if (!projectId) return NextResponse.json({ error: "nenhum projeto ativo" }, { status: 400 });
  const body = await req.json();
  if (!body.title) return NextResponse.json({ error: "title obrigatório" }, { status: 400 });
  const svc = createServiceClient();
  const { data, error } = await svc.from("project_knowledge").insert({
    project_id: projectId,
    title: body.title,
    kind: body.kind ?? "doc",
    location: body.location ?? null,
    notes: body.notes ?? null,
    created_by: user.id,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ item: data });
}
