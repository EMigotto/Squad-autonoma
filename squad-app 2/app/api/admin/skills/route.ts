import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/admin";
import { BUILTIN_ROLES } from "@/lib/agents";

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
    // A Skills API cria a skill JÁ com os arquivos, em um único POST multipart.
    // O campo correto é files[] (não "file"), e o create aceita o zip direto.
    const apiKey = process.env.ANTHROPIC_API_KEY!;
    const fd = new FormData();
    fd.append("display_title", name);
    if (description) fd.append("description", description);
    fd.append("files[]", new Blob([bytes], { type: "application/zip" }), file.name);

    const cr = await fetch("https://api.anthropic.com/v1/skills", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "skills-2025-10-02",
        // sem Content-Type: o fetch define o boundary do multipart sozinho
      },
      body: fd,
    });
    if (!cr.ok) throw new Error(`${cr.status} ${await cr.text()}`);
    const created = await cr.json();
    skillId = created.id ?? created.skill_id ?? "";
    version = created.latest_version ?? created.version ?? "latest";
  } catch (e) {
    return NextResponse.json(
      { error: `falha ao enviar skill: ${e instanceof Error ? e.message : String(e)}. ` +
               `Garanta que o .zip contém uma pasta raiz com o mesmo nome da skill e um SKILL.md dentro ` +
               `(ex.: ${name}/SKILL.md), e que o campo "name:" no SKILL.md é igual ao nome da pasta.` },
      { status: 502 }
    );
  }

  const svc = createServiceClient();
  const { data: row, error } = await svc.from("skills_catalog").insert({
    project_id: null, source: "custom", skill_id: skillId, name,
    description: description || null, capability: capability || null, version, created_by: user.id,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ skill: row });
}
