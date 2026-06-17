import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { chatWithAgent } from "@/lib/orchestrator";
import { beta } from "@/lib/claude";

export const runtime = "nodejs";

// POST: envia mensagem para o agente
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    const hasImages = Array.isArray(body.images) && body.images.length > 0;
    if ((!body.message || typeof body.message !== "string") && !hasImages) {
      return NextResponse.json({ error: "message ou images required" }, { status: 400 });
    }

    const result = await chatWithAgent(
      params.id,
      body.message ?? "",
      user.id,
      hasImages ? body.images : undefined
    );
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

// GET: histórico persistido + mensagens AO VIVO da sessão ativa.
// O webhook só grava a resposta do agente quando a sessão IDLE. Enquanto a
// sessão está rodando, as respostas que aparecem no Managed Agents não
// chegavam ao chat. Aqui lemos os agent.message events da sessão e mesclamos
// os que ainda não foram persistidos, para o chat refletir a conversa em
// tempo real (em até 1 ciclo de polling).
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = createServiceClient();
  const { data: persisted } = await svc
    .from("card_chat_messages")
    .select("*")
    .eq("card_id", params.id)
    .order("created_at", { ascending: true });

  const messages: any[] = [...(persisted ?? [])];

  const { data: card } = await svc
    .from("cards")
    .select("status, claude_session_id")
    .eq("id", params.id)
    .single();

  // Conteúdos já persistidos (pra não duplicar quando o webhook gravar o resumo)
  const persistedContents = new Set(
    (persisted ?? [])
      .filter((m: any) => m.role === "agent")
      .map((m: any) => String(m.content ?? "").trim())
  );

  let sessionStuck = false;
  if (card?.claude_session_id) {
    try {
      const liveMsgs: any[] = [];
      let internalErrors = 0;
      let n = 0;
      for await (const ev of beta.sessions.events.list(card.claude_session_id)) {
        n++;
        if (n > 400) break;
        const t = (ev as any).type as string;
        // Detecta o erro de buffer/serviço que trava a sessão
        const c0 = (ev as any).content;
        const text0 = typeof c0 === "string"
          ? c0
          : Array.isArray(c0)
            ? c0.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
            : "";
        if (/internal service error|context.*too large|buffer|maximum context|too many tokens/i.test(text0) ||
            (ev as any).error || t === "error" || t === "agent.error") {
          internalErrors++;
        }
        if (t !== "agent.message") continue;
        const text = text0;
        const clean = (text || "").trim();
        if (!clean) continue;
        const ts = (ev as any).created_at ?? null;
        liveMsgs.push({
          id: `live-${(ev as any).id ?? n}`,
          card_id: params.id,
          session_id: card.claude_session_id,
          role: "agent",
          content: clean,
          created_at: ts ?? new Date().toISOString(),
          live: true,
        });
      }
      for (const lm of liveMsgs) {
        if (!persistedContents.has(String(lm.content).trim())) messages.push(lm);
      }
      messages.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

      // Travada: há erros internos repetidos E nenhuma resposta de agente recente.
      // (2+ erros é sinal forte de buffer estourado / serviço travado.)
      if (internalErrors >= 2) sessionStuck = true;
    } catch (e) {
      console.error("[chat GET] live merge falhou", e);
    }
  }

  return NextResponse.json({ messages, session_stuck: sessionStuck });
}
