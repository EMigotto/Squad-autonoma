import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { advanceCard } from "@/lib/orchestrator";
import { recomputeCardMetrics } from "@/lib/metrics";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Decide a revisão de um card DIRETO pelo card (sem depender do registro de
 * human_gates). Fallback para quando o gate não existe — assim os botões
 * aprovar/rejeitar nunca ficam inertes só por falta do registro de gate.
 * Body: { decision: "approved" | "rejected", reason?, model? }
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    const decision = body?.decision;
    if (decision !== "approved" && decision !== "rejected") {
      return NextResponse.json({ error: "decision inválida" }, { status: 400 });
    }

    const svc = createServiceClient();
    // Se existir um gate aberto, marca como decidido (mantém histórico coerente)
    const { data: openGate } = await svc
      .from("human_gates")
      .select("id")
      .eq("card_id", params.id)
      .is("decision", null)
      .maybeSingle();
    if (openGate) {
      await svc
        .from("human_gates")
        .update({ decision, decided_by: user.id, decided_at: new Date().toISOString() })
        .eq("id", openGate.id);
    }

    await advanceCard(
      params.id,
      decision,
      body?.reason,
      user.id,
      undefined,
      body?.model ?? null
    );
    if (decision === "approved") {
      try { await recomputeCardMetrics(params.id); } catch { /* best-effort */ }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
