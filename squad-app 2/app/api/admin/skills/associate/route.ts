import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isPlatformAdmin(user.id)))
    return NextResponse.json({ error: "apenas administradores" }, { status: 403 });

  const { agent_role, skill_catalog_id, enabled } = await req.json();
  if (!agent_role || !skill_catalog_id)
    return NextResponse.json({ error: "agent_role e skill_catalog_id obrigatórios" }, { status: 400 });

  const svc = createServiceClient();
  if (enabled) {
    // upsert manual (project_id NULL não funciona bem com onConflict)
    const { data: ex } = await svc.from("agent_skills").select("id")
      .is("project_id", null).eq("agent_role", agent_role).eq("skill_catalog_id", skill_catalog_id).maybeSingle();
    if (!ex) {
      const { error } = await svc.from("agent_skills").insert({
        project_id: null, agent_role, skill_catalog_id, enabled: true,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  } else {
    await svc.from("agent_skills").delete()
      .is("project_id", null).eq("agent_role", agent_role).eq("skill_catalog_id", skill_catalog_id);
  }
  return NextResponse.json({ ok: true });
}
