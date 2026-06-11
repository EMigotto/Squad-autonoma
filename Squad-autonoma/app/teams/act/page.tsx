"use client";

import { useState } from "react";

export default function TeamsActPage({
  searchParams,
}: {
  searchParams: { card?: string; token?: string; do?: string };
}) {
  const card = searchParams.card ?? "";
  const token = searchParams.token ?? "";
  const act = searchParams.do === "reject" ? "reject" : "approve";
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function run() {
    setState("busy");
    const res = await fetch("/api/teams/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        action: act,
        card_id: card,
        reason: act === "reject" ? reason : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setState("done");
      setMsg(act === "approve" ? "Etapa aprovada — o fluxo avançou." : "Etapa reprovada — o agente vai regerar com o seu ajuste.");
    } else {
      setState("error");
      setMsg(data.error ?? `erro ${res.status}`);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-950 text-ink-100 p-6">
      <div className="w-full max-w-md border border-ink-700 bg-ink-900 p-6">
        <div className="text-xs uppercase tracking-widest text-ink-400 mb-2">// microsoft teams · ação</div>
        <h1 className="text-lg font-semibold mb-3">
          {act === "approve" ? "Aprovar etapa" : "Reprovar / pedir ajuste"}
        </h1>
        {!card || !token ? (
          <div className="text-sm text-qa">link inválido (faltando card ou token).</div>
        ) : state === "done" ? (
          <div className="text-sm text-development">{msg} Pode fechar esta aba.</div>
        ) : (
          <>
            {act === "reject" && (
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="o que precisa ajustar? (vai como contexto pra regerar a etapa)"
                rows={4}
                className="w-full bg-ink-950 border border-ink-700 px-3 py-2 text-sm mb-3 focus:border-development focus:outline-none"
              />
            )}
            <button
              onClick={run}
              disabled={state === "busy" || (act === "reject" && !reason.trim())}
              className={`w-full px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
                act === "approve" ? "bg-qa text-ink-950" : "bg-planning text-ink-950"
              }`}
            >
              {state === "busy" ? "processando…" : act === "approve" ? "confirmar aprovação" : "confirmar reprovação"}
            </button>
            {state === "error" && <div className="text-xs text-qa mt-2">erro: {msg}</div>}
          </>
        )}
      </div>
    </div>
  );
}
