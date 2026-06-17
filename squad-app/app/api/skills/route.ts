import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";
import { beta } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 120;

// Lista o catálogo de skills (globais anthropic + custom do projeto) e as associações.
export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = await getActiveProjectId(user.id);
  const svc = createServiceClient();
  const { data: skills } = await svc
    .from("skills_catalog")
    .select("*")
    .or(`project_id.is.null,project_id.eq.${projectId}`)
    .order("source", { ascending: true });
  const { data: assoc } = await svc
    .from("agent_skills")
    .select("*")
    .eq("project_id", projectId);
  const { data: agents } = await svc
    .from("agent_definitions")
    .select("role, name")
    .eq("project_id", projectId)
    .eq("enabled", true);
  return NextResponse.json({ skills: skills ?? [], associations: assoc ?? [], agents: agents ?? [] });
}

// Upload de uma skill custom: envia o zip ao workspace (Skills API) e cataloga.
export async function POST(req: Request) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const projectId = await getActiveProjectId(user.id);
  if (!projectId) return NextResponse.json({ error: "nenhum time ativo" }, { status: 400 });

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const name = String(form.get("name") ?? "").trim();
  const capability = String(form.get("capability") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  if (!file || !name) return NextResponse.json({ error: "arquivo .zip e nome são obrigatórios" }, { status: 400 });

  let skillId = "";
  let version = "latest";
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    if (beta?.skills?.create) {
      // Caminho SDK (quando disponível)
      const created: any = await beta.skills.create({
        display_title: name,
        ...(description ? { description } : {}),
      });
      skillId = created?.id ?? created?.skill_id ?? "";
      const ver: any = await beta.skills.versions.create(skillId, {
        file: new File([bytes], file.name, { type: "application/zip" }),
      });
      version = ver?.version ?? "latest";
    } else {
      // Fallback REST direto (Skills API, beta header skills-2025-10-02)
      const apiKey = process.env.ANTHROPIC_API_KEY!;
      const createRes = await fetch("https://api.anthropic.com/v1/skills", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "skills-2025-10-02",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ display_title: name, ...(description ? { description } : {}) }),
      });
      if (!createRes.ok) throw new Error(`criar skill: ${createRes.status} ${await createRes.text()}`);
      const created = await createRes.json();
      skillId = created.id ?? created.skill_id;
      const vfd = new FormData();
      vfd.append("file", new Blob([bytes], { type: "application/zip" }), file.name);
      const verRes = await fetch(`https://api.anthropic.com/v1/skills/${skillId}/versions`, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "skills-2025-10-02",
        },
        body: vfd,
      });
      if (!verRes.ok) throw new Error(`criar versão: ${verRes.status} ${await verRes.text()}`);
      const ver = await verRes.json();
      version = ver.version ?? "latest";
    }
  } catch (e) {
    return NextResponse.json(
      { error: `falha ao enviar a skill ao workspace: ${e instanceof Error ? e.message : String(e)}. Verifique a ANTHROPIC_API_KEY e o formato do zip (SKILL.md na raiz).` },
      { status: 502 }
    );
  }

  const svc = createServiceClient();
  const { data: row, error } = await svc.from("skills_catalog").insert({
    project_id: projectId,
    source: "custom",
    skill_id: skillId,
    name,
    description: description || null,
    capability: capability || null,
    version,
    created_by: user.id,
  }).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ skill: row });
}
