"use client";

import { useState } from "react";

interface Props {
  gateId: string;
  card: any;
  mode: "approve" | "reject";
  onClose: () => void;
}

export default function GateDialog({ gateId, card, mode, onClose }: Props) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (mode === "reject" && !reason.trim()) {
      setError("descreva o motivo da rejeição");
      return;
    }
    setSubmitting(true);
    setError("");
    const res = await fetch(`/api/gates/${gateId}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: mode === "approve" ? "approved" : "rejected",
        reason: mode === "reject" ? reason : undefined,
      }),
    });
    if (!res.ok) {
      const j = await res.json();
      setError(j.error ?? "erro");
      setSubmitting(false);
      return;
    }
    onClose();
  }

  const openGate = card.human_gates?.find((g: any) => g.decision === null);

  return (
    <div className="fixed inset-0 bg-ink-950/80 flex items-center justify-center p-4 z-50">
      <div className="bg-ink-900 border border-ink-700 w-full max-w-2xl p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-ink-400">
              // {mode === "approve" ? "aprovar e avançar" : "rejeitar e refazer"}
            </div>
            <h2 className="text-lg font-semibold mt-1">
              {card.feature?.title}
            </h2>
            <div className="text-xs text-ink-400 mt-0.5">
              {card.feature?.slug} · {card.stage}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-100 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {openGate?.summary && (
          <div className="border border-ink-700 p-3 bg-ink-950">
            <div className="text-xs uppercase tracking-widest text-ink-400 mb-2">
              o que o agente entregou
            </div>
            <div className="text-sm whitespace-pre-wrap text-ink-100">
              {openGate.summary}
            </div>
          </div>
        )}

        {mode === "reject" && (
          <div>
            <label className="block text-xs uppercase tracking-widest text-ink-400 mb-1">
              motivo (será enviado ao agente na próxima tentativa)
            </label>
            <textarea
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="seja específico — o agente vai reescrever do zero baseado nisso"
              className="w-full bg-ink-950 border border-ink-700 px-2 py-1.5 text-sm text-ink-100 focus:border-discovery focus:outline-none"
            />
          </div>
        )}

        {error && <div className="text-sm text-qa">{error}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-ink-300 hover:text-ink-100"
          >
            cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className={`${
              mode === "approve"
                ? "bg-qa text-ink-950 hover:bg-qa/80"
                : "bg-discovery text-ink-950 hover:bg-discovery/80"
            } px-3 py-1.5 text-sm font-semibold disabled:opacity-50`}
          >
            {submitting
              ? "..."
              : mode === "approve"
                ? "aprovar →"
                : "rejeitar ↺"}
          </button>
        </div>
      </div>
    </div>
  );
}
