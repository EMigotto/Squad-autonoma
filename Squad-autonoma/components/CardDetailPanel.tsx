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
  const [recovering, setRecovering] = useState(false);
  const recoveringRef = useRef(false);
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
    branch?: string;
    sha?: string;
  } | null>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [currency, setCurrency] = useState("BRL");
  const [stageBreakdown, setStageBreakdown] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"details" | "chat" | "files">("details");
  const [repoTree, setRepoTree] = useState<{
    loading: boolean;
    branch?: string;
    files: { path: string; name: string; ext: string; size: number }[];
    error?: string;
    loaded: boolean;
  }>({ loading: false, files: [], loaded: false });

  async function loadRepoTree() {
    setRepoTree((s) => ({ ...s, loading: true }));
    try {
      const res = await fetch(`/api/cards/${cardId}/repo-tree`);
      const data = await res.json();
      setRepoTree({
        loading: false,
        branch: data.branch,
        files: data.tree ?? [],
        error: data.error,
        loaded: true,
      });
    } catch (e) {
      setRepoTree({ loading: false, files: [], error: String(e), loaded: true });
    }
  }

  async function loadMetrics() {
    try {
      const res = await fetch(`/api/cards/${cardId}/metrics`);
      const data = await res.json();
      setMetrics(data.metrics);
      setCurrency(data.currency ?? "BRL");
      setStageBreakdown(data.stage_breakdown ?? []);
    } catch {
      /* ignore */
    }
  }

  async function saveMetric(patch: { test_coverage_pct?: number | null; human_hours?: number | null }) {
    const res = await fetch(`/api/cards/${cardId}/metrics`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (data.metrics) setMetrics(data.metrics);
  }

  useEffect(() => {
    loadDetail();
    loadChatHistory();
    loadArtifacts();
    loadMetrics();
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
      // Auto-recuperação: se a sessão travou (buffer/erro interno) e ainda não
      // tentamos recriar, dispara a recriação automática uma única vez.
      if (data.session_stuck && !recoveringRef.current) {
        recoveringRef.current = true;
        setRecovering(true);
        try {
          await fetch(`/api/cards/${cardId}/recover-session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "buffer da sessão estourou (detecção automática)" }),
          });
          await loadChatHistory();
        } catch {
          /* deixa o usuário tentar manualmente */
        } finally {
          setRecovering(false);
          // libera nova tentativa após 60s (evita loop se persistir)
          setTimeout(() => { recoveringRef.current = false; }, 60000);
        }
      }
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
    const branch = file.branch ?? artifacts.branch ?? repoTree.branch ?? "main";
    setOpenArtifact({
      path: file.path,
      name: file.name,
      loading: true,
      branch,
    });
    const url = `/api/cards/${cardId}/artifacts/file?path=${encodeURIComponent(
      file.path
    )}&branch=${encodeURIComponent(branch)}`;
    const res = await fetch(url);
    const data = await res.json();
    setOpenArtifact({
      path: file.path,
      name: file.name,
      loading: false,
      content: data.content,
      html_url: data.html_url,
      branch,
      sha: data.sha,
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
  // Chat disponível sempre que existir uma sessão (mesmo ociosa, dá pra retomar)
  // ou já houver histórico de conversa.
  const hasSession = !!card.claude_session_id;
  const canChat = hasSession && !isTerminal;
  const chatTabAvailable = hasSession || chatHistory.length > 0;

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

          {/* Abas */}
          <div className="border-b border-ink-700 flex shrink-0">
            <button
              onClick={() => setActiveTab("details")}
              className={`px-5 py-2.5 text-xs uppercase tracking-widest border-b-2 transition-colors ${
                activeTab === "details"
                  ? "border-development text-ink-100"
                  : "border-transparent text-ink-400 hover:text-ink-200"
              }`}
            >
              detalhes
            </button>
            <button
              onClick={() => setActiveTab("chat")}
              className={`px-5 py-2.5 text-xs uppercase tracking-widest border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === "chat"
                  ? "border-development text-ink-100"
                  : "border-transparent text-ink-400 hover:text-ink-200"
              }`}
            >
              chat
              {chatHistory.filter((m) => m.role !== "system").length > 0 && (
                <span className="text-[10px] bg-ink-700 text-ink-200 rounded-full px-1.5 py-0.5 leading-none">
                  {chatHistory.filter((m) => m.role !== "system").length}
                </span>
              )}
              {canChat && session.status === "running" && (
                <span className="w-1.5 h-1.5 rounded-full bg-development animate-pulse" />
              )}
            </button>
            <button
              onClick={() => { setActiveTab("files"); loadRepoTree(); }}
              className={`px-5 py-2.5 text-xs uppercase tracking-widest border-b-2 transition-colors ${
                activeTab === "files"
                  ? "border-development text-ink-100"
                  : "border-transparent text-ink-400 hover:text-ink-200"
              }`}
            >
              arquivos
            </button>
          </div>

          {activeTab === "files" && (
            <RepoFileBrowser
              tree={repoTree}
              onOpenFile={(path, name, branch) => openFile({ path, name, branch } as ArtifactFile)}
            />
          )}

          {activeTab === "details" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Indicadores do card */}
            <MetricsPanel metrics={metrics} currency={currency} onSave={saveMetric} />

            {/* Custo por etapa (incremental) */}
            <StageCostBreakdown stages={stageBreakdown} currency={currency} />

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

            {isTerminal && card.stage === "done" && (
              <>
                <InfrastructureSection cardId={cardId} />
                <PromoteSection cardId={cardId} />
              </>
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
          )}

          {activeTab === "chat" && (
            <div className="flex-1 flex flex-col min-h-0 p-5">
              {recovering && (
                <div className="mb-3 px-3 py-2 border border-planning/60 bg-planning/10 text-[11px] text-planning font-mono flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-planning animate-pulse" />
                  sessão travou (buffer/erro interno) — recriando automaticamente e retomando de onde parou…
                </div>
              )}
              {chatTabAvailable ? (
                <AgentChat
                  cardId={cardId}
                  stage={card.stage}
                  sessionStatus={session.status}
                  modelName={session.agent_name}
                  chatHistory={chatHistory}
                  canSend={canChat}
                  awaitingReview={isAwaitingReview}
                  onSent={() => {
                    loadChatHistory();
                    loadDetail();
                  }}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-center">
                  <div className="max-w-sm">
                    <div className="text-sm text-ink-300 mb-2">
                      Sem conversa disponível ainda
                    </div>
                    <div className="text-xs text-ink-400 leading-relaxed">
                      O chat com o agente fica disponível assim que uma sessão é
                      disparada nesta etapa. Aprove o card para a próxima etapa
                      ou re-execute a etapa atual para iniciar uma sessão.
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Artifact file viewer modal */}
      {openArtifact && (
        <ArtifactViewer
          artifact={openArtifact}
          cardId={cardId}
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
  cardId,
  onClose,
  onSaved,
}: {
  artifact: {
    path: string;
    name: string;
    content?: string;
    loading: boolean;
    html_url?: string;
    branch?: string;
    sha?: string;
  };
  cardId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const isHtml = artifact.name.toLowerCase().endsWith(".html");
  const isMarkdown =
    artifact.name.toLowerCase().endsWith(".md") ||
    artifact.name.toLowerCase().endsWith(".markdown");
  const isText = isMarkdown || /\.(txt|json|ya?ml|toml|csv)$/i.test(artifact.name);
  const editable = isText; // só edição de texto por enquanto

  const [renderMode, setRenderMode] = useState<"source" | "preview">(
    isHtml ? "preview" : "source"
  );
  const [lang, setLang] = useState<"en" | "pt">("en"); // EN é o canônico
  const [translating, setTranslating] = useState(false);
  const [ptContent, setPtContent] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");
  const [sha, setSha] = useState<string | undefined>(artifact.sha);

  // conteúdo mostrado conforme idioma escolhido
  const enContent = artifact.content ?? "";
  const displayContent = lang === "pt" ? ptContent ?? "" : enContent;

  async function ensurePtTranslation(): Promise<boolean> {
    if (ptContent) return true;
    if (!enContent) return false;
    setTranslating(true);
    setError("");
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: enContent, target: "pt" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(`tradução falhou: ${data.error ?? "HTTP " + res.status}`);
        return false;
      }
      if (!data.translated) {
        setError("tradução vazia retornada");
        return false;
      }
      setPtContent(data.translated);
      return true;
    } catch (e) {
      setError(`tradução falhou: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setTranslating(false);
    }
  }

  async function toggleLang() {
    if (editing) return;
    if (lang === "en") {
      const ok = await ensurePtTranslation();
      if (ok) setLang("pt");
    } else {
      setLang("en");
    }
  }

  function startEdit() {
    setError("");
    setDraft(displayContent);
    setEditing(true);
  }

  async function saveEdit() {
    setSaving(true);
    setError("");
    try {
      // canônico em inglês: se editou em PT, traduz pra EN antes de gravar
      let toWrite = draft;
      if (lang === "pt") {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: draft, target: "en" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `translate HTTP ${res.status}`);
        toWrite = data.translated;
      }

      const putRes = await fetch(`/api/cards/${cardId}/artifacts/file`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: artifact.path,
          branch: artifact.branch ?? "main",
          sha,
          content: toWrite,
          message: `docs: edit ${artifact.path} via squad UI`,
        }),
      });
      const putData = await putRes.json();
      if (!putRes.ok) throw new Error(putData.error ?? `HTTP ${putRes.status}`);

      // atualiza state local: novo SHA, conteúdo EN atual, e refaz PT se estava em PT
      setSha(putData.sha);
      // reflete o que foi salvo
      (artifact as any).content = toWrite;
      if (lang === "pt") setPtContent(draft);
      else setPtContent(null); // invalida PT cache
      setEditing(false);
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-ink-950/95 z-[70] flex items-stretch justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-ink-950 border border-ink-700 w-full max-w-5xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-ink-700 p-4 flex items-center justify-between shrink-0 gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-widest text-ink-400">
              // {artifact.path}
              {artifact.branch && (
                <span className="text-ink-500 ml-2 font-mono">@{artifact.branch}</span>
              )}
            </div>
            <div className="text-base font-semibold truncate">{artifact.name}</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {editable && !editing && (
              <button
                onClick={toggleLang}
                disabled={translating || editing}
                className="text-xs border border-ink-700 px-2 py-1 hover:bg-ink-800 disabled:opacity-50"
                title="ver em outro idioma (canônico é inglês)"
              >
                {translating ? "traduzindo…" : lang === "en" ? "EN · ver PT" : "PT · ver EN"}
              </button>
            )}
            {(isHtml || isMarkdown) && !editing && (
              <button
                onClick={() =>
                  setRenderMode(renderMode === "source" ? "preview" : "source")
                }
                className="text-xs text-development hover:underline px-2"
              >
                {renderMode === "source" ? "preview" : "source"}
              </button>
            )}
            {editable && !editing && (
              <button
                onClick={startEdit}
                disabled={artifact.loading || !sha}
                className="text-xs bg-discovery text-ink-950 px-3 py-1 font-semibold hover:bg-discovery/80 disabled:opacity-50"
              >
                editar
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={saveEdit}
                  disabled={saving}
                  className="text-xs bg-qa text-ink-950 px-3 py-1 font-semibold hover:bg-qa/80 disabled:opacity-50"
                >
                  {saving ? "salvando…" : "salvar"}
                </button>
                <button
                  onClick={() => { setEditing(false); setError(""); }}
                  disabled={saving}
                  className="text-xs border border-ink-700 px-2 py-1 hover:bg-ink-800"
                >
                  cancelar
                </button>
              </>
            )}
            {artifact.html_url && !editing && (
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

        {error && (
          <div className="px-4 py-2 border-b border-qa/40 bg-qa/10 text-xs text-qa">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {artifact.loading && (
            <div className="p-8 text-center text-sm text-ink-300">carregando...</div>
          )}

          {!artifact.loading && editing && (
            <div className="p-4 space-y-2">
              <div className="text-[10px] uppercase tracking-widest text-ink-400">
                editando em {lang === "pt" ? "PT (será salvo em EN)" : "EN (canônico)"}
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="w-full h-[70vh] bg-ink-900 border border-ink-700 p-3 text-xs font-mono text-ink-100 leading-relaxed focus:border-discovery focus:outline-none resize-none"
              />
            </div>
          )}

          {!artifact.loading && !editing && displayContent && (
            <>
              {isHtml && renderMode === "preview" ? (
                <iframe
                  srcDoc={displayContent}
                  sandbox="allow-scripts"
                  className="w-full h-[80vh] border-0 bg-white"
                  title={artifact.name}
                />
              ) : isMarkdown && renderMode === "preview" ? (
                <MarkdownPreview content={displayContent} />
              ) : (
                <pre className="p-4 text-xs text-ink-100 whitespace-pre-wrap font-mono leading-relaxed">
                  {displayContent}
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

function fmtCycleH(hours: number | null | undefined): string {
  if (hours == null) return "—";
  const h = Number(hours);
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)} dias`;
}

function MetricsPanel({
  metrics,
  currency,
  onSave,
}: {
  metrics: any;
  currency: string;
  onSave: (p: { test_coverage_pct?: number | null; human_hours?: number | null }) => void;
}) {
  const [cov, setCov] = useState<string>("");
  const [hrs, setHrs] = useState<string>("");
  const [cplx, setCplx] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (metrics) {
      setCov(metrics.test_coverage_pct != null ? String(metrics.test_coverage_pct) : "");
      setHrs(metrics.human_hours != null ? String(metrics.human_hours) : "");
      setCplx(metrics.complexity ?? null);
    }
  }, [metrics]);

  if (!metrics) return null;

  const approval =
    metrics.gates_total > 0
      ? metrics.first_pass
        ? "1ª tentativa"
        : `${metrics.gates_rejected} rejeição(ões)`
      : "—";

  const humanCost = Number(metrics.human_cost ?? 0);
  const tokenCost = Number(metrics.token_cost ?? 0);
  const totalCost = Number(metrics.total_cost ?? humanCost + tokenCost);
  const moneyFmt = (n: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(n);
  const tiles = [
    { label: "Cycle time", value: fmtCycleH(metrics.cycle_time_hours), tone: "text-development", sub: metrics.is_done ? "concluído" : "em andamento" },
    { label: "Aprovação", value: metrics.gates_total > 0 ? (metrics.first_pass ? "✓" : "✗") : "—", tone: metrics.gates_total > 0 && metrics.first_pass ? "text-qa" : "text-discovery", sub: approval },
    { label: "Cobertura", value: metrics.test_coverage_pct != null ? `${Number(metrics.test_coverage_pct).toFixed(0)}%` : "—", tone: metrics.test_coverage_pct != null && Number(metrics.test_coverage_pct) >= 80 ? "text-qa" : "text-ink-300", sub: "meta ≥ 80%" },
    {
      label: "Custo",
      value: moneyFmt(totalCost),
      tone: "text-planning",
      sub: `${moneyFmt(humanCost)} humano + ${moneyFmt(tokenCost)} tokens · ${Number(metrics.human_hours ?? 0).toFixed(2)}h`,
    },
  ];

  return (
    <Section title="indicadores">
      <div className="grid grid-cols-4 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="border border-ink-700 bg-ink-900/40 p-2.5">
            <div className="text-[9px] uppercase tracking-wider text-ink-400 mb-1">{t.label}</div>
            <div className={`text-lg font-semibold leading-none ${t.tone}`}>{t.value}</div>
            <div className="text-[9px] text-ink-500 mt-1">{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-2 text-[10px] flex-wrap">
        <span className="uppercase tracking-wider text-ink-400">complexidade (ROI)</span>
        {(["S", "M", "L", "XL"] as const).map((t) => (
          <button
            key={t}
            onClick={async () => {
              await fetch(`/api/cards/${metrics.card_id}/complexity`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ complexity: t }),
              });
              metrics.complexity = t;
              setCplx(t);
            }}
            className={`px-2 py-0.5 border font-mono ${
              cplx === t ? "border-discovery text-discovery" : "border-ink-700 text-ink-400"
            }`}
          >
            {t}
          </button>
        ))}
        <span className="text-ink-500">
          {cplx ? "tag fixa desta feature" : "vazio · usa LOC, ou o tamanho padrão no ROI"}
        </span>
      </div>

      <div className="mt-2">
        {editing ? (
          <div className="flex items-end gap-2">
            <div>
              <label className="text-[10px] text-ink-400 block mb-0.5">cobertura %</label>
              <input
                type="number"
                value={cov}
                onChange={(e) => setCov(e.target.value)}
                className="w-20 bg-ink-900 border border-ink-700 px-2 py-1 text-xs text-ink-100 focus:border-discovery focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[10px] text-ink-400 block mb-0.5">horas humanas</label>
              <input
                type="number"
                value={hrs}
                onChange={(e) => setHrs(e.target.value)}
                className="w-24 bg-ink-900 border border-ink-700 px-2 py-1 text-xs text-ink-100 focus:border-discovery focus:outline-none"
              />
            </div>
            <button
              onClick={() => {
                onSave({
                  test_coverage_pct: cov === "" ? null : Number(cov),
                  human_hours: hrs === "" ? null : Number(hrs),
                });
                setEditing(false);
              }}
              className="bg-discovery text-ink-950 px-3 py-1 text-xs font-semibold hover:bg-discovery/80"
            >
              salvar
            </button>
            <button onClick={() => setEditing(false)} className="text-xs text-ink-400 hover:text-ink-100 px-2 py-1">
              cancelar
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="text-[11px] text-development hover:underline"
          >
            ajustar cobertura / horas humanas
          </button>
        )}
      </div>
    </Section>
  );
}

function StageCostBreakdown({ stages, currency }: { stages: any[]; currency: string }) {
  if (!stages || stages.length === 0) return null;
  const fmt = (n: number) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: currency || "BRL",
    }).format(Number(n || 0));
  const STAGE_LABEL: Record<string, string> = {
    discovery: "Discovery",
    planning: "Planejamento",
    development: "Desenvolvimento",
    qa: "Qualidade (QA)",
    done: "Concluído",
  };
  const total = stages.length ? stages[stages.length - 1].running_total : 0;
  return (
    <section className="border border-ink-700 bg-ink-900/40 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="text-xs uppercase tracking-widest text-ink-400">
          // custo por etapa
        </h3>
        <div className="text-[11px] text-ink-400">
          total acumulado:{" "}
          <span className="text-ink-100 font-mono">{fmt(total)}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-widest text-ink-500">
            <tr>
              <th className="text-left py-1 pr-3">etapa</th>
              <th className="text-right py-1 px-2">tokens in</th>
              <th className="text-right py-1 px-2">tokens out</th>
              <th className="text-right py-1 px-2">custo tokens</th>
              <th className="text-right py-1 px-2">horas</th>
              <th className="text-right py-1 px-2">custo humano</th>
              <th className="text-right py-1 px-2">total etapa</th>
              <th className="text-right py-1 pl-2">acumulado</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.id} className="border-t border-ink-800">
                <td className="py-1 pr-3">
                  <div className="text-ink-200">{STAGE_LABEL[s.stage] ?? s.stage}</div>
                  <div className="text-[10px] text-ink-500">
                    {s.agent_role}
                    {s.model && (
                      <span className="ml-1 text-ink-600">· {s.model}</span>
                    )}
                  </div>
                </td>
                <td className="text-right py-1 px-2 font-mono text-ink-300">
                  {s.input_tokens.toLocaleString("pt-BR")}
                </td>
                <td className="text-right py-1 px-2 font-mono text-ink-300">
                  {s.output_tokens.toLocaleString("pt-BR")}
                </td>
                <td className="text-right py-1 px-2 font-mono text-ink-200">
                  {fmt(s.token_cost)}
                </td>
                <td className="text-right py-1 px-2 font-mono text-ink-300">
                  {s.human_hours.toFixed(2)}
                </td>
                <td className="text-right py-1 px-2 font-mono text-ink-200">
                  {fmt(s.human_cost)}
                </td>
                <td className="text-right py-1 px-2 font-mono text-ink-100 font-semibold">
                  {fmt(s.total_cost)}
                </td>
                <td className="text-right py-1 pl-2 font-mono text-development">
                  {fmt(s.running_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-ink-500 mt-2 leading-relaxed">
        Custo de tokens é <strong>automático</strong>: usa a tabela oficial de
        preços da Anthropic por modelo (USD/Mtok), convertida em BRL pelo câmbio
        configurado em Settings → indicadores & custos. Horas humanas usam a
        duração da etapa multiplicada pelo custo/hora do time. Captura ocorre
        ao término de cada execução.
      </div>
    </section>
  );
}

function InfrastructureSection({ cardId }: { cardId: string }) {
  const [generating, setGenerating] = useState(false);
  const [summary, setSummary] = useState<string>("");
  const [artifactUrl, setArtifactUrl] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function generate() {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch(`/api/cards/${cardId}/infrastructure-summary`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? `HTTP ${res.status}`);
      else {
        setSummary(data.summary ?? "");
        setArtifactUrl(data.artifact_url ?? "");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Section title="infraestrutura necessária">
      <div className="text-xs text-ink-400 mb-3 leading-relaxed">
        Sintetiza tudo que essa feature precisa para rodar — bancos, caches,
        filas, buckets, serviços de terceiros, variáveis de ambiente — a partir
        do PRD, do plano, dos ADRs e do{" "}
        <span className="font-mono text-ink-300">infrastructure.md</span>{" "}
        mantido pelos agentes durante o desenvolvimento. Usa o modelo mais forte
        (Opus 4.7) e termina com um bloco JSON pronto pra ser lido por um
        provisionador via MCP.
      </div>
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={generate}
          disabled={generating}
          className="bg-discovery text-ink-950 px-4 py-1.5 text-sm font-semibold hover:bg-discovery/80 disabled:opacity-50"
        >
          {generating ? "gerando com Opus…" : summary ? "regerar resumo" : "gerar resumo de infraestrutura"}
        </button>
        {artifactUrl && (
          <a
            href={artifactUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-development hover:underline"
          >
            ver artefato salvo no GitHub ↗
          </a>
        )}
        {error && <span className="text-xs text-qa">erro: {error}</span>}
      </div>
      {summary && (
        <div className="border border-ink-700 bg-ink-900/40 p-3 max-h-[60vh] overflow-y-auto">
          <pre className="text-xs text-ink-100 whitespace-pre-wrap font-mono leading-relaxed">
            {summary}
          </pre>
        </div>
      )}
    </Section>
  );
}

function PromoteSection({ cardId }: { cardId: string }) {
  const [promoting, setPromoting] = useState(false);
  const [result, setResult] = useState<{ pr_url?: string; error?: string }>({});

  async function promote() {
    setPromoting(true);
    setResult({});
    try {
      const res = await fetch(`/api/cards/${cardId}/promote`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) setResult({ error: data.error ?? `HTTP ${res.status}` });
      else setResult({ pr_url: data.pr_url });
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setPromoting(false);
    }
  }

  return (
    <Section title="elevar ambiente">
      <div className="text-xs text-ink-400 mb-3 leading-relaxed">
        Abre um único Pull Request da branch do ambiente atual para a branch do
        ambiente destino (definido na configuração da aplicação como{" "}
        <span className="text-ink-200">promove para</span>). O PR carrega tudo
        que foi entregue neste ambiente desde a última promoção.
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={promote}
          disabled={promoting}
          className="bg-qa text-ink-950 px-4 py-1.5 text-sm font-semibold hover:bg-qa/80 disabled:opacity-50"
        >
          {promoting ? "abrindo PR…" : "elevar ambiente →"}
        </button>
        {result.pr_url && (
          <a
            href={result.pr_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-development hover:underline"
          >
            PR aberto: {result.pr_url} ↗
          </a>
        )}
        {result.error && (
          <span className="text-xs text-qa">erro: {result.error}</span>
        )}
      </div>
    </Section>
  );
}

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
    n.includes("qa-report") ||
    n.includes("qa_report") ||
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
  canSend = true,
  awaitingReview = false,
  onSent,
}: {
  cardId: string;
  stage: string;
  sessionStatus: string;
  modelName?: string;
  chatHistory: ChatMessage[];
  canSend?: boolean;
  awaitingReview?: boolean;
  onSent: () => void;
}) {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<
    { name: string; preview: string; media_type: string; data: string }[]
  >([]);
  const [sending, setSending] = useState(false);
  const [regenMode, setRegenMode] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
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

  async function regenerate() {
    if (!input.trim() || regenerating) return;
    if (
      !confirm(
        "Isso vai REGERAR esta etapa: a tentativa atual é rejeitada e o agente roda de novo aplicando o ajuste que você escreveu. Continuar?"
      )
    )
      return;
    setRegenerating(true);
    try {
      const res = await fetch(`/api/cards/${cardId}/harness`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: input }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert("erro: " + (j.error ?? res.status));
      } else {
        setInput("");
        setRegenMode(false);
        onSent();
      }
    } finally {
      setRegenerating(false);
    }
  }

  const visibleMessages = chatHistory;

  return (
    <section className="flex-1 flex flex-col min-h-0">
      <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-2">
        // conversa com o agente
      </div>

      {/* Janela de chat estilo Claude Code */}
      <div className="border border-ink-700 bg-ink-950 flex flex-col flex-1 min-h-0">
        {/* Header com modelo e status */}
        <div className="border-b border-ink-800 px-3 py-2 flex items-center gap-2 bg-ink-900/60 shrink-0">
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
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
          {visibleMessages.length === 0 && (
            <div className="text-xs text-ink-400 italic text-center py-6">
              comece a conversa — peça mudanças, esclareça requisitos ou
              anexe um print.
            </div>
          )}
          {visibleMessages.map((msg) => (
            <ChatBubble
              key={msg.id}
              message={msg}
              agentName={agentName}
              onRequestFix={(errText) => {
                setInput(
                  `O agente reportou o seguinte erro na última execução:\n\n${errText}\n\nPor favor, corrija esse erro e refaça a etapa. Não altere o que já está funcionando.`
                );
              }}
            />
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
        {canSend ? (
        <div className="border-t border-ink-800 p-2 shrink-0">
          {awaitingReview && (
            <div className="flex gap-1 mb-2 text-[10px] font-mono">
              <button
                onClick={() => setRegenMode(false)}
                className={`px-2 py-1 border ${!regenMode ? "border-ink-100 text-ink-100" : "border-ink-700 text-ink-400"}`}
              >
                conversar com o agente
              </button>
              <button
                onClick={() => setRegenMode(true)}
                className={`px-2 py-1 border ${regenMode ? "border-planning text-planning" : "border-ink-700 text-ink-400"}`}
              >
                🔄 regerar etapa com ajuste
              </button>
            </div>
          )}
          {regenMode && (
            <div className="text-[10px] text-planning/90 mb-1 leading-snug">
              o que você escrever entra como correção: a tentativa atual é rejeitada e
              {agentName ? ` o ${agentName}` : " o agente"} roda esta etapa de novo aplicando o ajuste.
            </div>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              regenMode
                ? "ex: você não considerou a etapa de assinatura digital no fluxo — inclua o serviço de carimbo do tempo e o ADR correspondente."
                : "mensagem para o agente... (ctrl+enter envia)"
            }
            rows={2}
            disabled={sending || busy || regenerating}
            className="w-full bg-transparent text-sm text-ink-100 px-1 py-1 focus:outline-none resize-none disabled:opacity-50"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                regenMode ? regenerate() : send();
              }
            }}
          />
          <div className="flex items-center gap-2 mt-1">
            {!regenMode && (
              <>
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
              </>
            )}
            <span className="text-[10px] text-ink-500">
              {model ? `rodando em ${model}` : ""}
            </span>
            {regenMode ? (
              <button
                onClick={regenerate}
                disabled={regenerating || !input.trim()}
                className="ml-auto bg-planning text-ink-950 px-4 py-1.5 text-sm font-semibold hover:bg-planning/80 disabled:opacity-50"
              >
                {regenerating ? "regerando…" : "🔄 regerar etapa"}
              </button>
            ) : (
              <button
                onClick={send}
                disabled={sending || busy || (!input.trim() && images.length === 0)}
                className="ml-auto bg-ink-100 text-ink-950 px-4 py-1.5 text-sm font-semibold hover:bg-ink-300 disabled:opacity-50"
              >
                {sending ? "enviando…" : busy ? "agente ocupado" : "enviar"}
              </button>
            )}
          </div>
        </div>
        ) : (
          <div className="border-t border-ink-800 p-3 shrink-0 text-[11px] text-ink-400 text-center">
            sessão encerrada — re-execute a etapa ou avance o card para iniciar
            uma nova sessão e voltar a conversar com o agente.
          </div>
        )}
      </div>
    </section>
  );
}

function ChatBubble({
  message,
  agentName,
  onRequestFix,
}: {
  message: ChatMessage;
  agentName?: string | null;
  onRequestFix?: (errText: string) => void;
}) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isError = isSystem && message.content.startsWith("⚠ ERRO");
  if (isError) {
    const ts = new Date(message.created_at).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    // tira o prefixo e a instrução final pra extrair só o erro pro botão
    const body = message.content.replace(/^⚠ ERRO DETECTADO NA EXECUÇÃO:\n?/, "");
    const errOnly = body.split("\n\nA etapa NÃO foi concluída")[0].trim();
    return (
      <div className="border border-planning/60 bg-planning/10 p-3 text-[11px]">
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-planning font-semibold uppercase tracking-wide">
            ⚠ erro na execução
          </span>
          <span className="text-ink-500 font-mono">{ts}</span>
        </div>
        <div className="whitespace-pre-wrap leading-snug text-ink-200 font-mono text-[10px] bg-ink-950 border border-ink-700 p-2 overflow-x-auto">
          {errOnly}
        </div>
        <div className="mt-2 text-ink-300">
          A etapa não foi concluída com sucesso. Peça a correção:
        </div>
        {onRequestFix && (
          <button
            onClick={() => onRequestFix(errOnly)}
            className="mt-2 px-3 py-1.5 bg-planning text-white font-mono text-[11px] hover:opacity-90"
          >
            ↻ pedir correção ao agente
          </button>
        )}
      </div>
    );
  }
  if (isSystem) {
    const ts = new Date(message.created_at).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return (
      <div className="flex gap-2 items-start text-[11px] text-ink-300 border-l-2 border-development/40 pl-2 py-1">
        <span className="text-ink-500 shrink-0 font-mono">{ts}</span>
        <span className="leading-snug whitespace-pre-wrap">{message.content}</span>
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

// Navegador de arquivos do repo (árvore completa da working branch).
// Agrupa por pasta e permite abrir qualquer arquivo gerado pelos agentes.
function RepoFileBrowser({
  tree,
  onOpenFile,
}: {
  tree: {
    loading: boolean;
    branch?: string;
    files: { path: string; name: string; ext: string; size: number }[];
    error?: string;
    loaded: boolean;
  };
  onOpenFile: (path: string, name: string, branch?: string) => void;
}) {
  const [filter, setFilter] = useState("");

  if (tree.loading)
    return <div className="p-6 text-xs text-ink-400 italic">carregando árvore do repositório…</div>;
  if (tree.error)
    return <div className="p-6 text-xs text-qa">erro ao listar arquivos: {tree.error}</div>;
  if (!tree.files.length)
    return <div className="p-6 text-xs text-ink-400 italic">nenhum arquivo encontrado nesta branch.</div>;

  const q = filter.trim().toLowerCase();
  const files = q
    ? tree.files.filter((f) => f.path.toLowerCase().includes(q))
    : tree.files;

  // agrupa por diretório
  const byDir: Record<string, typeof files> = {};
  for (const f of files) {
    const dir = f.path.includes("/") ? f.path.split("/").slice(0, -1).join("/") : "(raiz)";
    (byDir[dir] = byDir[dir] || []).push(f);
  }
  const dirs = Object.keys(byDir).sort();

  const icon = (ext: string) => {
    if (ext === "md") return "📄";
    if (ext === "html" || ext === "htm") return "🌐";
    if (ext === "docx" || ext === "doc") return "📝";
    if (ext === "fig") return "🎨";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼";
    if (["ts", "tsx", "js", "jsx", "py", "go", "java", "rb", "css", "json"].includes(ext)) return "⟨⟩";
    return "•";
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3">
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="text-[11px] font-mono text-ink-400">
          // arquivos do repo {tree.branch && <>· branch <strong className="text-ink-200">{tree.branch}</strong></>} · {tree.files.length}
        </span>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filtrar por nome/caminho…"
          className="bg-ink-900 border border-ink-700 px-2 py-1 text-xs text-ink-100 focus:border-discovery focus:outline-none w-48"
        />
      </div>
      <div className="space-y-3">
        {dirs.map((dir) => (
          <div key={dir}>
            <div className="text-[10px] uppercase tracking-wider text-ink-500 font-mono mb-1">{dir}/</div>
            <div className="space-y-0.5">
              {byDir[dir].map((f) => (
                <button
                  key={f.path}
                  onClick={() => onOpenFile(f.path, f.name, tree.branch)}
                  className="w-full text-left flex items-center gap-2 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800 border border-transparent hover:border-ink-700"
                >
                  <span className="shrink-0 w-4 text-center text-ink-400">{icon(f.ext)}</span>
                  <span className="truncate">{f.name}</span>
                  {f.size > 0 && (
                    <span className="ml-auto shrink-0 text-[10px] text-ink-500 font-mono">
                      {f.size > 1024 ? `${(f.size / 1024).toFixed(0)}kb` : `${f.size}b`}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
