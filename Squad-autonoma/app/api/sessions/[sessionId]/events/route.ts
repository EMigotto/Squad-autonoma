import { NextResponse } from "next/server";
import { beta } from "@/lib/claude";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  req: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const sessionId = params.sessionId;

    // 1. Busca metadata da sessão
    let sessionMeta: any = null;
    try {
      sessionMeta = await beta.sessions.retrieve(sessionId);
    } catch (e) {
      return NextResponse.json(
        {
          status: "error",
          events: [],
          error: `failed to retrieve session: ${
            e instanceof Error ? e.message : String(e)
          }`,
        },
        { status: 200 } // 200 pra UI conseguir mostrar erro
      );
    }

    // 2. Busca lista de eventos da sessão
    let events: any[] = [];
    try {
      // A API pode expor de várias formas — tentamos as mais comuns
      const listRes =
        (await beta.sessions.events?.list?.(sessionId, { limit: 100 })) ??
        (await beta.sessions.events?.list?.(sessionId)) ??
        sessionMeta?.events;

      events = Array.isArray(listRes)
        ? listRes
        : Array.isArray(listRes?.data)
          ? listRes.data
          : Array.isArray(listRes?.events)
            ? listRes.events
            : [];
    } catch (e) {
      // Se a SDK não expõe events.list ainda, retorna só os do sessionMeta se houver
      events = sessionMeta?.events ?? [];
    }

    // Normaliza cada evento pra ter um campo text quando aplicável
    const normalized = events.map((evt: any) => {
      let text: string | undefined;
      const content = evt.content;
      if (Array.isArray(content)) {
        const txtBlock = content.find((b: any) => b?.type === "text");
        if (txtBlock?.text) text = txtBlock.text;
      } else if (typeof content === "string") {
        text = content;
      }
      // Para tool_use, mostra os argumentos resumidos
      if (evt.type === "agent.tool_use" && evt.input) {
        text = JSON.stringify(evt.input).slice(0, 200);
      }
      // Para tool_result, mostra parte do resultado
      if (evt.type === "agent.tool_result" && Array.isArray(evt.content)) {
        const txtBlock = evt.content.find((b: any) => b?.type === "text");
        if (txtBlock?.text) text = txtBlock.text.slice(0, 200);
      }
      return {
        id: evt.id,
        type: evt.type,
        processed_at: evt.processed_at,
        name: evt.name,
        content: evt.content,
        text,
      };
    });

    return NextResponse.json({
      status: sessionMeta?.status ?? "unknown",
      agent_name: sessionMeta?.agent_name ?? sessionMeta?.agent?.name,
      tokens_used:
        sessionMeta?.model_usage?.total_tokens ??
        sessionMeta?.tokens_used ??
        undefined,
      duration_ms: sessionMeta?.duration_ms,
      events: normalized.slice(-50), // últimos 50 pra não explodir UI
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        events: [],
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 200 }
    );
  }
}
