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

interface ArtifactFile {
  name: string;
  path: string;
  type: string;
  size: number;
}

interface ChunkIssue {
  number: number;
  title: string;
  state: string;
  labels: string[];
  html_url: string;
}

interface PullRequest {
  number: number;
  title: string;
  state: string;
  draft?: boolean;
  head?: string;
  html_url: string;
}

interface ArtifactsState {
  files: ArtifactFile[];
  chunks: ChunkIssue[];
  pulls: PullRequest[];
  branch?: string;
  branches_available?: string[];
  message?: string;
  loading: boolean;
  error?: string;
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
  const [artifacts, setArtifacts] = useState<ArtifactsState>({
    files: [],
    chunks: [],
    pulls: [],
    loading: true,
  });
  const [openArtifact, setOpenArtifact] = useState<{
    path: string;
    name: string;
    content?: string;
    loading: boolean;
    html_url?: string;
  } | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadDetail();
    loadChatHistory();
    loadArtifacts();
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

    // Busca TODOS os cards desta feature (pode haver órfãos antigos) e pega
    // as stage_runs de todos — assim o histórico fica unificado por feature,
    // mostrando todas as sessões disparadas em todas as raias.
    const { data: featureCards } = await sb
      .from("cards")
      .select("id")
      .eq("feature_id", card.feature.id);
    const cardIds = (featureCards ?? []).map((c) => c.id);

    const { data: stageRuns } = await sb
      .from("card_stage_runs")
      .select("*")
      .in("card_id", cardIds.length ? cardIds : [cardId])
      .order("started_at", { ascending: true });

