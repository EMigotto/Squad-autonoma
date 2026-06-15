import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";

export const runtime = "nodejs";

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = await getActiveProjectId(user.id);
  if (!projectId) return NextResponse.json({ config: null });
  const svc = createServiceClient();
  const { data } = await svc.from("sso_config").select("*").eq("project_id", projectId).maybeSingle();
  // nunca expõe nada sensível além do necessário
  return NextResponse.json({ config: data ?? null });
}

export async function PATCH(req: Request) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = await getActiveProjectId(user.id);
  if (!projectId) return NextResponse.json({ error: "nenhum time ativo" }, { status: 400 });

  const body = await req.json();
  const patch: any = {
    project_id: projectId,
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
  const { error } = await svc.from("sso_config").upsert(patch, { onConflict: "project_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
