import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";
import { forceSyncSession } from "@/lib/orchestrator";
import { recomputeCardMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Sincroniza proativamente todos os cards 'running' do projeto ativo:
 * consulta o status real de cada sessão no Claude e destrava os que já
 * estão ociosos/encerrados (movendo pra awaiting_review ou avançando chunks).
 *
 * Chamado periodicamente pelo Board pra manter a tela atualizada mesmo
 * quando o webhook do Anthropic não chega.
 */
export async function POST() {
  try {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const projectId = await getActiveProjectId(user.id);
    if (!projectId) {
      return NextResponse.json({ synced: [], unlocked: 0 });
    }

    const svc = createServiceClient();
    // Cards running do projeto ativo (via feature.project_id)
    const { data: cards } = await svc
      .from("cards")
      .select("id, claude_session_id, feature:features!inner(project_id)")
      .eq("status", "running")
      .not("claude_session_id", "is", null)
      .eq("feature.project_id", projectId);

    const synced: any[] = [];
    let unlocked = 0;

    for (const card of cards ?? []) {
      try {
        const result = await forceSyncSession(card.id);
        synced.push({ card_id: card.id, ...result });
        if (result.card_status !== "running") unlocked++;
        try {
          await recomputeCardMetrics(card.id);
        } catch {
          /* best-effort */
        }
      } catch (e) {
        synced.push({
          card_id: card.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    return NextResponse.json({ synced, unlocked });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
