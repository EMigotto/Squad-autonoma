"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  queued: { label: "aguardando", color: "text-ink-400" },
  running: { label: "agente trabalhando", color: "text-development" },
  awaiting_review: { label: "aguarda revisão", color: "text-planning" },
  approved: { label: "aprovado", color: "text-qa" },
  rejected: { label: "rejeitado, refazendo", color: "text-discovery" },
  done: { label: "concluído", color: "text-ink-400" },
};

interface Props {
  card: any;
  currentUser?: { id: string; role: string };
  dragging?: boolean;
  onClick?: () => void;
}

export default function FeatureCard({ card, currentUser, dragging, onClick }: Props) {
  const isAwaitingReview = card.status === "awaiting_review";
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: card.id,
      disabled: !isAwaitingReview,
    });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  const status = STATUS_LABELS[card.status] ?? STATUS_LABELS.queued;
  const openGate = card.human_gates?.find((g: any) => g.decision === null);
  const mineToReview =
    openGate && currentUser && openGate.assignee_id === currentUser.id;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`card-surface p-3 border ${
        mineToReview ? "border-planning" : "border-ink-700"
      } hover:border-ink-600 transition-colors cursor-pointer relative group`}
      onClick={(e) => {
        // Só dispara click se não estiver dragging
        if (!isDragging) onClick?.();
      }}
    >
      {/* Drag handle só na área superior */}
      {isAwaitingReview && (
        <div
          {...attributes}
          {...listeners}
          className="absolute top-0 right-0 px-2 py-1 text-ink-400 hover:text-ink-100 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 text-[10px]"
          onClick={(e) => e.stopPropagation()}
          title="arrastar"
        >
          ⋮⋮
        </div>
      )}

      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="text-sm leading-tight">{card.feature?.title}</div>
        {mineToReview && (
          <span className="text-[10px] uppercase tracking-widest text-planning px-1.5 py-0.5 border border-planning/40 shrink-0">
            você
          </span>
        )}
      </div>

      <div className="text-[11px] text-ink-400 mb-2">{card.feature?.slug}</div>

      <div className={`text-[11px] ${status.color}`}>{status.label}</div>

      {openGate?.summary && (
        <div className="mt-2 pt-2 border-t border-ink-800 text-[11px] text-ink-300 line-clamp-3">
          {openGate.summary}
        </div>
      )}

      <div className="mt-2 text-[10px] text-ink-400 opacity-60 group-hover:opacity-100">
        clique para detalhes →
      </div>
    </div>
  );
}
