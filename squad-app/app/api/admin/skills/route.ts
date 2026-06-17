import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/admin";
import { BUILTIN_ROLES } from "@/lib/agents";
import { beta } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = await isPlatformAdmin(user.id);
  const svc = createServiceClient();
  // skills globais (project_id NULL)
  const { data: skills } = await svc.from("skills_catalog").select("*").is("project_id", null).order("source");
  // associações globais (project_id NULL)
  const { data: assoc } = await svc.from("agent_skills").select("*").is("project_id", null);
  return NextResponse.json({
    skills: skills ?? [],
    associations: assoc ?? [],
    roles: BUILTIN_ROLES,
    is_admin: admin,
  });
}

export async function POST(req: Request) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isPlatformAdmin(user.id)))
    return NextResponse.json({ error: "apenas administradores podem subir skills globais" }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const name = String(form.get("name") ?? "").trim();
  const capability = String(form.get("capability") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  if (!file || !name) return NextResponse.json({ error: "arquivo .zip e nome são obrigatórios" }, { status: 400 });

  let skillId = ""; let version = "latest";
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (beta?.skills?.create) {
      const created: any = await beta.skills.create({ display_title: name, ...(description ? { description } : {}) });
      skillId = created?.id ?? created?.skill_id ?? "";
      const ver: any = await beta.skills.versions.create(skillId, {
        file: new File([bytes], file.name, { type: "application/zip" }),
      });
      version = ver?.version ?? "latest";
    } else {
      const apiKey = process.env.ANTHROPIC_API_KEY!;
      const cr = await fetch("https://api.anthropic.com/v1/skills", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": "skills-2025-10-02", "Content-Type": "application/json" },
        body: JSON.stringify({ display_title: name, ...(description ? { description } : {}) }),
      });
      if (!cr.ok) throw new Error(`criar skill: ${cr.status} ${await cr.text()}`);
      const created = await cr.json();
      skillId = created.id ?? created.skill_id;
      const vfd = new FormData();
      vfd.append("file", new Blob([bytes], { type: "application/zip" }), file.name);
      const vr = await fetch(`https://api.anthropic.com/v1/skills/${skillId}/versions`, {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": "skills-2025-10-02" },
        body: vfd,
      });
      if (!vr.ok) throw new Error(`criar versão: ${vr.status} ${await vr.text()}`);
      version = (await vr.json()).version ?? "latest";
    }
  } catch (e) {
    return NextResponse.json({ error: `falha ao enviar skill: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }

  const svc = createServiceClient();
  const { data: row, error } = await svc.from("skills_catalog").insert({
    project_id: null, source: "custom", skill_id: skillId, name,
    description: description || null, capability: capability || null, version, created_by: user.id,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ skill: row });
}
