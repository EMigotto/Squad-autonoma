import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/admin";

export const runtime = "nodejs";

const isAdmin = isPlatformAdmin;

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = createServiceClient();
  const { data } = await svc.from("app_sso_config").select("*").eq("id", 1).maybeSingle();
  return NextResponse.json({ config: data ?? null, is_admin: await isAdmin(user.id) });
}

export async function PATCH(req: Request) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isAdmin(user.id)))
    return NextResponse.json({ error: "apenas administradores (owners) podem alterar o SSO global" }, { status: 403 });

  const body = await req.json();
  const patch: any = {
    id: 1,
    enabled: !!body.enabled,
    provider: body.provider ?? null,
    domain: body.domain ? String(body.domain).trim().toLowerCase() : null,
    sso_provider_id: body.sso_provider_id ?? null,
    metadata_url: body.metadata_url ?? null,
    enforce: body.enforce !== false,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  };
  const svc = createServiceClient();
  const { error } = await svc.from("app_sso_config").upsert(patch, { onConflict: "id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
