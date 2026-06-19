import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Atualiza nome/branch do ambiente
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const patch: any = {};
  if ("name" in body) patch.name = body.name;
  if ("branch" in body) patch.branch = body.branch || "main";
  if ("promotes_to_id" in body)
    patch.promotes_to_id = body.promotes_to_id || null;
  const svc = createServiceClient();
  const { error } = await svc.from("environments").update(patch).eq("id", params.id);
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
