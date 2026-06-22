import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";
import { createFeature } from "@/lib/orchestrator";
import { anthropic } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Cria MÚLTIPLAS features a partir de um PRD.md fornecido na entrada.
 * 1. Interpreta o PRD com Claude e desmembra em features independentes.
 * 2. Cria cada feature em Discovery (mesma aplicação/ambiente/branches).
 * 3. Injeta na sessão de cada uma: o PRD original como SEMENTE (o PM salva em
 *    docs/features/<slug>/prd.md e enriquece, em vez de criar do zero) e a
 *    referência aos protótipos (anexados a todas).
 */
export async function POST(req: Request) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    const prd = String(body.prd_content ?? "").trim();
    if (!prd) return NextResponse.json({ error: "prd_content obrigatório" }, { status: 400 });

    const projectId = await getActiveProjectId(user.id);
    if (!projectId) return NextResponse.json({ error: "nenhum time ativo" }, { status: 400 });

    // Resolve o repositório (igual ao /api/features): repository_id informado →
    // primeiro repo do projeto → github_repo do projeto. O form NÃO envia
    // github_repo preenchido (o repo é escolhido por repository_id).
    const svc = createServiceClient();
    let githubRepo: string | undefined;
    let repositoryId: string | undefined = body.repository_id;
    if (repositoryId) {
      const { data: repo } = await svc
        .from("project_repositories")
        .select("github_repo")
        .eq("id", repositoryId)
        .maybeSingle();
      githubRepo = repo?.github_repo;
    } else {
      const { data: repo } = await svc
        .from("project_repositories")
        .select("id, github_repo")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (repo) { repositoryId = repo.id; githubRepo = repo.github_repo; }
    }
    if (!githubRepo) {
      const { data: project } = await svc
        .from("projects").select("github_repo").eq("id", projectId).maybeSingle();
      githubRepo = project?.github_repo ?? body.github_repo;
    }
    if (!githubRepo) {
      return NextResponse.json({ error: "projeto sem repositório configurado" }, { status: 400 });
    }

    // 1) Desmembra o PRD em features via Claude (JSON estrito)
    const resp: any = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content:
          `Desmembre o PRD abaixo em features INDEPENDENTES e implementáveis (mín 1, máx 8). ` +
          `Responda APENAS um array JSON, sem markdown: ` +
          `[{"slug":"kebab-ascii","title":"...","description":"resumo do escopo desta feature em pt-BR (max 800 chars)"}]\n\n` +
          `PRD:\n${prd.slice(0, 30000)}`,
      }],
    });
    const raw = (resp.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    let items: Array<{ slug: string; title: string; description: string }> = [];
    try { items = JSON.parse(raw.replace(/```json|```/g, "").trim()); } catch {
      return NextResponse.json({ error: "falha ao interpretar o PRD (JSON inválido do modelo)" }, { status: 502 });
    }
    if (!Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: "o PRD não gerou features" }, { status: 422 });

    // 2-3) Cria cada feature e injeta a semente do PRD na sessão de Discovery
    const created: any[] = [];
    const errors: string[] = [];
    for (const it of items.slice(0, 8)) {
      try {
        const safeSlug = String(it.slug || it.title || "feature")
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
          .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "feature";
        const { feature_id, card_id } = await createFeature({
          slug: safeSlug,
          title: it.title || safeSlug,
          description: it.description || "(derivado do PRD)",
          github_repo: githubRepo!,
          github_parent_issue: Number(body.github_parent_issue) || 0,
          project_id: projectId,
          repository_id: repositoryId,
          environment_id: body.environment_id,
          working_branch: body.working_branch,
          source_branch: body.source_branch,
          created_by: user.id,
          functionality_type: body.functionality_type ?? undefined,
          frontend_path: body.frontend_path ?? undefined,
          backend_path: body.backend_path ?? undefined,
          backend_repository_id: body.backend_repository_id ?? undefined,
          backend_branch: body.backend_branch ?? undefined,
        });
        // semente: grava o PRD na feature — o startStage injeta no kickoff do Discovery
        await svc.from("features").update({ seed_prd: prd }).eq("id", feature_id);
        created.push({ feature_id, card_id, slug: safeSlug, title: it.title });
      } catch (e) {
        errors.push(`${it.slug ?? it.title}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (created.length === 0) {
      return NextResponse.json(
        { error: `nenhuma feature criada. ${errors.join(" | ")}` },
        { status: 500 }
      );
    }
    return NextResponse.json({ created, count: created.length, errors });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
