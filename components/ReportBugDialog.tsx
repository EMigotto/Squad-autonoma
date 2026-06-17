"use client";

import { useState } from "react";

/**
 * Dialog "Reportar Bug": o PM/dev cola o erro, arquivo e passos de reprodução.
 * Cria uma feature do tipo bug no Backlog + uma issue no GitHub, já com o
 * contexto do erro como semente. Mover o card pra frente inicia a correção.
 */
export default function ReportBugDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [file, setFile] = useState("");
  const [repro, setRepro] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [errMsg, setErrMsg] = useState("");

  async function submit() {
    setErrMsg("");
    if (!title.trim()) { setErrMsg("dê um título ao bug"); return; }
    if (!error.trim()) { setErrMsg("cole o erro ou stack trace"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/bugs/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, error, file, repro }),
      });
      const data = await res.json();
      if (!res.ok) { setErrMsg(data.error ?? `HTTP ${res.status}`); setSubmitting(false); return; }
      setResult(data);
      setTimeout(() => { onClose(); window.location.reload(); }, 2200);
    } catch (e) {
      setErrMsg(String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto py-10">
      <div className="bg-ink-900 border border-planning/40 rounded-panel w-full max-w-2xl mx-4 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[11px] tracking-widest uppercase text-planning">// reportar bug</div>
            <h2 className="font-disp text-xl text-ink-100 mt-1">Registrar uma correção</h2>
          </div>
          <button onClick={onClose} className="text-ink-400 hover:text-ink-100 text-lg">×</button>
        </div>

        {result ? (
          <div className="border border-qa bg-qa/5 rounded-card p-4 text-sm text-qa">
            <div className="font-semibold mb-1">bug registrado ✓</div>
            <div className="text-xs opacity-80">
              Criado no Backlog{result.issue_number ? ` · issue #${result.issue_number} aberta no GitHub` : ""}.
              Mova o card para Discovery/Desenvolvimento para o agente corrigir. A issue será fechada ao concluir.
            </div>
          </div>
        ) : (
          <>
            <p className="text-[12.5px] text-ink-400">
              Cole o erro que apareceu (no VS Code, no build, em runtime). O {`{V.AI.be}`} cria uma issue no
              GitHub e um card de correção no Backlog com esse contexto — você revisa e move para frente
              para o agente corrigir, sem precisar editar código à mão.
            </p>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">título do bug *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="ex: erro de build no módulo de pagamentos"
                className="w-full bg-ink-950 border border-ink-700 rounded-card px-3 py-2 text-sm text-ink-100 focus:border-planning focus:outline-none" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">erro / stack trace *</label>
              <textarea value={error} onChange={(e) => setError(e.target.value)} rows={6}
                placeholder="cole aqui a mensagem de erro completa, stack trace, saída do terminal…"
                className="w-full bg-ink-950 border border-ink-700 rounded-card px-3 py-2 text-[12px] font-mono text-ink-100 focus:border-planning focus:outline-none" />
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">arquivo (opcional)</label>
                <input value={file} onChange={(e) => setFile(e.target.value)}
                  placeholder="ex: src/payments/checkout.ts"
                  className="w-full bg-ink-950 border border-ink-700 rounded-card px-3 py-2 text-sm font-mono text-ink-100 focus:border-planning focus:outline-none" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">como reproduzir (opcional)</label>
                <input value={repro} onChange={(e) => setRepro(e.target.value)}
                  placeholder="ex: rodar npm run build"
                  className="w-full bg-ink-950 border border-ink-700 rounded-card px-3 py-2 text-sm text-ink-100 focus:border-planning focus:outline-none" />
              </div>
            </div>
            {errMsg && <div className="text-xs text-qa border border-qa/40 bg-qa/5 rounded-card p-2">{errMsg}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="px-3 py-1.5 text-sm text-ink-300 hover:text-ink-100">cancelar</button>
              <button onClick={submit} disabled={submitting}
                className="bg-planning text-ink-950 px-4 py-1.5 text-sm font-semibold rounded-card hover:opacity-90 disabled:opacity-50">
                {submitting ? "registrando…" : "registrar bug → Backlog + GitHub"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
