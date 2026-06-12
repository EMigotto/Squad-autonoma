"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { createClient } from "@/lib/supabase/client";
import Column from "./Column";
import AssistantFAB from "./AssistantFAB";
import { APP_VERSION } from "@/lib/version";
import FeatureCard from "./FeatureCard";
import CreateFeatureDialog from "./CreateFeatureDialog";
import CardDetailPanel from "./CardDetailPanel";
import TransitionDialog from "./TransitionDialog";

interface Props {
  currentUser: { id: string; name: string; role: string };
  initialStages: { code: string; label: string; sort_order: number }[];
  initialCards: any[];
  settings: any;
  projects?: { id: string; name: string; sigla: string; github_repo: string | null }[];
  activeProjectId?: string | null;
  diagnostics?: {
    stagesError?: string;
    cardsError?: string;
    stagesFromFallback?: boolean;
    noProject?: boolean;
  };
}

const STAGE_ORDER = ["backlog", "discovery", "planning", "development", "qa", "done"];
const NEXT_STAGE: Record<string, string> = {
  backlog: "discovery",
  discovery: "planning",
  planning: "development",
  development: "qa",
  qa: "done",
};

export default function Board({
  currentUser,
  initialStages,
  initialCards,
  settings,
  projects = [],
  activeProjectId,
  diagnostics,
}: Props) {
  const [cards, setCards] = useState(initialCards);
  const [activeCard, setActiveCard] = useState<any | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [transitionCardId, setTransitionCardId] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  useEffect(() => {
    const sb = createClient();
    const channel = sb
      .channel("board-cards")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cards" },
        () => refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "human_gates" },
        () => refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "features" },
        () => refresh()
      )
      .subscribe();

    return () => {
      sb.removeChannel(channel);
    };

    async function refresh() {
      let query = sb
        .from("cards")
        .select(
          `id, stage, status, claude_session_id, updated_at,
           feature:features!inner ( id, slug, title, github_repo, claude_environment_id, project_id ),
           human_gates ( id, summary, decision, assignee_id ),
               metrics:card_metrics ( cycle_time_hours, first_pass, gates_total, gates_rejected, test_coverage_pct, total_cost, is_done )`
        )
        .order("updated_at", { ascending: false });
      if (activeProjectId) {
        query = query.eq("feature.project_id", activeProjectId);
      }
      const { data } = await query;
      if (data) setCards(data);
    }
  }, [activeProjectId]);

  // Polling proativo: a cada 15s consulta o status real das sessões e
  // destrava cards presos (sessão ociosa no Claude mas card ainda "running").
  // Isso mantém a tela atualizada mesmo quando o webhook do Anthropic não chega.
  useEffect(() => {
    let active = true;
    const sb = createClient();

    async function syncAndRefresh() {
      try {
        const res = await fetch("/api/cards/sync-running", { method: "POST" });
        const data = await res.json().catch(() => ({}));
        if (!active) return;
        // Se algum card foi destravado, recarrega os cards
        if (data?.unlocked > 0 || true) {
          let query = sb
            .from("cards")
            .select(
              `id, stage, status, claude_session_id, updated_at,
               feature:features!inner ( id, slug, title, github_repo, claude_environment_id, project_id ),
               human_gates ( id, summary, decision, assignee_id ),
               metrics:card_metrics ( cycle_time_hours, first_pass, gates_total, gates_rejected, test_coverage_pct, total_cost, is_done )`
            )
            .order("updated_at", { ascending: false });
          if (activeProjectId) {
            query = query.eq("feature.project_id", activeProjectId);
          }
          const { data: cardsData } = await query;
          if (active && cardsData) setCards(cardsData);
        }
      } catch {
        // silencioso — é polling de fundo
      }
    }

    const interval = setInterval(syncAndRefresh, 15000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [activeProjectId]);

  // Polling proativo: a cada 20s consulta o status real das sessões dos cards
  // "running" e destrava os que já estão ociosos no Claude (fallback caso o
  // webhook não chegue). O realtime atualiza a UI quando algo muda.
  useEffect(() => {
    let stopped = false;

    async function tick() {
      const hasRunning = cards.some((c) => c.status === "running");
      if (!hasRunning) return;
      try {
        const res = await fetch("/api/cards/sync-running", { method: "POST" });
        const data = await res.json();
        if (!stopped && data.synced && data.synced.length > 0) {
          // força refresh imediato da lista
          const sb = createClient();
          let query = sb
            .from("cards")
            .select(
              `id, stage, status, claude_session_id, updated_at,
               feature:features!inner ( id, slug, title, github_repo, claude_environment_id, project_id ),
               human_gates ( id, summary, decision, assignee_id ),
               metrics:card_metrics ( cycle_time_hours, first_pass, gates_total, gates_rejected, test_coverage_pct, total_cost, is_done )`
            )
            .order("updated_at", { ascending: false });
          if (activeProjectId) query = query.eq("feature.project_id", activeProjectId);
          const { data: fresh } = await query;
          if (fresh && !stopped) setCards(fresh);
        }
      } catch {
        // silencioso
      }
    }

    const interval = setInterval(tick, 20000);
    // primeira checagem após 5s
    const initial = setTimeout(tick, 5000);
    return () => {
      stopped = true;
      clearInterval(interval);
      clearTimeout(initial);
    };
  }, [cards, activeProjectId]);

  // Dedup por feature: cada feature deve aparecer UMA vez, no stage mais
  // avançado. Cards órfãos (criados pela versão antiga que duplicava) são
  // colapsados aqui. Se o card mais avançado está cancelled, a feature inteira
  // conta como cancelada.
  const STAGE_RANK: Record<string, number> = {
    backlog: -1,
    discovery: 0,
    planning: 1,
    development: 2,
    qa: 3,
    done: 4,
  };

  const { canonicalActive, cancelledFeatures } = useMemo(() => {
    const byFeature = new Map<string, any[]>();
    for (const c of cards) {
      const fid = c.feature?.id ?? c.feature_id ?? c.id;
      if (!byFeature.has(fid)) byFeature.set(fid, []);
      byFeature.get(fid)!.push(c);
    }

    const active: any[] = [];
    const cancelled: any[] = [];

    for (const [, group] of byFeature) {
      const nonCancelled = group.filter((c) => c.status !== "cancelled");
      if (nonCancelled.length === 0) {
        // feature totalmente cancelada — pega o card mais avançado pra exibir
        const top = group.sort(
          (a, b) => (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0)
        )[0];
        cancelled.push(top);
        continue;
      }
      // card canônico = stage mais avançado entre os não cancelados
      const canonical = nonCancelled.sort(
        (a, b) => (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0)
      )[0];
      active.push(canonical);
    }

    return { canonicalActive: active, cancelledFeatures: cancelled };
  }, [cards]);

  const activeCards = canonicalActive;
  const cancelledCards = cancelledFeatures;

  const cardsByStage = useMemo(() => {
    const acc: Record<string, any[]> = {};
    for (const s of STAGE_ORDER) acc[s] = [];
    for (const c of activeCards) {
      if (acc[c.stage]) acc[c.stage].push(c);
    }
    return acc;
  }, [activeCards]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  function handleDragStart(e: DragStartEvent) {
    setDragError(null);
    const card = cards.find((c) => c.id === e.active.id);
    setActiveCard(card);
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveCard(null);
    if (!over) return;
    const card = cards.find((c) => c.id === active.id);
    if (!card) return;
    const targetStage = String(over.id);
    if (targetStage === card.stage) return;

    const expectedNext = NEXT_STAGE[card.stage];
    if (targetStage !== expectedNext) {
      setDragError(
        `não dá pra pular etapas. ${card.stage} → ${expectedNext} é o próximo passo.`
      );
      setTimeout(() => setDragError(null), 4000);
      return;
    }

    if (card.status !== "awaiting_review") {
      setDragError(
        `card precisa estar em "aguarda revisão" pra avançar (atual: ${card.status})`
      );
      setTimeout(() => setDragError(null), 4000);
      return;
    }

    setTransitionCardId(card.id);
  }

  async function handleProjectChange(projectId: string) {
    await fetch("/api/projects/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId }),
    });
    window.location.reload();
  }

  const activeProject = projects.find((p) => p.id === activeProjectId);

  const totalCards = activeCards.length;
  const openGates = activeCards.filter((c) =>
    c.human_gates?.some(
      (g: any) => g.decision === null && g.assignee_id === currentUser.id
    )
  ).length;

  return (
    <div className="min-h-screen flex flex-col">
      <AssistantFAB />
      {/* Faixa de marca Cielo */}
      <div className="brand-band bg-[#00263A] text-white px-6 py-2 flex items-center justify-between">
        <div className="font-mono text-base tracking-tight flex items-center gap-1.5">
          <span className="text-[#A6CE39]">{"{"}</span>
          <span className="font-bold">V.AI</span>
          <span className="text-[#00AEEF] font-bold">.be</span>
          <span className="text-[#A6CE39]">{"}"}</span>
          <span className="ml-2 font-semibold tracking-wide">Cielo</span>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-white/60">esteira autônoma de engenharia</span>
          <span className="version-chip font-mono bg-white/10 border border-white/15 px-2 py-0.5 rounded-full text-white/90">
            v{APP_VERSION}
          </span>
        </div>
      </div>
      <header className="border-b border-ink-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div>
            <div className="text-xs uppercase tracking-widest text-ink-400">
              {"{V.AI.be} Cielo"}
            </div>
            <div className="text-sm">
              olá, <span className="text-ink-100">{currentUser.name}</span>
              <span className="text-ink-400"> · {currentUser.role}</span>
            </div>
          </div>

          {/* Seletor de projeto */}
          <div className="flex items-center gap-2 border-l border-ink-700 pl-6">
            <span className="text-[10px] uppercase tracking-widest text-ink-400">
              time
            </span>
            {projects.length > 0 ? (
              <select
                value={activeProjectId ?? ""}
                onChange={(e) => handleProjectChange(e.target.value)}
                className="bg-ink-900 border border-ink-700 px-2 py-1 text-sm text-ink-100 focus:border-discovery focus:outline-none"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.sigla}] {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <Link
                href="/settings"
                className="text-xs text-planning hover:underline"
              >
                criar time →
              </Link>
            )}
          </div>

          <div className="flex items-center gap-4 text-xs text-ink-400">
            <span>
              <span className="text-ink-100">{totalCards}</span> ativos
            </span>
            {cancelledCards.length > 0 && (
              <span className="text-ink-400">
                <span className="text-ink-100">{cancelledCards.length}</span>{" "}
                cancelados
              </span>
            )}
            {openGates > 0 && (
              <span className="text-planning">
                <span className="font-semibold">{openGates}</span> aguardam você
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/infra"
            className="text-xs uppercase tracking-widest text-development hover:text-ink-100 px-3 py-1.5"
          >
            infra
          </Link>
          <Link
            href="/onboarding"
            className="text-xs uppercase tracking-widest text-qa hover:text-ink-100 px-3 py-1.5"
          >
            🧭 app legada
          </Link>
          <Link
            href="/manual"
            className="text-xs uppercase tracking-widest text-ink-300 hover:text-ink-100 px-3 py-1.5"
          >
            manual
          </Link>
          <Link
            href="/dashboards"
            className="text-xs uppercase tracking-widest text-ink-300 hover:text-ink-100 px-3 py-1.5"
          >
            dashboards
          </Link>
          <Link
            href="/settings"
            className="text-xs uppercase tracking-widest text-ink-300 hover:text-ink-100 px-3 py-1.5"
          >
            settings
          </Link>
          <Link
            href="/admin/setup"
            className="text-xs uppercase tracking-widest text-ink-300 hover:text-ink-100 px-3 py-1.5"
          >
            admin
          </Link>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-ink-100 text-ink-950 px-3 py-1.5 text-sm font-semibold hover:bg-ink-300 transition-colors"
          >
            + nova feature
          </button>
        </div>
      </header>

      {diagnostics?.noProject && (
        <div className="border-b border-planning bg-planning/10 px-6 py-2 text-xs text-planning font-mono">
          ⚠ nenhum time ativo. Crie um time em{" "}
          <Link href="/settings" className="underline">
            /settings
          </Link>{" "}
          para começar.
        </div>
      )}
      {diagnostics?.stagesError && (
        <div className="border-b border-qa bg-qa/10 px-6 py-2 text-xs text-qa font-mono">
          aviso: erro ao carregar stages — {diagnostics.stagesError}. Usando fallback.
        </div>
      )}
      {diagnostics?.stagesFromFallback && !diagnostics?.stagesError && (
        <div className="border-b border-planning bg-planning/10 px-6 py-2 text-xs text-planning font-mono">
          aviso: tabela stages vazia. Rode v3-migration.sql no Supabase.
        </div>
      )}
      {settings?.auto_merge_prs && (
        <div className="border-b border-development bg-development/10 px-6 py-2 text-xs text-development font-mono">
          ⚡ modo auto-merge ativo
        </div>
      )}
      {dragError && (
        <div className="border-b border-qa bg-qa/10 px-6 py-2 text-xs text-qa font-mono">
          ✗ {dragError}
        </div>
      )}

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-4 p-6 min-h-full">
            {initialStages.length === 0 ? (
              <EmptyState />
            ) : (
              initialStages.map((stage) => (
                <Column
                  key={stage.code}
                  stage={stage}
                  cards={cardsByStage[stage.code] ?? []}
                  currentUser={currentUser}
                  onCardClick={(cardId) => setOpenCardId(cardId)}
                />
              ))
            )}
          </div>
        </div>

        <DragOverlay>
          {activeCard ? <FeatureCard card={activeCard} dragging /> : null}
        </DragOverlay>
      </DndContext>

      {/* Cancelled section */}
      {cancelledCards.length > 0 && (
        <div className="border-t border-ink-800">
          <button
            onClick={() => setShowCancelled(!showCancelled)}
            className="w-full px-6 py-2 flex items-center justify-between text-xs uppercase tracking-widest text-ink-400 hover:text-ink-100 hover:bg-ink-900/40 transition-colors"
          >
            <span>
              // cancelados ({cancelledCards.length})
            </span>
            <span>{showCancelled ? "▼ ocultar" : "▶ mostrar"}</span>
          </button>
          {showCancelled && (
            <div className="px-6 pb-4">
              <div className="flex flex-wrap gap-2">
                {cancelledCards.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setOpenCardId(c.id)}
                    className="border border-ink-800 hover:border-ink-600 bg-ink-900/40 p-2 text-left max-w-xs opacity-60 hover:opacity-100 transition-all"
                  >
                    <div className="text-xs text-ink-300 line-through">
                      {c.feature?.title}
                    </div>
                    <div className="text-[10px] text-ink-500">{c.feature?.slug}</div>
                    <div className="text-[10px] text-ink-400 mt-1">
                      stage at cancel: {c.stage}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showCreate && (
        <CreateFeatureDialog onClose={() => setShowCreate(false)} />
      )}

      {openCardId && (
        <CardDetailPanel
          cardId={openCardId}
          currentUser={currentUser}
          onClose={() => setOpenCardId(null)}
        />
      )}

      {transitionCardId && (
        <TransitionDialog
          cardId={transitionCardId}
          onClose={() => setTransitionCardId(null)}
          onConfirm={() => {
            setTransitionCardId(null);
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-md text-center">
        <div className="text-xs uppercase tracking-widest text-ink-400 mb-2">
          // sem colunas
        </div>
        <div className="text-sm text-ink-300">
          Nenhum stage no banco. Rode <code className="text-ink-100">v3-migration.sql</code>.
        </div>
      </div>
    </div>
  );
}
