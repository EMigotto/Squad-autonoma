import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("app_settings")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ settings: data });
}

export async function PUT(req: Request) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  // Validação básica
  const allowed = [
    "auto_merge_prs",
    "commit_to_existing_branch",
    "auto_advance_after_pm",
    "auto_advance_after_tl",
    "default_base_branch",
    "notification_slack_webhook",
  ];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in body) patch[k] = body[k];
  }
  patch.updated_by = user.id;
  patch.updated_at = new Date().toISOString();

  const svc = createServiceClient();
  const { error } = await svc
    .from("app_settings")
    .update(patch)
    .eq("id", 1);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: "ok" });
}
