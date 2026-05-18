import { NextResponse } from "next/server";
import { anthropic, verifyWebhook } from "@/lib/claude";
import { createServiceClient } from "@/lib/supabase/server";

// Force Node runtime (HMAC + DB access) — não Edge
export const runtime = "nodejs";
// Webhook precisa retornar 2xx rápido; processamento real é inline aqui porque
// as operações são leves (DB writes). Pra workloads pesadas, mude pra fila.
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

  // Idempotência: PK em webhook_events.id evita reprocessamento
  const { error: insertErr } = await sb.from("webhook_events").insert({
    id: event.id,
    event_type: event.data.type,
    payload: event as unknown as object,
  });
  if (insertErr?.code === "23505") {
    // duplicate key — já processado
    return NextResponse.json({ status: "duplicate" });
  }
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Processa inline (operações leves)
  try {
    if (event.data.type === "session.status_idled") {
      await handleSessionIdled(event.data.id);
    }
    // outros eventos: já ficaram no audit log
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

  const { data: card } = await sb
    .from("cards")
    .select("*, feature:features(slug, title)")
    .eq("claude_session_id", sessionId)
    .single();

  if (!card || card.status !== "running") return;

  // @ts-expect-error beta API
  const session = await anthropic.beta.sessions.retrieve(sessionId);
  const summary = extractSummary(session);

  // Determina assignee pelo role do stage
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

  await sb.from("human_gates").insert({
    card_id: card.id,
    assignee_id: assignee?.id ?? null,
    summary,
    artifacts_json: [],
  });
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
  const messages = session?.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    if (typeof m.content === "string") return m.content;
    for (const block of m.content ?? []) {
      if (block.type === "text") return block.text;
    }
  }
  return "(agent completed)";
}
