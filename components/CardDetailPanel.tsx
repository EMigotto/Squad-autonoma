"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  cardId: string;
  currentUser: { id: string; role: string };
  onClose: () => void;
}

interface CardDetail {
  card: any;
  feature: any;
  gate: any;
  attachments: any[];
}

interface SessionState {
  status: string;
  agent_name?: string;
  tokens_used?: number;
  duration_ms?: number;
  events: Array<{
    id: string;
    type: string;
    processed_at: string;
    content?: any;
    name?: string;
    text?: string;
  }>;
  loading: boolean;
  error?: string;
}

export default function CardDetailPanel({
  cardId,
  currentUser,
  onClose,
}: Props) {
  const [detail, setDetail] = useState<CardDetail | null>(null);
  const [session, setSession] = useState<SessionState>({
    status: "unknown",
    events: [],
    loading: true,
  });
  const [decisionLoading, setDecisionLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);

  // Carrega detalhes do card
  useEffect(() => {
    loadDetail();
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

  // Auto-refresh dos eventos da sessão enquanto running
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
            error: data.error ?? "erro desconhecido",
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
        // Continue polling enquanto running
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
  }, [detail?.card?.claude_session_id]);

  async function handleDecision(decision: "approved" | "rejected") {
    if (!detail?.gate) return;
    if (decision === "rejected" && !rejectReason.trim()) {
      setShowRejectInput(true);
      return;
    }
    setDecisionLoading(true);
    const res = await fetch(`/api/gates/${detail.gate.id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        reason: decision === "rejected" ? rejectReason : undefined,
      }),
    });
    if (res.ok) {
      onClose();
      window.location.reload();
    } else {
      const j = await res.json().catch(() => ({}));
      alert("erro: " + (j.error ?? res.status));
      setDecisionLoading(false);
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
  const [owner, repo] = (feature.github_repo ?? "").split("/");

  return (
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

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Feature metadata */}
          <Section title="contexto da feature">
            <Field label="descrição" value={feature.description} multiline />
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
                label={`protótipos anexados (${attachments.length})`}
                value={
                  <ul className="space-y-1">
                    {attachments.map((a) => (
                      <li key={a.id} className="text-ink-100">
                        {a.filename}{" "}
                        <span className="text-ink-400 text-[10px]">
                          {a.size_bytes
                            ? `${(a.size_bytes / 1024).toFixed(0)}kb`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                }
              />
            )}
          </Section>

          {/* Session status & live viewer */}
          <Section title="sessão claude (live)">
            <div className="flex items-center gap-4 text-xs mb-3">
              <StatusPill status={session.status} />
              {session.agent_name && (
                <span className="text-ink-300">
                  {session.agent_name}
                </span>
              )}
              {session.tokens_used !== undefined && (
                <span className="text-ink-400">
                  {(session.tokens_used / 1000).toFixed(1)}k tokens
                </span>
              )}
              {session.duration_ms !== undefined && (
                <span className="text-ink-400">
                  {Math.floor(session.duration_ms / 1000)}s
                </span>
              )}
              {card.claude_session_id && (
                <a
                  href={`https://console.anthropic.com/sessions/${card.claude_session_id}`}
                  target="_blank"
                  rel="noopener"
                  className="ml-auto text-development hover:underline text-[11px]"
                >
                  abrir no Console ↗
                </a>
              )}
            </div>

            {session.loading && (
              <div className="text-xs text-ink-400">carregando eventos...</div>
            )}
            {session.error && (
              <div className="text-xs text-qa border border-qa/40 bg-qa/5 p-2 font-mono">
                {session.error}
              </div>
            )}

            <EventTimeline events={session.events} />
          </Section>

          {/* Gate decision */}
          {gate && (
            <Section title={isMineToReview ? "sua decisão" : "aguardando revisão"}>
              {gate.summary && (
                <div className="border border-ink-700 bg-ink-900 p-3 text-xs whitespace-pre-wrap text-ink-100 mb-3 max-h-64 overflow-y-auto">
                  {gate.summary}
                </div>
              )}

              {isMineToReview && (
                <div className="space-y-3">
                  {showRejectInput && (
                    <div>
                      <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">
                        motivo da rejeição
                      </label>
                      <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        rows={3}
                        placeholder="seja específico — vira contexto da próxima tentativa"
                        className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleDecision("approved")}
                      disabled={decisionLoading}
                      className="bg-qa text-ink-950 px-3 py-1.5 text-sm font-semibold hover:bg-qa/80 disabled:opacity-50"
                    >
                      {decisionLoading ? "..." : "aprovar e avançar →"}
                    </button>
                    <button
                      onClick={() => handleDecision("rejected")}
                      disabled={decisionLoading}
                      className="bg-discovery text-ink-950 px-3 py-1.5 text-sm font-semibold hover:bg-discovery/80 disabled:opacity-50"
                    >
                      {showRejectInput && rejectReason ? "rejeitar ↺" : "rejeitar"}
                    </button>
                  </div>
                </div>
              )}

              {!isMineToReview && (
                <div className="text-xs text-ink-400">
                  Esse gate é responsabilidade de outro membro do squad.
                </div>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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
      {status === "running" && <span className="inline-block animate-pulse">●</span>}{" "}
      {status}
    </span>
  );
}

function EventTimeline({ events }: { events: SessionState["events"] }) {
  if (events.length === 0) {
    return (
      <div className="text-xs text-ink-400 italic">
        ainda sem eventos — aguardando o agente começar
      </div>
    );
  }
  return (
    <div className="space-y-1 max-h-96 overflow-y-auto">
      {events.map((e) => (
        <EventRow key={e.id} event={e} />
      ))}
    </div>
  );
}

function EventRow({ event }: { event: SessionState["events"][number] }) {
  const time = new Date(event.processed_at).toLocaleTimeString();

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
