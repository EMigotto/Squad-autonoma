import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { advanceCard } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST: aplica um ajuste pedido pelo humano e REGENERA a etapa atual
// (rejeita o gate aberto com o texto como feedback -> mesma etapa roda de novo).
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const instruction = (body.instruction ?? "").toString().trim();
    if (!instruction) {
      return NextResponse.json({ error: "instruction obrigatório" }, { status: 400 });
    }

    const svc = createServiceClient();
    const { data: card } = await svc
      .from("cards")
      .select("status, stage")
      .eq("id", params.id)
      .single();
    if (!card) return NextResponse.json({ error: "card não encontrado" }, { status: 404 });
    if (card.status !== "awaiting_review") {
      return NextResponse.json(
        { error: "a etapa precisa estar aguardando revisão para ser regerada. Se ainda está rodando, envie a mensagem ao agente; se quiser, espere concluir e então peça o ajuste." },
        { status: 409 }
      );
    }

    // registra o pedido do humano no chat (visível como comando do harness)
    await svc.from("card_chat_messages").insert({
      card_id: params.id,
      role: "user",
      content: `🔄 ajuste solicitado (regerar etapa): ${instruction}`,
      sent_by: user.id,
    });

    // rejeita -> mesma etapa roda de novo com o ajuste como REJECTION FEEDBACK
    await advanceCard(params.id, "rejected", instruction, user.id);

    return NextResponse.json({ status: "ok", regenerating_stage: card.stage });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
