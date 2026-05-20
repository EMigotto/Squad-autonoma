"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import TransitionDialog from "./TransitionDialog";

interface Props {
  cardId: string;
  currentUser: { id: string; role: string };
  onClose: () => void;
}

interface SessionState {
  status: string;
  agent_name?: string;
  tokens_used?: number;
  duration_ms?: number;
  events: any[];
  loading: boolean;
  error?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  created_at: string;
}

export default function CardDetailPanel({
  cardId,
  currentUser,
  onClose,
}: Props) {
  const [detail, setDetail] = useState<any>(null);
  const [session, setSession] = useState<SessionState>({
    status: "unknown",
    events: [],
    loading: true,
  });
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Carrega detalhes
  useEffect(() => {
    loadDetail();
    loadChatHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  async function loadDetail() {
    const sb = createClient();
    const { data: card } = await sb
      .from("cards")
      .select(
        `*,
         feature:features (id, slug, title, description, github_repo,
                          current_stage, claude_environment_id, github_parent_issue),
         human_gates (id, summary, decision, decision_reason, assignee_id, created_at)`
      )
      .eq("id", cardId)
      .single();

    if (!card) return;
    const gate = card.human_gates?.find((g: any) => g.decision === null);
    const { data: attachments } = await sb
      .from("feature_attachments")
      .select("*")
      .eq("feature_id", card.feature.id);

    setDetail({
      card,
      feature: card.feature,
      gate,
      attachments: attachments ?? [],
    });
  }

  async function loadChatHistory() {
    const res = await fetch(`/api/cards/${cardId}/chat`);
    if (res.ok) {
      const data = await res.json();
      setChatHistory(data.messages ?? []);
    }
  }

  // Auto-refresh session events
  useEffect(() => {
    if (!detail?.card?.claude_session_id) {
      setSession((s) => ({ ...s, loading: false }));
      return;
    }
    let cancelled = false;
    let timer: NodeJS.Timeout | null = null;

    async function fetchEvents() {
      try {
        const res = await fetch(
          `/api/sessions/${detail!.card.claude_session_id}/events`
        );
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setSession({
            status: "error",
            events: [],
            loading: false,
            error: data.error,
          });
          return;
        }
        setSession({
          status: data.status ?? "unknown",
          agent_name: data.agent_name,
          tokens_used: data.tokens_used,
          duration_ms: data.duration_ms,
          events: data.events ?? [],
          loading: false,
        });
        // Sync também o chat history pra mostrar a resposta do agent
        loadChatHistory();
        // Reload detail pra pegar status novo
        if (
          data.status === "idle" ||
          data.status === "completed"
        ) {
          loadDetail();
        }
        if (
          data.status === "running" ||
          data.status === "starting" ||
          data.status === "pending"
        ) {
          timer = setTimeout(fetchEvents, 3000);
        }
      } catch (e) {
        if (cancelled) return;
        setSession({
          status: "error",
          events: [],
          loading: false,
          error: String(e),
        });
      }
    }

    fetchEvents();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [detail?.card?.claude_session_id, detail?.card?.status]);

  // Scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory.length]);

  async function handleChatSend() {
    if (!chatInput.trim()) return;
    setChatSending(true);
    try {
      const res = await fetch(`/api/cards/${cardId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatInput }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert("erro: " + (j.error ?? res.status));
      } else {
        setChatInput("");
        await loadChatHistory();
        await loadDetail(); // status volta pra running
      }
    } finally {
      setChatSending(false);
    }
  }

  async function handleCancel() {
    if (!cancelReason.trim()) {
      alert("informe o motivo do cancelamento");
      return;
    }
    setActionLoading(true);
    const res = await fetch(`/api/cards/${cardId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: cancelReason }),
    });
    if (res.ok) {
      onClose();
      window.location.reload();
    } else {
      const j = await res.json().catch(() => ({}));
      alert("erro: " + (j.error ?? res.status));
      setActionLoading(false);
    }
  }

  async function handleCompleteEarly() {
    if (
      !confirm(
        "marcar como concluída antecipadamente? as etapas pendentes serão puladas."
      )
    )
      return;
    setActionLoading(true);
    const res = await fetch(`/api/cards/${cardId}/complete`, {
      method: "POST",
    });
    if (res.ok) {
      onClose();
      window.location.reload();
    } else {
      const j = await res.json().catch(() => ({}));
      alert("erro: " + (j.error ?? res.status));
      setActionLoading(false);
    }
  }

  async function handleReject(reason: string) {
    if (!detail?.gate) return;
    setActionLoading(true);
    const res = await fetch(`/api/gates/${detail.gate.id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "rejected", reason }),
    });
    if (res.ok) {
      onClose();
      window.location.reload();
    } else {
      setActionLoading(false);
    }
  }

  if (!detail) {
    return (
      <div className="fixed inset-0 bg-ink-950/80 flex items-center justify-center z-50">
        <div className="text-ink-300 text-sm">carregando...</div>
      </div>
    );
  }

  const { card, feature, gate, attachments } = detail;
  const isMineToReview = gate && gate.assignee_id === currentUser.id;
  const isTerminal =
    card.status === "done" ||
    card.status === "cancelled" ||
    card.stage === "done";
  const isAwaitingReview = card.status === "awaiting_review";
  const canChat = !!card.claude_session_id && !isTerminal;

  return (
    <>
      <div className="fixed inset-0 bg-ink-950/80 flex items-stretch justify-end z-50">
        <div
          className="bg-ink-950 border-l border-ink-700 w-full max-w-3xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="border-b border-ink-700 p-5 flex items-start justify-between shrink-0">
            <div>
              <div className="text-xs uppercase tracking-widest text-ink-400">
                {card.stage} · {card.status}
              </div>
              <div className="text-lg font-semibold mt-1">{feature.title}</div>
              <div className="text-xs text-ink-400 mt-1">{feature.slug}</div>
            </div>
            <button
              onClick={onClose}
              className="text-ink-400 hover:text-ink-100 text-2xl leading-none"
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Feature context */}
            <Section title="contexto">
              <Field
                label="descrição"
                value={feature.description}
                multiline
              />
              <Field
                label="repo"
                value={
                  <a
                    href={`https://github.com/${feature.github_repo}`}
                    target="_blank"
                    rel="noopener"
                    className="text-development hover:underline"
                  >
                    {feature.github_repo} ↗
                  </a>
                }
              />
              {attachments.length > 0 && (
                <Field
                  label={`protótipos (${attachments.length})`}
                  value={
                    <ul className="space-y-1">
                      {attachments.map((a: any) => (
                        <li key={a.id} className="text-ink-100">
                          {a.filename}
                        </li>
                      ))}
                    </ul>
                  }
                />
              )}
            </Section>

            {/* Session viewer */}
            {card.claude_session_id && (
              <Section title="sessão claude (live)">
                <div className="flex items-center gap-3 text-xs mb-3 flex-wrap">
                  <StatusPill status={session.status} />
                  {session.tokens_used !== undefined && (
                    <span className="text-ink-400">
                      {(session.tokens_used / 1000).toFixed(1)}k tokens
                    </span>
                  )}
                  <a
                    href={`https://console.anthropic.com/sessions/${card.claude_session_id}`}
                    target="_blank"
                    rel="noopener"
                    className="ml-auto text-development hover:underline text-[11px]"
                  >
                    Console ↗
                  </a>
                </div>
                {session.loading && (
                  <div className="text-xs text-ink-400">carregando...</div>
                )}
                {session.error && (
                  <div className="text-xs text-qa border border-qa/40 bg-qa/5 p-2 font-mono mb-2">
                    {session.error}
                  </div>
                )}
                <EventTimeline events={session.events} />
              </Section>
            )}

            {/* Gate summary */}
            {gate?.summary && (
              <Section title={isAwaitingReview ? "proposta do agente" : "resumo"}>
                <div className="border border-ink-700 bg-ink-900 p-3 text-xs whitespace-pre-wrap text-ink-100 max-h-64 overflow-y-auto">
                  {gate.summary}
                </div>
              </Section>
            )}

            {/* Chat com agent */}
            {canChat && (
              <Section title="conversar com o agente">
                <div className="text-[11px] text-ink-400 mb-3">
                  Use o chat pra pedir mudanças no plano ou esclarecer. O agente
                  retoma de onde parou e atualiza os artefatos no repo.
                </div>

                <div className="border border-ink-700 bg-ink-900 max-h-64 overflow-y-auto p-3 space-y-3 mb-3">
                  {chatHistory.length === 0 && (
                    <div className="text-xs text-ink-400 italic">
                      ainda sem mensagens no chat. o agente recebeu o briefing
                      inicial; mande uma mensagem pra refinar.
                    </div>
                  )}
                  {chatHistory
                    .filter((m) => m.role !== "system" || chatHistory.length < 3)
                    .map((msg) => (
                      <ChatBubble key={msg.id} message={msg} />
                    ))}
                  <div ref={chatEndRef} />
                </div>

                <div className="flex gap-2">
                  <textarea
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="ex: separe esse chunk em dois, um pra API e outro pra UI..."
                    rows={2}
                    disabled={chatSending || session.status === "running"}
                    className="flex-1 bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none disabled:opacity-50"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        handleChatSend();
                      }
                    }}
                  />
                  <button
                    onClick={handleChatSend}
                    disabled={
                      chatSending ||
                      !chatInput.trim() ||
                      session.status === "running"
                    }
                    className="bg-ink-100 text-ink-950 px-3 py-1.5 text-sm font-semibold hover:bg-ink-300 disabled:opacity-50 self-start"
                  >
                    {chatSending
                      ? "..."
                      : session.status === "running"
                        ? "agente ocupado"
                        : "enviar"}
                  </button>
                </div>
                <div className="text-[10px] text-ink-400 mt-1">
                  ctrl+enter para enviar
                </div>
              </Section>
            )}

            {/* Actions */}
            {!isTerminal && (
              <Section title="ações">
                <div className="flex flex-wrap gap-2">
                  {isAwaitingReview && isMineToReview && (
                    <button
                      onClick={() => setShowTransition(true)}
                      disabled={actionLoading}
                      className="bg-qa text-ink-950 px-3 py-1.5 text-sm font-semibold hover:bg-qa/80 disabled:opacity-50"
                    >
                      aprovar e avançar →
                    </button>
                  )}
                  {isAwaitingReview && isMineToReview && (
                    <button
                      onClick={() => {
                        const reason = prompt("motivo da rejeição:");
                        if (reason?.trim()) handleReject(reason);
                      }}
                      disabled={actionLoading}
                      className="border border-discovery text-discovery px-3 py-1.5 text-sm hover:bg-discovery/10 disabled:opacity-50"
                    >
                      rejeitar
                    </button>
                  )}
                  <button
                    onClick={handleCompleteEarly}
                    disabled={actionLoading}
                    className="border border-done text-done px-3 py-1.5 text-sm hover:bg-done/10 disabled:opacity-50 ml-auto"
                  >
                    concluir antecipadamente
                  </button>
                  <button
                    onClick={() => setShowCancel(true)}
                    disabled={actionLoading}
                    className="border border-qa text-qa px-3 py-1.5 text-sm hover:bg-qa/10 disabled:opacity-50"
                  >
                    cancelar feature
                  </button>
                </div>
              </Section>
            )}

            {isTerminal && (
              <div className="text-xs text-ink-400 italic">
                Esta feature está em estado terminal ({card.status}). Nenhuma ação
                disponível.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Transition Dialog */}
      {showTransition && (
        <TransitionDialog
          cardId={cardId}
          onClose={() => setShowTransition(false)}
          onConfirm={() => {
            setShowTransition(false);
            onClose();
            window.location.reload();
          }}
        />
      )}

      {/* Cancel modal */}
      {showCancel && (
        <div className="fixed inset-0 bg-ink-950/90 flex items-center justify-center p-4 z-[60]">
          <div className="bg-ink-900 border border-qa w-full max-w-md p-6 space-y-4">
            <div>
              <div className="text-xs uppercase tracking-widest text-qa">
                // cancelar feature
              </div>
              <div className="text-lg font-semibold mt-1">
                Tem certeza?
              </div>
              <div className="text-sm text-ink-300 mt-2">
                O card será marcado como cancelled. Trabalho do agente em
                andamento será descartado.
              </div>
            </div>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              placeholder="motivo do cancelamento (vai pro histórico)"
              className="w-full bg-ink-950 border border-ink-700 px-2 py-1.5 text-sm focus:border-qa focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCancel(false)}
                className="text-sm text-ink-300 hover:text-ink-100 px-3 py-1.5"
              >
                voltar
              </button>
              <button
                onClick={handleCancel}
                disabled={actionLoading || !cancelReason.trim()}
                className="bg-qa text-ink-950 px-3 py-1.5 text-sm font-semibold hover:bg-qa/80 disabled:opacity-50"
              >
                {actionLoading ? "..." : "cancelar feature"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-2">
        // {title}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  multiline,
}: {
  label: string;
  value: React.ReactNode;
  multiline?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-ink-400">
        {label}
      </div>
      <div
        className={`text-sm text-ink-100 ${multiline ? "whitespace-pre-wrap" : ""}`}
      >
        {value || <span className="text-ink-400">—</span>}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: "bg-development/20 text-development border-development/40",
    idle: "bg-qa/20 text-qa border-qa/40",
    completed: "bg-qa/20 text-qa border-qa/40",
    error: "bg-qa/20 text-qa border-qa/40",
    pending: "bg-planning/20 text-planning border-planning/40",
    starting: "bg-planning/20 text-planning border-planning/40",
    unknown: "bg-ink-700 text-ink-300 border-ink-600",
  };
  const cls = map[status] ?? map.unknown;
  return (
    <span
      className={`px-2 py-0.5 text-[10px] uppercase tracking-widest border ${cls}`}
    >
      {status === "running" && (
        <span className="inline-block animate-pulse">●</span>
      )}{" "}
      {status}
    </span>
  );
}

function EventTimeline({ events }: { events: any[] }) {
  if (events.length === 0) {
    return (
      <div className="text-xs text-ink-400 italic">
        ainda sem eventos
      </div>
    );
  }
  return (
    <div className="space-y-1 max-h-72 overflow-y-auto">
      {events.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
    </div>
  );
}

function EventRow({ event }: { event: any }) {
  const time = event.processed_at
    ? new Date(event.processed_at).toLocaleTimeString()
    : "";
  let icon = "•";
  let color = "text-ink-400";
  let label = event.type;
  let extra: string | null = null;

  if (event.type === "agent.message") {
    icon = "🤖";
    color = "text-development";
    label = "agent";
    extra = event.text ?? null;
  } else if (event.type === "agent.thinking") {
    icon = "💭";
    color = "text-ink-400";
    label = "thinking";
  } else if (event.type === "agent.tool_use") {
    icon = "🔧";
    color = "text-planning";
    label = `tool: ${event.name ?? "?"}`;
    extra = event.text;
  } else if (event.type === "agent.tool_result") {
    icon = "↩";
    color = "text-ink-300";
    label = "tool result";
  } else if (event.type === "user.message") {
    icon = "👤";
    color = "text-ink-100";
    label = "user";
    extra = event.text ?? null;
  } else if (event.type === "session.error") {
    icon = "✗";
    color = "text-qa";
    label = "error";
    extra = event.text ?? null;
  }

  return (
    <div className="border-l border-ink-700 pl-3 py-1 text-[11px]">
      <div className="flex items-center gap-2">
        <span>{icon}</span>
        <span className={`uppercase tracking-widest ${color}`}>{label}</span>
        <span className="text-ink-400 ml-auto">{time}</span>
      </div>
      {extra && (
        <div className="mt-1 text-ink-300 whitespace-pre-wrap line-clamp-3">
          {extra}
        </div>
      )}
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="text-[10px] text-ink-400 italic border border-ink-800 p-2">
        [briefing inicial enviado · {new Date(message.created_at).toLocaleTimeString()}]
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
    >
      <div className="text-[10px] text-ink-400 mb-0.5">
        {isUser ? "você" : "agent"} · {new Date(message.created_at).toLocaleTimeString()}
      </div>
      <div
        className={`max-w-[85%] px-3 py-2 text-xs whitespace-pre-wrap ${
          isUser
            ? "bg-discovery/10 border border-discovery/40 text-ink-100"
            : "bg-ink-900 border border-ink-700 text-ink-100"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
