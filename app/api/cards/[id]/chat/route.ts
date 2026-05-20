import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { chatWithAgent } from "@/lib/orchestrator";

export const runtime = "nodejs";

// POST: envia mensagem para o agente
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    if (!body.message || typeof body.message !== "string") {
      return NextResponse.json(
        { error: "message required" },
        { status: 400 }
      );
    }

    const result = await chatWithAgent(params.id, body.message, user.id);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

// GET: lista o histórico de chat persistido
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = createServiceClient();
  const { data } = await svc
    .from("card_chat_messages")
    .select("*")
    .eq("card_id", params.id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ messages: data ?? [] });
}
