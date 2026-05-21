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
  branch?: string;
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
    )}&branch=${encodeURIComponent(file.branch ?? artifacts.branch ?? "main")}`;
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
          // Se a sessão terminou mas o card ainda está running, destrava
          // automaticamente (fallback ao webhook).
          if (detail?.card?.status === "running") {
            try {
              await fetch(`/api/cards/${cardId}/sync`, { method: "POST" });
            } catch {
              // silencioso
            }
          }
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

  async function handleSync() {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/cards/${cardId}/sync`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert("erro: " + (data.error ?? res.status));
      } else {
        alert(
          `status da sessão: ${data.session_status}\nação: ${data.action}`
        );
        await loadDetail();
        if (data.card_status === "awaiting_review") {
          window.location.reload();
        }
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRerun() {
    if (
      !confirm(
        "Re-executar este estágio? Todo o processamento atual será descartado e o agente recomeça imediatamente."
      )
    )
      return;
    setActionLoading(true);
    const res = await fetch(`/api/cards/${cardId}/rerun`, { method: "POST" });
    if (res.ok) {
      onClose();
      window.location.reload();
    } else {
      const j = await res.json().catch(() => ({}));
      alert("erro: " + (j.error ?? res.status));
      setActionLoading(false);
    }
  }

  async function handleMove(targetStage: string) {
    const labels: Record<string, string> = {
      discovery: "Discovery",
      planning: "Planejamento Técnico",
      development: "Desenvolvimento",
      qa: "Qualidade",
    };
    if (
      !confirm(
        `Mover este card para "${labels[targetStage] ?? targetStage}"? ` +
          `O agente dessa etapa será disparado novamente.`
      )
    )
      return;
    setActionLoading(true);
    const res = await fetch(`/api/cards/${cardId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: targetStage, dispatch: true }),
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
            {/* Etapas com sessões e artefatos linkados */}
            <StagesView
              stageRuns={stageRuns ?? []}
              artifacts={artifacts}
              feature={feature}
              onOpenFile={openFile}
            />

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

                {/* Diagnóstico: card preso */}
                <SessionHealth
                  cardStatus={card.status}
                  sessionStatus={session.status}
                  onSync={handleSync}
                  onRerun={handleRerun}
                  loading={actionLoading}
                />

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
              <AgentChat
                cardId={cardId}
                stage={card.stage}
                sessionStatus={session.status}
                modelName={session.agent_name}
                chatHistory={chatHistory}
                onSent={() => {
                  loadChatHistory();
                  loadDetail();
                }}
              />
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
                    onClick={handleRerun}
                    disabled={actionLoading}
                    className="border border-development text-development px-3 py-1.5 text-sm hover:bg-development/10 disabled:opacity-50"
                  >
                    ↻ re-executar etapa
                  </button>
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

                {/* Mover para etapa (frente ou trás) */}
                <div className="mt-3 pt-3 border-t border-ink-800">
                  <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-2">
                    mover para etapa
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { code: "discovery", label: "Discovery" },
                      { code: "planning", label: "Planejamento Técnico" },
                      { code: "development", label: "Desenvolvimento" },
                      { code: "qa", label: "Qualidade" },
                    ].map((s) => (
                      <button
                        key={s.code}
                        onClick={() => handleMove(s.code)}
                        disabled={actionLoading || card.stage === s.code}
                        className={`px-2.5 py-1 text-xs border transition-colors disabled:opacity-40 ${
                          card.stage === s.code
                            ? "border-ink-600 text-ink-400 cursor-default"
                            : "border-ink-700 text-ink-200 hover:border-ink-500 hover:text-ink-100"
                        }`}
                      >
                        {card.stage === s.code ? `● ${s.label}` : s.label}
                      </button>
                    ))}
                  </div>
                  <div className="text-[10px] text-ink-400 mt-1">
                    útil pra voltar uma etapa (ex: de Desenvolvimento para
                    Planejamento) quando algo precisa ser refinado. Dispara o
                    agente da etapa escolhida.
                  </div>
                </div>
              </Section>
            )}

            {isTerminal && (
              <Section title="card finalizado">
                <div className="text-xs text-ink-400 mb-3">
                  Esta feature está em estado terminal (
                  <span className="font-mono">{card.status}</span>). Você pode
                  reabri-la movendo para uma etapa — isso limpa o estado de
                  conclusão/cancelamento e dispara o agente da etapa escolhida.
                </div>
                <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-2">
                  reabrir em etapa
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { code: "discovery", label: "Discovery" },
                    { code: "planning", label: "Planejamento Técnico" },
                    { code: "development", label: "Desenvolvimento" },
                    { code: "qa", label: "Qualidade" },
                  ].map((s) => (
                    <button
                      key={s.code}
                      onClick={() => handleMove(s.code)}
                      disabled={actionLoading}
                      className="px-2.5 py-1 text-xs border border-ink-700 text-ink-200 hover:border-ink-500 hover:text-ink-100 transition-colors disabled:opacity-40"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </Section>
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

// ============================================================
// StagesView: 4 etapas com sessões disparadas + artefatos por etapa
// ============================================================
const STAGE_META: {
  code: string;
  label: string;
  color: string;
  border: string;
}[] = [
  {
    code: "discovery",
    label: "Discovery",
    color: "text-discovery",
    border: "border-discovery",
  },
  {
    code: "planning",
    label: "Planejamento Técnico",
    color: "text-planning",
    border: "border-planning",
  },
  {
    code: "development",
    label: "Desenvolvimento",
    color: "text-development",
    border: "border-development",
  },
  { code: "qa", label: "Qualidade", color: "text-qa", border: "border-qa" },
];

function fileStage(name: string, path: string): string {
  const n = name.toLowerCase();
  const p = path.toLowerCase();
  if (
    n.includes("prd") ||
    n.includes("acceptance") ||
    n.includes("prototype") ||
    p.includes("prototypes/")
  )
    return "discovery";
  if (n.includes("adr") || n.includes("build-order") || n.includes("build_order"))
    return "planning";
  if (
    n.includes("test") ||
    n.includes(".spec.") ||
    p.includes("__tests__") ||
    p.includes("/tests/")
  )
    return "qa";
  return "development";
}

function StagesView({
  stageRuns,
  artifacts,
  feature,
  onOpenFile,
}: {
  stageRuns: any[];
  artifacts: ArtifactsState;
  feature: any;
  onOpenFile: (f: ArtifactFile) => void;
}) {
  // Classifica artefatos por etapa
  const filesByStage: Record<string, ArtifactFile[]> = {
    discovery: [],
    planning: [],
    development: [],
    qa: [],
  };
  for (const f of artifacts.files) {
    const st = fileStage(f.name, f.path);
    filesByStage[st].push(f);
  }
  // chunks → planning; pulls → development
  const runsByStage: Record<string, any[]> = {
    discovery: [],
    planning: [],
    development: [],
    qa: [],
  };
  for (const r of stageRuns) {
    if (runsByStage[r.stage]) runsByStage[r.stage].push(r);
  }

  return (
    <section>
      <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-3">
        // etapas e artefatos
      </div>
      {artifacts.loading && (
        <div className="text-xs text-ink-400 mb-2">
          carregando artefatos do GitHub...
        </div>
      )}
      <div className="space-y-3">
        {STAGE_META.map((meta) => {
          const runs = runsByStage[meta.code];
          const files = filesByStage[meta.code];
          const chunks = meta.code === "planning" ? artifacts.chunks : [];
          const pulls = meta.code === "development" ? artifacts.pulls : [];
          const hasContent =
            runs.length > 0 ||
            files.length > 0 ||
            chunks.length > 0 ||
            pulls.length > 0;

          return (
            <div
              key={meta.code}
              className={`border-l-2 ${meta.border} pl-3 py-1`}
            >
              <div
                className={`text-xs uppercase tracking-widest ${meta.color} mb-2 flex items-center gap-2`}
              >
                {meta.label}
                {runs.length > 0 && (
                  <span className="text-ink-400 normal-case tracking-normal">
                    · {runs.length} sessão{runs.length > 1 ? "es" : ""}
                  </span>
                )}
              </div>

              {!hasContent && (
                <div className="text-[11px] text-ink-400 italic mb-1">
                  nenhuma sessão ou artefato ainda
                </div>
              )}

              {/* Sessões disparadas nesta etapa */}
              {runs.length > 0 && (
                <div className="space-y-1 mb-2">
                  {runs.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-2 text-[11px]"
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
                      <span className="text-ink-300">{r.agent_role ?? "?"}</span>
                      {r.summary && (
                        <span className="text-ink-400 truncate max-w-[200px]">
                          · {r.summary}
                        </span>
                      )}
                      <span className="text-ink-500 ml-auto">
                        {new Date(r.started_at).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Documentos */}
              {files.length > 0 && (
                <div className="space-y-1 mb-1">
                  {files.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => onOpenFile(f)}
                      className="w-full flex items-center justify-between p-1.5 border border-ink-800 hover:border-ink-600 bg-ink-900/40 text-left transition-colors"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <FileIcon name={f.name} />
                        <span className="text-xs text-ink-100 truncate">
                          {f.path.replace(`docs/features/${feature.slug}/`, "")}
                        </span>
                      </div>
                      <span className="text-[10px] text-ink-400 shrink-0">
                        {(f.size / 1024).toFixed(1)}kb
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* Chunks (planning) */}
              {chunks.length > 0 && (
                <div className="space-y-1 mb-1">
                  {chunks.map((c) => (
                    <a
                      key={c.number}
                      href={c.html_url}
                      target="_blank"
                      rel="noopener"
                      className="flex items-center gap-2 p-1.5 border border-ink-800 hover:border-ink-600 bg-ink-900/40 transition-colors"
                    >
                      <span
                        className={`text-[9px] uppercase px-1 py-0.5 border ${
                          c.state === "closed"
                            ? "text-qa border-qa/40"
                            : "text-development border-development/40"
                        }`}
                      >
                        {c.state}
                      </span>
                      <span className="text-xs text-ink-100 truncate flex-1">
                        #{c.number} {c.title}
                      </span>
                      <span className="text-[10px] text-ink-400 shrink-0">↗</span>
                    </a>
                  ))}
                </div>
              )}

              {/* PRs (development) */}
              {pulls.length > 0 && (
                <div className="space-y-1">
                  {pulls.map((pr) => (
                    <a
                      key={pr.number}
                      href={pr.html_url}
                      target="_blank"
                      rel="noopener"
                      className="flex items-center gap-2 p-1.5 border border-ink-800 hover:border-ink-600 bg-ink-900/40 transition-colors"
                    >
                      <span
                        className={`text-[9px] uppercase px-1 py-0.5 border ${
                          pr.state === "merged"
                            ? "text-development border-development/40"
                            : pr.state === "closed"
                              ? "text-qa border-qa/40"
                              : "text-planning border-planning/40"
                        }`}
                      >
                        {pr.draft ? "draft" : pr.state}
                      </span>
                      <span className="text-xs text-ink-100 truncate flex-1">
                        #{pr.number} {pr.title}
                      </span>
                      <span className="text-[10px] text-ink-400 shrink-0">↗</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {artifacts.error && (
        <div className="text-[11px] text-qa border border-qa/40 bg-qa/5 p-2 font-mono mt-2">
          {artifacts.error}
        </div>
      )}
    </section>
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

// Agrupa o status da sessão e propõe ações de destravamento
function SessionHealth({
  cardStatus,
  sessionStatus,
  onSync,
  onRerun,
  loading,
}: {
  cardStatus: string;
  sessionStatus: string;
  onSync: () => void;
  onRerun: () => void;
  loading: boolean;
}) {
  const s = (sessionStatus ?? "unknown").toLowerCase();
  const isActive =
    s.includes("running") ||
    s.includes("pending") ||
    s.includes("starting") ||
    s.includes("progress");
  const isIdle = s.includes("idle");
  const isError = s.includes("error") || s.includes("fail");

  // Card preso: status running mas sessão já parou (idle/ended/error)
  const isStuck = cardStatus === "running" && !isActive;

  if (isActive) {
    return (
      <div className="border border-development/30 bg-development/5 p-2 mb-2 text-[11px] text-ink-300">
        <span className="text-development">● sessão ativa</span> — o agente está
        trabalhando. Aguarde a conclusão.
      </div>
    );
  }

  if (isStuck) {
    return (
      <div className="border border-planning/40 bg-planning/10 p-3 mb-2">
        <div className="text-xs text-planning font-semibold mb-1">
          ⚠ card possivelmente preso
        </div>
        <div className="text-[11px] text-ink-300 mb-2 leading-relaxed">
          A sessão está{" "}
          <span className="font-mono">
            {isIdle ? "ociosa (idle)" : isError ? "com erro" : s}
          </span>{" "}
          mas o card continua em <span className="font-mono">running</span>.
          Isso acontece quando o webhook do Anthropic não chegou. Escolha uma
          ação:
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onSync}
            disabled={loading}
            className="bg-planning text-ink-950 px-2.5 py-1 text-xs font-semibold hover:bg-planning/80 disabled:opacity-50"
          >
            destravar (marcar pronto p/ revisão)
          </button>
          <button
            onClick={onRerun}
            disabled={loading}
            className="border border-development text-development px-2.5 py-1 text-xs hover:bg-development/10 disabled:opacity-50"
          >
            ↻ re-executar etapa
          </button>
        </div>
      </div>
    );
  }

  // Não está preso — só mostra um sync discreto
  return (
    <div className="flex items-center gap-2 mb-2 text-[11px] text-ink-400">
      <span>status agrupado: {isIdle ? "ocioso" : isError ? "erro" : s}</span>
      <button
        onClick={onSync}
        disabled={loading}
        className="ml-auto text-development hover:underline disabled:opacity-50"
      >
        sincronizar status
      </button>
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

function AgentChat({
  cardId,
  stage,
  sessionStatus,
  modelName,
  chatHistory,
  onSent,
}: {
  cardId: string;
  stage: string;
  sessionStatus: string;
  modelName?: string;
  chatHistory: ChatMessage[];
  onSent: () => void;
}) {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<
    { name: string; preview: string; media_type: string; data: string }[]
  >([]);
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [agentName, setAgentName] = useState<string | null>(modelName ?? null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = sessionStatus === "running";

  // Busca o modelo do agente que atua nesta stage
  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((data) => {
        const a = (data.agents ?? []).find(
          (x: any) => x.stage === stage && x.enabled
        );
        if (a) {
          setModel(a.model);
          setAgentName(a.name);
        }
      })
      .catch(() => {});
  }, [stage]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory.length]);

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    for (const f of selected) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 5 * 1024 * 1024) {
        alert(`${f.name} é maior que 5MB`);
        continue;
      }
      const data = await new Promise<string>((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res((reader.result as string).split(",")[1]);
        reader.onerror = rej;
        reader.readAsDataURL(f);
      });
      const preview = URL.createObjectURL(f);
      setImages((prev) => [
        ...prev,
        { name: f.name, preview, media_type: f.type, data },
      ]);
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function removeImage(i: number) {
    setImages((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function send() {
    if (!input.trim() && images.length === 0) return;
    setSending(true);
    try {
      const res = await fetch(`/api/cards/${cardId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          images: images.map((img) => ({
            media_type: img.media_type,
            data: img.data,
          })),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert("erro: " + (j.error ?? res.status));
      } else {
        setInput("");
        setImages([]);
        onSent();
      }
    } finally {
      setSending(false);
    }
  }

  const visibleMessages = chatHistory.filter(
    (m) => m.role !== "system" || chatHistory.length < 3
  );

  return (
    <section>
      <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-2">
        // conversa com o agente
      </div>

      {/* Janela de chat estilo Claude Code */}
      <div className="border border-ink-700 bg-ink-950 flex flex-col">
        {/* Header com modelo e status */}
        <div className="border-b border-ink-800 px-3 py-2 flex items-center gap-2 bg-ink-900/60">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                busy ? "bg-development animate-pulse" : "bg-qa"
              }`}
            />
            <span className="text-xs font-semibold text-ink-100">
              {agentName ?? "Agente"}
            </span>
          </div>
          {model && (
            <span className="text-[10px] font-mono text-ink-400 border border-ink-700 px-1.5 py-0.5">
              {model}
            </span>
          )}
          <span className="ml-auto text-[10px] uppercase tracking-widest text-ink-400">
            {busy ? "executando…" : "pronto"}
          </span>
        </div>

        {/* Mensagens */}
        <div className="max-h-80 overflow-y-auto p-3 space-y-3">
          {visibleMessages.length === 0 && (
            <div className="text-xs text-ink-400 italic text-center py-6">
              comece a conversa — peça mudanças, esclareça requisitos ou
              anexe um print.
            </div>
          )}
          {visibleMessages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} agentName={agentName} />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-[11px] text-development">
              <span className="flex gap-0.5">
                <span className="w-1 h-1 rounded-full bg-development animate-bounce" />
                <span
                  className="w-1 h-1 rounded-full bg-development animate-bounce"
                  style={{ animationDelay: "0.15s" }}
                />
                <span
                  className="w-1 h-1 rounded-full bg-development animate-bounce"
                  style={{ animationDelay: "0.3s" }}
                />
              </span>
              {agentName ?? "agente"} está trabalhando
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Preview de imagens anexadas */}
        {images.length > 0 && (
          <div className="border-t border-ink-800 px-3 py-2 flex flex-wrap gap-2">
            {images.map((img, i) => (
              <div key={i} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.preview}
                  alt={img.name}
                  className="w-14 h-14 object-cover border border-ink-700"
                />
                <button
                  onClick={() => removeImage(i)}
                  className="absolute -top-1.5 -right-1.5 bg-qa text-ink-950 w-4 h-4 flex items-center justify-center text-[10px] leading-none rounded-full"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="border-t border-ink-800 p-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="mensagem para o agente... (ctrl+enter envia)"
            rows={2}
            disabled={sending || busy}
            className="w-full bg-transparent text-sm text-ink-100 px-1 py-1 focus:outline-none resize-none disabled:opacity-50"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="flex items-center gap-2 mt-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              className="hidden"
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={sending || busy}
              title="anexar imagem"
              className="text-ink-400 hover:text-ink-100 text-sm px-1.5 py-1 border border-ink-700 hover:border-ink-500 disabled:opacity-50"
            >
              📎 imagem
            </button>
            <span className="text-[10px] text-ink-500">
              {model ? `rodando em ${model}` : ""}
            </span>
            <button
              onClick={send}
              disabled={sending || busy || (!input.trim() && images.length === 0)}
              className="ml-auto bg-ink-100 text-ink-950 px-4 py-1.5 text-sm font-semibold hover:bg-ink-300 disabled:opacity-50"
            >
              {sending ? "enviando…" : busy ? "agente ocupado" : "enviar"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChatBubble({
  message,
  agentName,
}: {
  message: ChatMessage;
  agentName?: string | null;
}) {
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
    <div className={`flex gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div
        className={`shrink-0 w-6 h-6 flex items-center justify-center text-[10px] font-semibold border ${
          isUser
            ? "border-discovery/40 text-discovery"
            : "border-development/40 text-development"
        }`}
      >
        {isUser ? "EU" : "AI"}
      </div>
      <div
        className={`flex flex-col max-w-[80%] ${
          isUser ? "items-end" : "items-start"
        }`}
      >
        <div className="text-[10px] text-ink-400 mb-0.5">
          {isUser ? "você" : agentName ?? "agente"} ·{" "}
          {new Date(message.created_at).toLocaleTimeString()}
        </div>
        <div
          className={`px-3 py-2 text-xs whitespace-pre-wrap leading-relaxed ${
            isUser
              ? "bg-discovery/10 border border-discovery/40 text-ink-100"
              : "bg-ink-900 border border-ink-700 text-ink-100"
          }`}
        >
          {message.content}
        </div>
      </div>
    </div>
  );
}
