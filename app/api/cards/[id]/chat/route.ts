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

  if (card?.claude_session_id) {
    try {
      const liveMsgs: any[] = [];
      let n = 0;
      for await (const ev of beta.sessions.events.list(card.claude_session_id)) {
        n++;
        if (n > 400) break;
        const t = (ev as any).type as string;
        if (t !== "agent.message") continue;
        const c = (ev as any).content;
        let text = "";
        if (typeof c === "string") text = c;
        else if (Array.isArray(c)) {
          text = c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("");
        }
        text = (text || "").trim();
        if (!text) continue;
        const ts = (ev as any).created_at ?? null;
        liveMsgs.push({
          id: `live-${(ev as any).id ?? n}`,
          card_id: params.id,
          session_id: card.claude_session_id,
          role: "agent",
          content: text,
          created_at: ts ?? new Date().toISOString(),
          live: true,
        });
      }
      // Só adiciona os que NÃO foram persistidos ainda (compara conteúdo)
      for (const lm of liveMsgs) {
        if (!persistedContents.has(String(lm.content).trim())) {
          messages.push(lm);
        }
      }
      // Reordena por created_at
      messages.sort((a, b) =>
        String(a.created_at).localeCompare(String(b.created_at))
      );
    } catch (e) {
      // best-effort — se a SDK não listar eventos, devolve só o persistido
      console.error("[chat GET] live merge falhou", e);
    }
  }

  return NextResponse.json({ messages });
}
