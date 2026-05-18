"use client";

import { useEffect, useMemo, useState } from "react";
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
import GateDialog from "./GateDialog";

interface Props {
  currentUser: { id: string; name: string; role: string };
  initialStages: { code: string; label: string; sort_order: number }[];
  initialCards: any[];
}

const STAGE_ORDER = ["discovery", "planning", "development", "qa", "done"];

export default function Board({
  currentUser,
  initialStages,
  initialCards,
}: Props) {
  const [cards, setCards] = useState(initialCards);
  const [activeCard, setActiveCard] = useState<any | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [openGate, setOpenGate] = useState<{
    gateId: string;
    card: any;
    targetStage?: string;
  } | null>(null);

  // Realtime: re-fetch quando cards mudam
  useEffect(() => {
    const sb = createClient();
    const channel = sb
      .channel("board-cards")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cards" },
        async () => {
          await refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "human_gates" },
        async () => {
          await refresh();
        }
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
           feature:features ( id, slug, title ),
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
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  function handleDragStart(e: DragStartEvent) {
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

    // Só pode mover se: o card está awaiting_review E o target é stage seguinte
    const idxCurrent = STAGE_ORDER.indexOf(card.stage);
    const idxTarget = STAGE_ORDER.indexOf(targetStage);

    const openGate = card.human_gates?.find((g: any) => g.decision === null);

    if (!openGate) {
      alert(
        "Esse card não está aguardando revisão. Espera o agente terminar antes de mover."
      );
      return;
    }

    if (idxTarget === idxCurrent + 1) {
      // Aprovar e avançar
      setOpenGate({ gateId: openGate.id, card, targetStage: "approved" });
    } else if (idxTarget === idxCurrent - 1) {
      // Rejeitar (mandar voltar) — modal pede reason
      setOpenGate({ gateId: openGate.id, card, targetStage: "rejected" });
    } else {
      alert("Você só pode mover um card pra coluna adjacente.");
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
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
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="bg-ink-100 text-ink-950 px-3 py-1.5 text-sm font-semibold hover:bg-ink-300 transition-colors"
        >
          + nova feature
        </button>
      </header>

      {/* Board */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-x-auto">
          <div className="flex gap-4 p-6 min-h-full">
            {initialStages.map((stage) => (
              <Column
                key={stage.code}
                stage={stage}
                cards={cardsByStage[stage.code] ?? []}
                currentUser={currentUser}
              />
            ))}
          </div>
        </div>

        <DragOverlay>
          {activeCard ? <FeatureCard card={activeCard} dragging /> : null}
        </DragOverlay>
      </DndContext>

      {showCreate && (
        <CreateFeatureDialog onClose={() => setShowCreate(false)} />
      )}

      {openGate && (
        <GateDialog
          gateId={openGate.gateId}
          card={openGate.card}
          mode={openGate.targetStage === "rejected" ? "reject" : "approve"}
          onClose={() => setOpenGate(null)}
        />
      )}
    </div>
  );
}
