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
import FeatureCard from "./FeatureCard";
import CreateFeatureDialog from "./CreateFeatureDialog";
import CardDetailPanel from "./CardDetailPanel";
import TransitionDialog from "./TransitionDialog";

interface Props {
  currentUser: { id: string; name: string; role: string };
  initialStages: { code: string; label: string; sort_order: number }[];
  initialCards: any[];
  settings: any;
  diagnostics?: {
    stagesError?: string;
    cardsError?: string;
    stagesFromFallback?: boolean;
  };
}

const STAGE_ORDER = ["discovery", "planning", "development", "qa", "done"];

const NEXT_STAGE: Record<string, string> = {
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
  diagnostics,
}: Props) {
  const [cards, setCards] = useState(initialCards);
  const [activeCard, setActiveCard] = useState<any | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [transitionCardId, setTransitionCardId] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);

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
      const { data } = await sb
        .from("cards")
        .select(
          `id, stage, status, claude_session_id, updated_at,
           feature:features ( id, slug, title, github_repo, claude_environment_id ),
           human_gates ( id, summary, decision, assignee_id )`
        )
        .order("updated_at", { ascending: false });
      if (data) setCards(data);
    }
  }, []);

  const cardsByStage = useMemo(() => {
    const acc: Record<string, any[]> = {};
    for (const s of STAGE_ORDER) acc[s] = [];
    for (const c of cards) {
      if (acc[c.stage]) acc[c.stage].push(c);
    }
    return acc;
  }, [cards]);

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

    // Só permite drag pra próxima stage adjacente
    const expectedNext = NEXT_STAGE[card.stage];
    if (targetStage !== expectedNext) {
      setDragError(
        `não dá pra pular etapas. ${card.stage} → ${expectedNext} é o próximo passo natural.`
      );
      setTimeout(() => setDragError(null), 4000);
      return;
    }

    // Só permite drag se status é awaiting_review
    if (card.status !== "awaiting_review") {
      setDragError(
        `card precisa estar em "aguarda revisão" pra avançar (atual: ${card.status})`
      );
      setTimeout(() => setDragError(null), 4000);
      return;
    }

    // Abre o dialog de transição com preview
    setTransitionCardId(card.id);
  }

  const totalCards = cards.length;
  const openGates = cards.filter((c) =>
    c.human_gates?.some(
      (g: any) => g.decision === null && g.assignee_id === currentUser.id
    )
  ).length;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-ink-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div>
            <div className="text-xs uppercase tracking-widest text-ink-400">
              squad autônomo
            </div>
            <div className="text-sm">
              olá, <span className="text-ink-100">{currentUser.name}</span>
              <span className="text-ink-400"> · {currentUser.role}</span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-ink-400 ml-4">
            <span>
              <span className="text-ink-100">{totalCards}</span> cards
            </span>
            {openGates > 0 && (
              <span className="text-planning">
                <span className="font-semibold">{openGates}</span> aguardam você
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
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
