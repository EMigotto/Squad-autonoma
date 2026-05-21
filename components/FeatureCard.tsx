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

      {/* Indicadores */}
      {card.metrics && <CardMetricBadges m={card.metrics} />}

      <div className="mt-2 text-[10px] text-ink-400 opacity-60 group-hover:opacity-100">
        clique para detalhes →
      </div>
    </div>
  );
}

function fmtCycle(hours: number | null | undefined): string {
  if (hours == null) return "—";
  const h = Number(hours);
  if (h < 24) return `${h.toFixed(0)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

function CardMetricBadges({ m }: { m: any }) {
  const cov = m.test_coverage_pct;
  const items: { label: string; value: string; tone: string }[] = [
    { label: "ciclo", value: fmtCycle(m.cycle_time_hours), tone: "text-development" },
    {
      label: "1ª",
      value: m.gates_total > 0 ? (m.first_pass ? "✓" : "✗") : "—",
      tone: m.gates_total > 0 && m.first_pass ? "text-qa" : "text-discovery",
    },
    {
      label: "cob.",
      value: cov != null ? `${Number(cov).toFixed(0)}%` : "—",
      tone: cov != null && Number(cov) >= 80 ? "text-qa" : "text-ink-300",
    },
    {
      label: "custo",
      value: Number(m.total_cost) > 0 ? `${Number(m.total_cost).toFixed(0)}` : "—",
      tone: "text-planning",
    },
  ];
  return (
    <div className="mt-2 pt-2 border-t border-ink-800 grid grid-cols-4 gap-1">
      {items.map((it) => (
        <div key={it.label} className="text-center">
          <div className={`text-[12px] font-semibold leading-none ${it.tone}`}>
            {it.value}
          </div>
          <div className="text-[8px] uppercase tracking-wider text-ink-400 mt-0.5">
            {it.label}
          </div>
        </div>
      ))}
    </div>
  );
}
