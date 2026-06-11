import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = createServiceClient();
  const { data } = await svc
    .from("user_profiles")
    .select("mcp_token")
    .eq("id", user.id)
    .maybeSingle();
  return NextResponse.json({ has_token: !!data?.mcp_token, token: data?.mcp_token ?? null });
}

export async function POST() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = "sqd_" + randomBytes(24).toString("hex");
  const svc = createServiceClient();
  const { error } = await svc
    .from("user_profiles")
    .update({ mcp_token: token })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ token });
}

export async function DELETE() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = createServiceClient();
  await svc.from("user_profiles").update({ mcp_token: null }).eq("id", user.id);
  return NextResponse.json({ status: "revoked" });
}
