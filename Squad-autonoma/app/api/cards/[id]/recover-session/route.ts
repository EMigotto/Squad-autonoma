import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { recoverSession } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Recria a sessão do card quando a atual travou (buffer estourado / erro
 * interno). Pode ser chamado manualmente ou automaticamente pela UI ao
 * detectar `session_stuck` no polling do chat.
 */
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    let reason = "sessão travada (erro interno / buffer)";
    try {
      const body = await req.json();
      if (body?.reason) reason = String(body.reason);
    } catch {
      /* sem body, usa o default */
    }

    const result = await recoverSession(params.id, reason);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
