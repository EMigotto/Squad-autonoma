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
      const summary = (await buildWorklog(sessionId)) || extractSummary(session);
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

  const summary = (await buildWorklog(sessionId)) || extractSummary(session);

  // Persiste a resposta do agente no chat history (pra ele aparecer no chat ao vivo)
  if (summary) {
    await sb.from("card_chat_messages").insert({
      card_id: card.id,
      session_id: sessionId,
      role: "agent",
      content: summary,
    });
  }

  // Detecta erros na execução (item 4): se houver, registra no chat com prefixo
  // reconhecível pela UI e marca a stage_run. O humano pode pedir a correção.
  const errorDetail = await detectSessionErrors(sessionId);
  if (errorDetail) {
    await sb.from("card_chat_messages").insert({
      card_id: card.id,
      session_id: sessionId,
      role: "system",
      content: `⚠ ERRO DETECTADO NA EXECUÇÃO:\n${errorDetail}\n\nA etapa NÃO foi concluída com sucesso. Revise o erro acima e clique em "pedir correção ao agente" (ou descreva o ajuste no chat) para o agente reprocessar esta etapa.`,
    });
    try {
      await sb
        .from("card_stage_runs")
        .update({ summary: `⚠ com erros\n${summary ?? ""}` })
        .eq("claude_session_id", sessionId)
        .eq("status", "running");
    } catch (e) {
      console.error("[webhook] marcar stage_run com erro falhou", e);
    }
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
      // evento de feedback no chat: etapa concluída, aguardando humano
      const lbl: Record<string, string> = {
        discovery: "Discovery", planning: "Planejamento",
        development: "Desenvolvimento", code_review: "Code Review", qa: "QA",
      };
      await sb.from("card_chat_messages").insert({
        card_id: card.id,
        session_id: sessionId,
        role: "system",
        content: `⏸ Etapa "${lbl[card.stage] ?? card.stage}" concluída — aguardando sua revisão. Você pode aprovar para avançar, ou pedir um ajuste aqui no chat e regerar esta etapa.`,
      });
      // avisa o Teams do time com botões Aprovar/Reprovar
      try {
        const { notifyAwaitingReview } = await import("@/lib/notify");
        await notifyAwaitingReview(card.id, card.stage);
      } catch (e) {
        console.error("[webhook] notifyAwaitingReview falhou", e);
      }
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

// Monta um worklog legível a partir dos eventos reais da sessão: o que o
// Varre os eventos da sessão procurando sinais de erro na execução do agente.
// Retorna um resumo dos erros encontrados, ou null se a execução foi limpa.
// Sinais: tool_result com is_error, comandos que falharam, e padrões de texto
// típicos de falha (Error:, Traceback, npm ERR!, "X failed", "FAIL ").
async function detectSessionErrors(sessionId: string): Promise<string | null> {
  try {
    const hits: string[] = [];
    let n = 0;
    const errRe =
      /(\bError\b|\bException\b|Traceback|npm ERR!|\bFAILED?\b|\bfailed\b|\bcannot\b|\bcould not\b|ENOENT|ECONNREFUSED|fatal:|panic:|Cannot find module|tsc.*error|TS\d{3,}|exit code [1-9])/;
    for await (const ev of beta.sessions.events.list(sessionId)) {
      n++;
      if (n > 600) break;
      const t = (ev as any).type as string;
      // resultado de ferramenta marcado como erro
      if (t === "agent.tool_result" || t === "tool_result") {
        const isErr = (ev as any).is_error === true || (ev as any).status === "error";
        if (isErr) {
          const c = (ev as any).content;
          const txt = typeof c === "string"
            ? c
            : Array.isArray(c)
              ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
              : "";
          hits.push(`ferramenta falhou: ${(txt || "").slice(0, 300)}`);
        }
      }
      // texto do agente / saída de comando com sinais de erro
      const c = (ev as any).content;
      const text = typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
          : "";
      if (text && errRe.test(text)) {
        // pega a linha relevante do erro
        const line = text.split("\n").find((l: string) => errRe.test(l)) || text;
        const snippet = line.trim().slice(0, 240);
        if (snippet && !hits.includes(snippet)) hits.push(snippet);
      }
    }
    if (hits.length === 0) return null;
    // dedup e limita
    const uniq = Array.from(new Set(hits)).slice(0, 6);
    return uniq.join("\n");
  } catch (e) {
    console.error("[webhook] detectSessionErrors falhou", e);
    return null;
  }
}

// agente fez (ferramentas usadas, arquivos tocados, comandos) + o desfecho.
async function buildWorklog(sessionId: string): Promise<string | null> {
  try {
    const toolCounts: Record<string, number> = {};
    const files = new Set<string>();
    let lastText = "";
    let n = 0;
    for await (const ev of beta.sessions.events.list(sessionId)) {
      n++;
      if (n > 600) break;
      const t = (ev as any).type as string;
      if (t === "agent.tool_use" || t === "agent.custom_tool_use" || t === "agent.mcp_tool_use") {
        const name = ((ev as any).name as string) || "tool";
        toolCounts[name] = (toolCounts[name] ?? 0) + 1;
        const inp = (ev as any).input ?? (ev as any).arguments ?? {};
        const fp = inp?.path || inp?.file_path || inp?.filename;
        if (typeof fp === "string") files.add(fp.split("/").slice(-1)[0]);
      } else if (t === "agent.message") {
        const c = (ev as any).content;
        if (typeof c === "string") lastText = c;
        else if (Array.isArray(c)) {
          const txt = c.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
          if (txt.trim()) lastText = txt;
        }
      }
    }
    const toolLine = Object.keys(toolCounts).length
      ? "ações: " +
        Object.entries(toolCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}×${v}`)
          .join(", ")
      : "";
    const fileLine = files.size
      ? `arquivos: ${[...files].slice(0, 8).join(", ")}${files.size > 8 ? "…" : ""}`
      : "";
    const head = [toolLine, fileLine].filter(Boolean).join(" · ");
    const summary = (lastText || "").trim();
    if (!head && !summary) return null;
    return [head ? `✓ ${head}` : "✓ concluído", summary].filter(Boolean).join("\n\n");
  } catch (e) {
    console.error("[webhook] buildWorklog falhou", e);
    return null;
  }
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
