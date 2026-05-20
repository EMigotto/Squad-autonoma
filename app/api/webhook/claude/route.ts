import { NextResponse } from "next/server";
import { beta, verifyWebhook } from "@/lib/claude";
import { createServiceClient } from "@/lib/supabase/server";
import { handleChunkSessionIdle } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const body = await req.text();

  let event: { id: string; data: { type: string; id: string } };
  try {
    event = await verifyWebhook(body, req.headers);
  } catch (e) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const sb = createServiceClient();

  const { error: insertErr } = await sb.from("webhook_events").insert({
    id: event.id,
    event_type: event.data.type,
    payload: event as unknown as object,
  });
  if (insertErr?.code === "23505") {
    return NextResponse.json({ status: "duplicate" });
  }
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  try {
    if (event.data.type === "session.status_idled") {
      await handleSessionIdled(event.data.id);
    }
    await sb
      .from("webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", event.id);
  } catch (err) {
    await sb
      .from("webhook_events")
      .update({
        processed_at: new Date().toISOString(),
        error: String(err),
      })
      .eq("id", event.id);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  return NextResponse.json({ status: "ok" });
}

async function handleSessionIdled(sessionId: string) {
  const sb = createServiceClient();

  // Primeiro: é uma sessão de chunk (development)? Se sim, o orquestrador
  // marca o chunk done e dispara o próximo (ou finaliza a stage). Não cria
  // gate por chunk — só quando todos terminam.
  const wasChunk = await handleChunkSessionIdle(sessionId);
  if (wasChunk) {
    // Persiste o resumo do chunk no chat history pra visibilidade
    try {
      const session = await beta.sessions.retrieve(sessionId);
      const summary = extractSummary(session);
      const { data: chunkCard } = await sb
        .from("cards")
        .select("id")
        .eq("claude_session_id", sessionId)
        .single();
      if (summary && chunkCard) {
        await sb.from("card_chat_messages").insert({
          card_id: chunkCard.id,
          session_id: sessionId,
          role: "agent",
          content: summary,
        });
      }
    } catch (e) {
      console.error("[webhook] chunk summary persist failed", e);
    }
    return;
  }

  const { data: card } = await sb
    .from("cards")
    .select("*, feature:features(slug, title)")
    .eq("claude_session_id", sessionId)
    .single();

  if (!card) return;
  // Cards já cancelados ou done não recebem novo gate
  if (
    card.status === "cancelled" ||
    card.status === "done" ||
    card.stage === "done"
  )
    return;

  let session: any = null;
  try {
    session = await beta.sessions.retrieve(sessionId);
  } catch (e) {
    console.error("[webhook] failed to retrieve session", e);
  }

  const summary = extractSummary(session);

  // Persiste a resposta do agente no chat history (pra ele aparecer no chat ao vivo)
  if (summary) {
    await sb.from("card_chat_messages").insert({
      card_id: card.id,
      session_id: sessionId,
      role: "agent",
      content: summary,
    });
  }

  // Card só vai pra awaiting_review se ainda estiver running
  // (chat refining mantém running → idle → running ciclicamente)
  if (card.status === "running") {
    // Atualiza o summary da stage_run atual (status vira completed/failed só
    // quando o humano decide, em advanceCard).
    await sb
      .from("card_stage_runs")
      .update({ summary })
      .eq("claude_session_id", sessionId)
      .eq("status", "running");

    const role = roleForStage(card.stage);
    const { data: assignee } = await sb
      .from("user_profiles")
      .select("id")
      .eq("role", role)
      .limit(1)
      .single();

    await sb
      .from("cards")
      .update({ status: "awaiting_review" })
      .eq("id", card.id);

    // Verifica se já existe um gate aberto pra esse card (continuação de chat)
    const { data: existingGate } = await sb
      .from("human_gates")
      .select("id")
      .eq("card_id", card.id)
      .is("decision", null)
      .single();

    if (!existingGate) {
      await sb.from("human_gates").insert({
        card_id: card.id,
        assignee_id: assignee?.id ?? null,
        summary,
        artifacts_json: [],
      });
    } else {
      // Atualiza o summary do gate existente com a resposta mais recente
      await sb
        .from("human_gates")
        .update({ summary })
        .eq("id", existingGate.id);
    }
  }
}

function roleForStage(stage: string): string {
  return (
    {
      discovery: "pm",
      planning: "tech_lead",
      development: "tech_lead",
      qa: "qa",
    }[stage] ?? "admin"
  );
}

function extractSummary(session: any): string {
  if (!session) return "(no session data)";
  const messages = session?.messages ?? session?.events ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" && m.type !== "agent.message") continue;
    if (typeof m.content === "string") return m.content;
    for (const block of m.content ?? []) {
      if (block.type === "text") return block.text;
    }
  }
  return "(agent completed)";
}