    setDetail({
      card,
      feature: card.feature,
      gate,
      attachments: attachments ?? [],
      stageRuns: stageRuns ?? [],
    });
  }

  async function loadChatHistory() {
    const res = await fetch(`/api/cards/${cardId}/chat`);
    if (res.ok) {
      const data = await res.json();
      setChatHistory(data.messages ?? []);
    }
  }

  async function loadArtifacts() {
    setArtifacts((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch(`/api/cards/${cardId}/artifacts`);
      const data = await res.json();
      setArtifacts({
        files: data.files ?? [],
        chunks: data.chunks ?? [],
        pulls: data.pulls ?? [],
        branch: data.branch,
        branches_available: data.branches_available,
        message: data.message,
        loading: false,
        error: data.error,
      });
    } catch (e) {
      setArtifacts({
        files: [],
        chunks: [],
        pulls: [],
        loading: false,
        error: String(e),
      });
    }
  }

  async function openFile(file: ArtifactFile) {
    setOpenArtifact({
      path: file.path,
      name: file.name,
      loading: true,
    });
    const url = `/api/cards/${cardId}/artifacts/file?path=${encodeURIComponent(
      file.path
    )}&branch=${encodeURIComponent(artifacts.branch ?? "main")}`;
    const res = await fetch(url);
    const data = await res.json();
    setOpenArtifact({
      path: file.path,
      name: file.name,
      loading: false,
      content: data.content,
      html_url: data.html_url,
    });
  }

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
          events: data.events ?? [],
          loading: false,
        });
        loadChatHistory();
        if (data.status === "idle" || data.status === "completed") {
          loadDetail();
          loadArtifacts(); // re-fetch artifacts quando agent termina
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
        await loadDetail();
      }
    } finally {
      setChatSending(false);
    }
  }

  async function handleCancel() {
    if (!cancelReason.trim()) {
      alert("informe o motivo");
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
      setActionLoading(false);
    }
  }

  async function handleCompleteEarly() {
    if (!confirm("marcar como concluída antecipadamente?")) return;
    setActionLoading(true);
    const res = await fetch(`/api/cards/${cardId}/complete`, { method: "POST" });
    if (res.ok) {
      onClose();
      window.location.reload();
    } else {
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

  const { card, feature, gate, attachments, stageRuns } = detail;
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

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Histórico de stages percorridas */}
            {stageRuns && stageRuns.length > 0 && (
              <Section title="histórico de execução">
                <div className="space-y-1">
                  {stageRuns.map((r: any) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 text-xs"
                    >
                      <span
                        className={
                          r.status === "completed"
                            ? "text-qa"
                            : r.status === "failed"
                              ? "text-discovery"
                              : "text-development"
                        }
                      >
                        {r.status === "completed"
                          ? "✓"
                          : r.status === "failed"
                            ? "✗"
                            : "●"}
                      </span>
                      <span className="text-ink-100">{r.stage}</span>
                      <span className="text-ink-400">·</span>
                      <span className="text-ink-400">
                        {r.agent_role ?? "?"}
                      </span>
                      <span className="text-ink-400 ml-auto">
                        {new Date(r.started_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            <Section title="contexto">
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

            {/* Artefatos gerados — file viewer */}
            <Section title="artefatos gerados">
              {artifacts.loading && (
                <div className="text-xs text-ink-400">carregando do GitHub...</div>
              )}
              {artifacts.error && (
                <div className="text-xs text-qa border border-qa/40 bg-qa/5 p-2 font-mono">
                  {artifacts.error}
                </div>
              )}
              {!artifacts.loading &&
                artifacts.files.length === 0 &&
                artifacts.chunks.length === 0 &&
                artifacts.pulls.length === 0 && (
                  <div className="text-xs text-ink-400 italic">
                    {artifacts.message ?? "ainda sem artefatos no repositório"}
                  </div>
                )}

              {/* Arquivos */}
              {artifacts.files.length > 0 && (
                <div className="mb-4">
                  <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-1">
                    documentos · branch{" "}
                    <span className="font-mono text-ink-300">
                      {artifacts.branch}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {artifacts.files.map((f) => (
                      <button
                        key={f.path}
                        onClick={() => openFile(f)}
                        className="w-full flex items-center justify-between p-2 border border-ink-800 hover:border-ink-600 bg-ink-900/40 text-left transition-colors"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <FileIcon name={f.name} />
                          <span className="text-sm text-ink-100 truncate">
                            {f.path.replace(`docs/features/${feature.slug}/`, "")}
                          </span>
                        </div>
                        <span className="text-[10px] text-ink-400 shrink-0">
                          {(f.size / 1024).toFixed(1)}kb
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Chunks (sub-issues) */}
              {artifacts.chunks.length > 0 && (
                <div className="mb-4">
                  <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-1">
                    chunks decompostos ({artifacts.chunks.length})
                  </div>
                  <div className="space-y-1">
                    {artifacts.chunks.map((c) => (
                      <a
                        key={c.number}
                        href={c.html_url}
                        target="_blank"
                        rel="noopener"
                        className="flex items-center gap-2 p-2 border border-ink-800 hover:border-ink-600 bg-ink-900/40 transition-colors"
                      >
                        <span
                          className={`text-[10px] uppercase px-1.5 py-0.5 border ${
                            c.state === "closed"
                              ? "text-qa border-qa/40"
                              : "text-development border-development/40"
                          }`}
                        >
                          {c.state}
                        </span>
                        <span className="text-sm text-ink-100 truncate flex-1">
                          #{c.number} {c.title}
                        </span>
                        <span className="text-[10px] text-ink-400 shrink-0">↗</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* PRs */}
              {artifacts.pulls.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-1">
                    pull requests ({artifacts.pulls.length})
                  </div>
                  <div className="space-y-1">
                    {artifacts.pulls.map((pr) => (
                      <a
                        key={pr.number}
                        href={pr.html_url}
                        target="_blank"
                        rel="noopener"
                        className="flex items-center gap-2 p-2 border border-ink-800 hover:border-ink-600 bg-ink-900/40 transition-colors"
                      >
                        <span
                          className={`text-[10px] uppercase px-1.5 py-0.5 border ${
                            pr.state === "merged"
                              ? "text-development border-development/40"
                              : pr.state === "closed"
                                ? "text-qa border-qa/40"
                                : "text-planning border-planning/40"
                          }`}
                        >
                          {pr.draft ? "draft" : pr.state}
                        </span>
                        <span className="text-sm text-ink-100 truncate flex-1">
                          #{pr.number} {pr.title}
                        </span>
                        <span className="text-[10px] text-ink-400 shrink-0">↗</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </Section>

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
                {session.error && (
                  <div className="text-xs text-qa border border-qa/40 bg-qa/5 p-2 font-mono mb-2">
                    {session.error}
                  </div>
                )}
                <EventTimeline events={session.events} />
              </Section>
            )}

            {gate?.summary && (
              <Section title="proposta / resumo">
                <div className="border border-ink-700 bg-ink-900 p-3 text-xs whitespace-pre-wrap text-ink-100 max-h-64 overflow-y-auto">
                  {gate.summary}
                </div>
              </Section>
            )}

            {canChat && (
              <Section title="conversar com o agente">
                <div className="text-[11px] text-ink-400 mb-3">
                  Peça mudanças no plano ou esclarecimentos. O agente retoma e
                  atualiza arquivos no repo.
                </div>

                <div className="border border-ink-700 bg-ink-900 max-h-64 overflow-y-auto p-3 space-y-3 mb-3">
                  {chatHistory.length === 0 && (
                    <div className="text-xs text-ink-400 italic">
                      ainda sem mensagens
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
                    placeholder="ex: divida esse chunk em dois..."
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
                Esta feature está em estado terminal ({card.status}).
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Artifact file viewer modal */}
      {openArtifact && (
        <ArtifactViewer
          artifact={openArtifact}
          onClose={() => setOpenArtifact(null)}
        />
      )}

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

      {showCancel && (
        <div className="fixed inset-0 bg-ink-950/90 flex items-center justify-center p-4 z-[60]">
          <div className="bg-ink-900 border border-qa w-full max-w-md p-6 space-y-4">
            <div>
              <div className="text-xs uppercase tracking-widest text-qa">
                // cancelar feature
              </div>
              <div className="text-lg font-semibold mt-1">Tem certeza?</div>
              <div className="text-sm text-ink-300 mt-2">
                O card vai pra seção de cancelados e sai do Kanban ativo.
              </div>
            </div>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              rows={3}
              placeholder="motivo (vai pro histórico)"
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
                {actionLoading ? "..." : "cancelar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ArtifactViewer({
  artifact,
  onClose,
}: {
  artifact: {
    path: string;
    name: string;
    content?: string;
    loading: boolean;
    html_url?: string;
  };
  onClose: () => void;
}) {
  const isHtml = artifact.name.toLowerCase().endsWith(".html");
  const isMarkdown =
    artifact.name.toLowerCase().endsWith(".md") ||
    artifact.name.toLowerCase().endsWith(".markdown");
  const [renderMode, setRenderMode] = useState<"source" | "preview">(
    isHtml ? "preview" : "source"
  );

  return (
    <div
      className="fixed inset-0 bg-ink-950/95 z-[70] flex items-stretch justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-ink-950 border border-ink-700 w-full max-w-5xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-ink-700 p-4 flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-widest text-ink-400">
              // {artifact.path}
            </div>
            <div className="text-base font-semibold truncate">
              {artifact.name}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(isHtml || isMarkdown) && (
              <button
                onClick={() =>
                  setRenderMode(renderMode === "source" ? "preview" : "source")
                }
                className="text-xs text-development hover:underline px-2"
              >
                {renderMode === "source" ? "preview" : "source"}
              </button>
            )}
            {artifact.html_url && (
              <a
                href={artifact.html_url}
                target="_blank"
                rel="noopener"
                className="text-xs text-development hover:underline px-2"
              >
                GitHub ↗
              </a>
            )}
            <button
              onClick={onClose}
              className="text-ink-400 hover:text-ink-100 text-2xl leading-none"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {artifact.loading && (
            <div className="p-8 text-center text-sm text-ink-300">
              carregando...
            </div>
          )}

          {!artifact.loading && artifact.content && (
            <>
              {isHtml && renderMode === "preview" ? (
                <iframe
                  srcDoc={artifact.content}
                  sandbox="allow-scripts"
                  className="w-full h-[80vh] border-0 bg-white"
                  title={artifact.name}
                />
              ) : isMarkdown && renderMode === "preview" ? (
                <MarkdownPreview content={artifact.content} />
              ) : (
                <pre className="p-4 text-xs text-ink-100 whitespace-pre-wrap font-mono leading-relaxed">
                  {artifact.content}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Renderizador de markdown bem básico — sem deps externas.
 * Suporta: headers, bold, italic, code, lists, links, code blocks.
 */
function MarkdownPreview({ content }: { content: string }) {
  // Implementação super simples — não é Marked.js mas serve pra visualizar
  const html = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/```([^`]*?)```/gs, '<pre class="bg-ink-900 p-3 border border-ink-700 my-3 overflow-x-auto"><code>$1</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="bg-ink-900 px-1 text-development">$1</code>')
    .replace(/^### (.*$)/gm, '<h3 class="text-base font-semibold mt-4 mb-2 text-ink-100">$1</h3>')
    .replace(/^## (.*$)/gm, '<h2 class="text-lg font-semibold mt-5 mb-2 text-ink-100">$1</h2>')
    .replace(/^# (.*$)/gm, '<h1 class="text-xl font-bold mt-6 mb-3 text-ink-100">$1</h1>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-ink-100">$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/^- (.*$)/gm, '<li class="ml-4">$1</li>')
    .replace(/\n\n/g, '</p><p class="my-2">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-development hover:underline" target="_blank">$1</a>');

  return (
    <div
      className="p-6 text-sm text-ink-200 leading-relaxed prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: "<p>" + html + "</p>" }}
    />
  );
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const icon =
    ext === "md" || ext === "markdown"
      ? "📄"
      : ext === "html" || ext === "htm"
        ? "🌐"
        : ext === "json" || ext === "yaml" || ext === "yml"
          ? "⚙️"
          : ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx"
            ? "💻"
            : "📎";
  return <span className="text-xs">{icon}</span>;
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
    return <div className="text-xs text-ink-400 italic">sem eventos</div>;
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
        [briefing inicial ·{" "}
        {new Date(message.created_at).toLocaleTimeString()}]
      </div>
    );
  }
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div className="text-[10px] text-ink-400 mb-0.5">
        {isUser ? "você" : "agent"} ·{" "}
        {new Date(message.created_at).toLocaleTimeString()}
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
