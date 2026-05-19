"use client";

import { useDroppable } from "@dnd-kit/core";
import FeatureCard from "./FeatureCard";

const STAGE_COLORS: Record<string, string> = {
  discovery: "text-discovery border-discovery/30",
  planning: "text-planning border-planning/30",
  development: "text-development border-development/30",
  qa: "text-qa border-qa/30",
  done: "text-done border-done/30",
};

interface Props {
  stage: { code: string; label: string };
  cards: any[];
  currentUser: { id: string; role: string };
}

export default function Column({ stage, cards, currentUser }: Props) {
  const { isOver, setNodeRef } = useDroppable({ id: stage.code });
  const colorClass = STAGE_COLORS[stage.code] ?? "text-ink-300";

  return (
    <div
      ref={setNodeRef}
      className={`w-80 shrink-0 flex flex-col bg-ink-900/40 border ${
        isOver ? "border-ink-100" : "border-ink-700"
      } transition-colors`}
    >
      {/* Column header */}
      <div className={`px-3 py-2 border-b ${colorClass}`}>
        <div className="flex items-center justify-between text-xs uppercase tracking-widest">
          <span>{stage.label}</span>
          <span className="text-ink-400">{cards.length}</span>
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        {cards.length === 0 && (
          <div className="text-xs text-ink-400 p-3 text-center">
            // vazio
          </div>
        )}
        {cards.map((c) => (
          <FeatureCard key={c.id} card={c} currentUser={currentUser} />
        ))}
      </div>
    </div>
  );
}
