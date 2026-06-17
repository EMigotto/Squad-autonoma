import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";
import { createFeature } from "@/lib/orchestrator";
import { normalizeGithubRepo } from "@/lib/github";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Reporta um BUG: cria uma feature do tipo "bug" no Backlog, abre uma issue no
 * GitHub com o contexto do erro, e vincula as duas. Ao concluir o card (done),
 * a issue é fechada automaticamente (ver webhook/advance).
 * Body: { title, error, file?, repro?, repository_id?, environment_id? }
 */
export async function POST(req: Request) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    const title = String(body.title ?? "").trim();
    const errorText = String(body.error ?? "").trim();
    if (!title) return NextResponse.json({ error: "título obrigatório" }, { status: 400 });
    if (!errorText) return NextResponse.json({ error: "cole o erro/stack" }, { status: 400 });

    const projectId = await getActiveProjectId(user.id);
    if (!projectId) return NextResponse.json({ error: "nenhum time ativo" }, { status: 400 });

    const svc = createServiceClient();
    // resolve repositório (igual ao from-prd)
    let githubRepo: string | undefined;
    let repositoryId: string | undefined = body.repository_id;
    if (repositoryId) {
      const { data: r } = await svc.from("project_repositories").select("github_repo").eq("id", repositoryId).maybeSingle();
      githubRepo = r?.github_repo;
    } else {
      const { data: r } = await svc.from("project_repositories")
        .select("id, github_repo").eq("project_id", projectId)
        .order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (r) { repositoryId = r.id; githubRepo = r.github_repo; }
    }
    if (!githubRepo) {
      const { data: p } = await svc.from("projects").select("github_repo").eq("id", projectId).maybeSingle();
      githubRepo = p?.github_repo;
    }
    if (!githubRepo) return NextResponse.json({ error: "projeto sem repositório" }, { status: 400 });
    const repo = normalizeGithubRepo(githubRepo);

    const slug = `bug-${title.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)}`;

    const bugContext = {
      error: errorText,
      file: body.file ? String(body.file).trim() : null,
      repro: body.repro ? String(body.repro).trim() : null,
      reported_by: user.email ?? user.id,
      reported_at: new Date().toISOString(),
    };

    // descrição da feature carrega o contexto do bug (vira semente pro agente)
    const description =
      `🐞 BUG reportado.\n\n` +
      `**Erro / stack:**\n\`\`\`\n${errorText.slice(0, 4000)}\n\`\`\`\n` +
      (bugContext.file ? `\n**Arquivo:** \`${bugContext.file}\`\n` : "") +
      (bugContext.repro ? `\n**Como reproduzir:**\n${bugContext.repro.slice(0, 1000)}\n` : "") +
      `\nObjetivo: corrigir o erro acima sem quebrar o que já funciona, seguindo os padrões do repositório.`;

    // 1) cria a issue no GitHub
    let issueNumber: number | null = null;
    let issueUrl: string | null = null;
    const token = process.env.GITHUB_TOKEN;
    if (token) {
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
          method: "POST",
          headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
          body: JSON.stringify({
            title: `🐞 ${title}`,
            body: description,
            labels: ["bug", "via:vaibe"],
          }),
        });
        if (res.ok) {
          const issue = await res.json();
          issueNumber = issue.number;
          issueUrl = issue.html_url;
        }
      } catch (e) { console.error("[bug] criar issue falhou", e); }
    }

    // 2) cria a feature do tipo bug no Backlog
    const { feature_id, card_id } = await createFeature({
      slug,
      title: `🐞 ${title}`,
      description,
      github_repo: githubRepo,
      github_parent_issue: issueNumber ?? 0,
      project_id: projectId,
      repository_id: repositoryId,
      environment_id: body.environment_id,
      created_by: user.id,
    });

    // 3) marca tipo bug + contexto + vínculo da issue
    await svc.from("features").update({
      feature_type: "bug",
      bug_context: bugContext,
      github_issue_number: issueNumber,
    }).eq("id", feature_id);

    return NextResponse.json({ feature_id, card_id, issue_number: issueNumber, issue_url: issueUrl });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
