import { createServiceClient } from "@/lib/supabase/server";

const GH = "https://api.github.com";

/** Resolve o usuário pelo token MCP. Retorna o id ou null. */
export async function userIdFromMcpToken(token: string): Promise<string | null> {
  if (!token) return null;
  const sb = createServiceClient();
  const { data } = await sb
    .from("user_profiles")
    .select("id")
    .eq("mcp_token", token)
    .maybeSingle();
  return data?.id ?? null;
}

/** Projeto ativo do usuário (fallback: primeiro projeto). */
export async function activeProjectFor(userId: string) {
  const sb = createServiceClient();
  const { data: profile } = await sb
    .from("user_profiles")
    .select("active_project_id")
    .eq("id", userId)
    .maybeSingle();
  let projectId = profile?.active_project_id ?? null;
  if (!projectId) {
    const { data: p } = await sb
      .from("projects")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    projectId = p?.id ?? null;
  }
  if (!projectId) return null;
  const { data: project } = await sb
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  return project;
}

/** Lista cards do projeto, opcionalmente por etapa. */
export async function listCards(projectId: string, stage?: string) {
  const sb = createServiceClient();
  let q = sb
    .from("cards")
    .select(
      "id, stage, status, updated_at, feature:features!inner(slug, title, github_repo, project_id)"
    )
    .eq("feature.project_id", projectId)
    .order("updated_at", { ascending: false });
  if (stage) q = q.eq("stage", stage);
  const { data } = await q;
  return (data ?? []).map((c: any) => ({
    card_id: c.id,
    slug: c.feature?.slug,
    title: c.feature?.title,
    stage: c.stage,
    status: c.status,
    repo: c.feature?.github_repo,
    updated_at: c.updated_at,
  }));
}

/** Bloco de contexto do projeto (mesmo espírito do usado nos kickoffs). */
async function projectContextText(project: any): Promise<string> {
  const sb = createServiceClient();
  const isExisting = project.app_type === "existing";
  let t = `PROJETO: ${project.name} [${project.sigla}]\n`;
  t += `Tipo: ${isExisting ? "aplicação EXISTENTE (legado)" : "aplicação NOVA"}`;
  if (project.app_kind) t += ` · ${project.app_kind}`;
  t += `\n`;
  if (project.tech_stack) t += `Stack: ${project.tech_stack}\n`;
  t += `Arquivo de instruções: ${project.instructions_path || "CLAUDE.md"}\n`;

  const { data: knowledge } = await sb
    .from("project_knowledge")
    .select("title, kind, location, notes")
    .eq("project_id", project.id);
  if (knowledge && knowledge.length) {
    t += `\nBase de conhecimento:\n`;
    for (const k of knowledge)
      t += `- [${k.kind}] ${k.title}${k.location ? ` → ${k.location}` : ""}\n`;
  }

  const { data: repos } = await sb
    .from("project_repositories")
    .select("label, github_repo, depends_on, description")
    .eq("project_id", project.id);
  if (repos && repos.length > 1) {
    t += `\nRepositórios do projeto (multi-repo):\n`;
    for (const r of repos) {
      t += `- ${r.label ?? r.github_repo} (${r.github_repo})`;
      if (r.description) t += ` — ${r.description}`;
      if (r.depends_on) t += ` [depende de: ${r.depends_on}]`;
      t += `\n`;
    }
  }

  const { data: settings } = await sb
    .from("app_settings")
    .select("sensitive_paths, default_base_branch")
    .eq("project_id", project.id)
    .limit(1)
    .maybeSingle();
  if (settings?.sensitive_paths?.trim()) {
    t += `\n⚠ Áreas sensíveis (cuidado redobrado): ${settings.sensitive_paths
      .split(/[\n,]+/)
      .map((s: string) => s.trim())
      .filter(Boolean)
      .join(", ")}\n`;
  }
  return t;
}

/** Busca o conteúdo de um arquivo no GitHub tentando branches prováveis. */
async function fetchDoc(repo: string, path: string, slug: string): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  const branches = [
    `feat/${slug}/spec`,
    `feat/${slug}/plan`,
    `feat/${slug}/integration`,
    "main",
    "master",
  ];
  for (const br of branches) {
    try {
      const res = await fetch(
        `${GH}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(br)}`,
        { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } }
      );
      if (res.ok) {
        const j = await res.json();
        if (j.content) return Buffer.from(j.content, "base64").toString("utf-8");
      }
    } catch {
      /* tenta próxima branch */
    }
  }
  return null;
}

/** Monta o contexto completo de um card para injetar no Claude Code. */
export async function buildCardContext(
  project: any,
  cardRef: string
): Promise<string> {
  const sb = createServiceClient();
  // aceita card_id (uuid) ou slug
  let q = sb
    .from("cards")
    .select("id, stage, status, feature:features!inner(slug, title, description, github_repo, project_id)")
    .eq("feature.project_id", project.id);
  const isUuid = /^[0-9a-f-]{36}$/i.test(cardRef);
  q = isUuid ? q.eq("id", cardRef) : q.eq("feature.slug", cardRef);
  const { data: card } = await q.limit(1).maybeSingle();
  if (!card) return `Card não encontrado: ${cardRef}`;
  const f = (card as any).feature;

  let out = `# Contexto do card\n\n`;
  out += `Feature: ${f.title} (${f.slug})\n`;
  out += `Etapa atual: ${card.stage} · status: ${card.status}\n`;
  out += `Repositório: ${f.github_repo}\n\n`;
  out += `## Descrição\n${f.description ?? "(sem descrição)"}\n\n`;
  out += `## Contexto do projeto\n${await projectContextText(project)}\n`;

  // chunks (se houver)
  const { data: chunks } = await sb
    .from("chunks")
    .select("github_issue_number, title, skill, status")
    .eq("feature_id", (await sb.from("features").select("id").eq("slug", f.slug).eq("project_id", project.id).maybeSingle()).data?.id ?? "")
    .order("github_issue_number", { ascending: true });
  if (chunks && chunks.length) {
    out += `\n## Chunks\n`;
    for (const c of chunks)
      out += `- #${c.github_issue_number} [${c.skill}] ${c.title} — ${c.status}\n`;
  }

  // documentos-chave (inline quando encontrados)
  const docs = [
    ["acceptance-criteria.md", "Critérios de aceite (Gherkin)"],
    ["adr.md", "ADR / SPEC técnica"],
    ["prd.md", "PRD"],
    ["build-order.md", "Ordem de build"],
  ];
  for (const [file, label] of docs) {
    const content = await fetchDoc(f.github_repo, `docs/features/${f.slug}/${file}`, f.slug);
    if (content) {
      const trimmed = content.length > 6000 ? content.slice(0, 6000) + "\n…(truncado)" : content;
      out += `\n## ${label} (docs/features/${f.slug}/${file})\n${trimmed}\n`;
    }
  }

  out += `\n---\nEste contexto é somente leitura (Fase 1). Trabalhe normalmente no Claude Code; ` +
    `a submissão para revisão e o avanço de etapas continuam pela Squad.\n`;
  return out;
}
