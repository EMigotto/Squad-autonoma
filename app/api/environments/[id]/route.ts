import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Define a branch de uma aplicação dentro do ambiente
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  if (!body.repository_id) return NextResponse.json({ error: "repository_id obrigatório" }, { status: 400 });
  const svc = createServiceClient();
  const { error } = await svc.from("environment_branches").upsert(
    { environment_id: params.id, repository_id: body.repository_id, branch: body.branch || "main" },
    { onConflict: "environment_id,repository_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ status: "ok" });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = createServiceClient();
  await svc.from("environments").delete().eq("id", params.id);
  return NextResponse.json({ status: "deleted" });
}
