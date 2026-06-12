import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";
import { createFeature } from "@/lib/orchestrator";
import { createServiceClient } from "@/lib/supabase/server";
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
    if (!body.github_repo) return NextResponse.json({ error: "github_repo obrigatório" }, { status: 400 });

    const projectId = await getActiveProjectId(user.id);
    if (!projectId) return NextResponse.json({ error: "nenhum time ativo" }, { status: 400 });

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
    for (const it of items.slice(0, 8)) {
      const { feature_id, card_id } = await createFeature({
        slug: it.slug,
        title: it.title,
        description: it.description,
        github_repo: body.github_repo,
        github_parent_issue: Number(body.github_parent_issue) || 0,
        project_id: projectId,
        repository_id: body.repository_id,
        environment_id: body.environment_id,
        working_branch: body.working_branch,
        source_branch: body.source_branch,
        created_by: user.id,
      });
      // semente: grava o PRD na feature — o startStage injeta no kickoff do Discovery
      await createServiceClient().from("features").update({ seed_prd: prd }).eq("id", feature_id);
      created.push({ feature_id, card_id, slug: it.slug, title: it.title });
    }
    return NextResponse.json({ created, count: created.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
