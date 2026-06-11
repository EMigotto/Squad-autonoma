import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createFeature, advanceCard, startStage } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || `feature-${Date.now()}`;
}

// Resolve o projeto/time pelo token de comando do Teams
async function projectByToken(token: string) {
  if (!token) return null;
  const sb = createServiceClient();
  const { data } = await sb
    .from("app_settings")
    .select("project_id")
    .eq("teams_command_token", token)
    .limit(1)
    .maybeSingle();
  return data?.project_id ?? null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = (body.token ?? "").toString();
    const action = (body.action ?? "").toString();
    const projectId = await projectByToken(token);
    if (!projectId) {
      return NextResponse.json({ error: "token inválido" }, { status: 401 });
    }
    const sb = createServiceClient();

    // ---- criar feature ----
    if (action === "create_feature") {
      const title = (body.title ?? "").toString().trim();
      if (!title) return NextResponse.json({ error: "title obrigatório" }, { status: 400 });
      const description = (body.description ?? "").toString();

      // aplicação: usa a informada, senão a primeira do time
      let repositoryId: string | undefined = body.repository_id;
      let githubRepo = "";
      if (!repositoryId) {
        const { data: repo } = await sb
          .from("project_repositories")
          .select("id, github_repo")
          .eq("project_id", projectId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        repositoryId = repo?.id;
        githubRepo = repo?.github_repo ?? "";
      } else {
        const { data: repo } = await sb
          .from("project_repositories")
          .select("github_repo")
          .eq("id", repositoryId)
          .maybeSingle();
        githubRepo = repo?.github_repo ?? "";
      }

      const { feature_id, card_id } = await createFeature({
        slug: slugify(title),
        title,
        description,
        github_repo: githubRepo,
        github_parent_issue: 0,
        project_id: projectId,
        repository_id: repositoryId,
      });

      // inicia a esteira (Discovery) se solicitado (default: sim)
      if (body.start !== false) {
        try { await startStage(card_id); } catch (e) { console.error("[teams] startStage", e); }
      }
      return NextResponse.json({ status: "ok", feature_id, card_id });
    }

    // ---- aprovar / reprovar etapa ----
    if (action === "approve" || action === "reject") {
      const cardId = (body.card_id ?? "").toString();
      if (!cardId) return NextResponse.json({ error: "card_id obrigatório" }, { status: 400 });
      // confirma que o card pertence a esse time
      const { data: card } = await sb
        .from("cards")
        .select("id, feature:features!inner(project_id)")
        .eq("id", cardId)
        .maybeSingle();
      if (!card || (card as any).feature?.project_id !== projectId) {
        return NextResponse.json({ error: "card não pertence a este time" }, { status: 403 });
      }
      const decision = action === "approve" ? "approved" : "rejected";
      const reason = action === "reject" ? (body.reason ?? "Reprovado via Teams") : (body.reason ?? undefined);
      await advanceCard(cardId, decision as any, reason);
      return NextResponse.json({ status: "ok", decision });
    }

    // ---- status do time ----
    if (action === "status") {
      const { data: cards } = await sb
        .from("cards")
        .select("stage, status, feature:features!inner(slug, title, project_id)")
        .in("status", ["running", "awaiting_review", "queued"])
        .eq("feature.project_id", projectId);
      const lines = (cards ?? []).map(
        (c: any) => `• ${c.feature?.slug}: ${c.stage} (${c.status})`
      );
      return NextResponse.json({
        status: "ok",
        active: (cards ?? []).length,
        summary: lines.length ? lines.join("\n") : "nenhum card em andamento.",
      });
    }

    return NextResponse.json({ error: "ação desconhecida" }, { status: 400 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
