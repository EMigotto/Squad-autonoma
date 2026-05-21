"use client";

import { useEffect, useState } from "react";

interface Props {
  cardId: string;
  onClose: () => void;
  onConfirm: () => void;
}

interface PreviewData {
  target_stage: string;
  initial_message?: string;
  agent_name?: string;
  agent_id?: string;
  model?: string;
  message?: string;
  error?: string;
}

export default function TransitionDialog({
  cardId,
  onClose,
  onConfirm,
}: Props) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editedMessage, setEditedMessage] = useState<string>("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  // Merge de PRs (quando a transição é development → qa)
  const [pulls, setPulls] = useState<any[]>([]);
  const [selectedPulls, setSelectedPulls] = useState<Set<number>>(new Set());
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<string>("");

  useEffect(() => {
    fetch(`/api/cards/${cardId}/preview-next`)
      .then((r) => r.json())
      .then((data) => {
        setPreview(data);
        if (data.initial_message) {
          setEditedMessage(data.initial_message);
        }
        setLoading(false);
        // Se vamos pra QA, busca os PRs abertos pra oferecer merge
        if (data.target_stage === "qa") {
          fetch(`/api/cards/${cardId}/merge-prs`)
            .then((r) => r.json())
            .then((pd) => {
              const open = pd.pulls ?? [];
              setPulls(open);
              setSelectedPulls(new Set(open.map((p: any) => p.number)));
            })
            .catch(() => {});
        }
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, [cardId]);

  async function handleMergeSelected() {
    const nums = Array.from(selectedPulls);
    if (nums.length === 0) return;
    setMerging(true);
    setMergeResult("");
    try {
      const res = await fetch(`/api/cards/${cardId}/merge-prs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pr_numbers: nums }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMergeResult(`erro: ${data.error ?? res.status}`);
      } else {
        const fails = (data.results ?? []).filter(
          (r: any) => r.status === "error"
        );
        setMergeResult(
          `${data.merged}/${data.total} mergeado(s)` +
            (fails.length
              ? `. Falhas: ${fails
                  .map((f: any) => `#${f.number} (${f.error})`)
                  .join("; ")}`
              : "")
        );
        // Recarrega a lista de PRs abertos
        const pd = await fetch(`/api/cards/${cardId}/merge-prs`).then((r) =>
          r.json()
        );
        const open = pd.pulls ?? [];
        setPulls(open);
        setSelectedPulls(new Set(open.map((p: any) => p.number)));
      }
    } finally {
      setMerging(false);
    }
  }

  function togglePull(num: number) {
    const next = new Set(selectedPulls);
    if (next.has(num)) next.delete(num);
    else next.add(num);
    setSelectedPulls(next);
  }

  async function handleApprove() {
    setConfirming(true);
    setError("");

    const { createClient } = await import("@/lib/supabase/client");
    const sb = createClient();
    const { data: card } = await sb
      .from("cards")
      .select("human_gates(id,decision)")
      .eq("id", cardId)
      .single();

    const gate = card?.human_gates?.find((g: any) => g.decision === null);
    if (!gate) {
      setError("nenhum gate aberto pra esse card");
      setConfirming(false);
      return;
    }

    const res = await fetch(`/api/gates/${gate.id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "approved",
        override_initial_message:
          editedMessage !== preview?.initial_message ? editedMessage : undefined,
      }),
    });
    if (res.ok) {
      onConfirm();
    } else {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? `HTTP ${res.status}`);
      setConfirming(false);
    }
  }

  // Helper: trunca agent_id de forma type-safe
  const agentIdDisplay = preview?.agent_id
    ? preview.agent_id.slice(0, 20) + "..."
    : "?";

  return (
    <div className="fixed inset-0 bg-ink-950/90 flex items-center justify-center p-4 z-[60]">
      <div className="bg-ink-950 border border-qa w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="border-b border-ink-700 p-5 flex items-start justify-between shrink-0">
          <div>
            <div className="text-xs uppercase tracking-widest text-qa">
              // aprovar transição
            </div>
            <div className="text-lg font-semibold mt-1">
              Confirmar avanço para:{" "}
              <span className="text-qa">{preview?.target_stage ?? "..."}</span>
            </div>
            <div className="text-xs text-ink-400 mt-1">
              Você está prestes a disparar uma nova sessão Claude. Revise abaixo.
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-100 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && (
            <div className="text-sm text-ink-300">
              carregando preview da próxima sessão...
            </div>
          )}

          {!loading && preview && (
            <>
              {preview.target_stage === "done" ? (
                <div className="border border-done bg-done/10 p-4 text-sm text-ink-100">
                  Esta é a última stage. Aprovar marca o card como{" "}
                  <strong>done</strong>, sem disparar nova sessão.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3 text-xs">
                    <Stat label="agente" value={preview.agent_name ?? "?"} />
                    <Stat label="modelo" value={preview.model ?? "?"} />
                    <Stat label="agent id" value={agentIdDisplay} mono />
                  </div>

                  <div className="border border-planning/40 bg-planning/5 p-2 text-[11px] text-planning">
                    🔒 <strong>atenção:</strong> esta mensagem contém o GITHUB_TOKEN real (necessário pro agent autenticar). Não compartilhe screenshots desta tela em público.
                  </div>

                  {/* Integração de PRs antes do QA */}
                  {preview.target_stage === "qa" && (
                    <div className="border border-development/40 bg-development/5 p-3">
                      <div className="text-xs text-development font-semibold mb-1">
                        integração antes do QA
                      </div>
                      <div className="text-[11px] text-ink-300 mb-2 leading-relaxed">
                        O QA escreve os testes a partir do Gherkin, mas para rodar
                        a suíte e ter CI verde o código precisa estar integrado.
                        {pulls.length > 0
                          ? " Mergeie os PRs dos chunks agora, ou avance sem mergear (o QA escreverá testes que podem falhar por falta de código)."
                          : " Nenhum PR aberto encontrado para esta feature."}
                      </div>

                      {pulls.length > 0 && (
                        <>
                          <div className="space-y-1 mb-2">
                            {pulls.map((pr) => (
                              <label
                                key={pr.number}
                                className="flex items-center gap-2 text-xs cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedPulls.has(pr.number)}
                                  onChange={() => togglePull(pr.number)}
                                  className="accent-development"
                                />
                                {pr.draft && (
                                  <span className="text-[9px] uppercase text-planning border border-planning/40 px-1">
                                    draft
                                  </span>
                                )}
                                <span className="text-ink-100 truncate flex-1">
                                  #{pr.number} {pr.title}
                                </span>
                                <a
                                  href={pr.html_url}
                                  target="_blank"
                                  rel="noopener"
                                  className="text-development hover:underline shrink-0"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  ↗
                                </a>
                              </label>
                            ))}
                          </div>
                          <button
                            onClick={handleMergeSelected}
                            disabled={merging || selectedPulls.size === 0}
                            className="bg-development text-ink-950 px-3 py-1 text-xs font-semibold hover:bg-development/80 disabled:opacity-50"
                          >
                            {merging
                              ? "mergeando..."
                              : `mergear ${selectedPulls.size} PR(s) selecionado(s)`}
                          </button>
                        </>
                      )}

                      {mergeResult && (
                        <div className="text-[11px] text-ink-300 mt-2 font-mono">
                          {mergeResult}
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] uppercase tracking-widest text-ink-400">
                        initial_message que será enviado
                      </div>
                      <button
                        onClick={() => setShowRaw(!showRaw)}
                        className="text-[11px] text-development hover:underline"
                      >
                        {showRaw ? "edit" : "raw"}
                      </button>
                    </div>

                    {showRaw ? (
                      <pre className="bg-ink-900 border border-ink-700 p-3 text-[11px] text-ink-100 max-h-96 overflow-y-auto whitespace-pre-wrap font-mono">
                        {editedMessage}
                      </pre>
                    ) : (
                      <textarea
                        value={editedMessage}
                        onChange={(e) => setEditedMessage(e.target.value)}
                        rows={16}
                        className="w-full bg-ink-900 border border-ink-700 p-3 text-[11px] text-ink-100 font-mono whitespace-pre-wrap focus:border-discovery focus:outline-none"
                      />
                    )}

                    <div className="text-[10px] text-ink-400 mt-1">
                      você pode editar livremente antes de disparar. Use isso pra
                      adicionar contexto ou refinar o briefing.
                    </div>
                  </div>
                </>
              )}

              {error && (
                <div className="border border-qa bg-qa/10 p-3 text-xs text-qa font-mono">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="border-t border-ink-700 p-4 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            disabled={confirming}
            className="text-sm text-ink-300 hover:text-ink-100 px-3 py-1.5"
          >
            voltar
          </button>
          <button
            onClick={handleApprove}
            disabled={confirming || loading}
            className="bg-qa text-ink-950 px-4 py-1.5 text-sm font-semibold hover:bg-qa/80 disabled:opacity-50"
          >
            {confirming
              ? "disparando..."
              : preview?.target_stage === "done"
                ? "marcar como done"
                : "aprovar e disparar →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="border border-ink-700 bg-ink-900 p-2">
      <div className="text-[10px] uppercase tracking-widest text-ink-400">
        {label}
      </div>
      <div className={`text-xs text-ink-100 mt-0.5 ${mono ? "font-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}
