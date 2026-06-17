"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type Msg = { role: "user" | "assistant"; content: string };

const MODELS = [
  { key: "haiku",  label: "Haiku 4.5", note: "rápido · $1/$5 Mtok" },
  { key: "sonnet", label: "Sonnet 4.6", note: "padrão · $3/$15 Mtok" },
  { key: "opus",   label: "Opus 4.7",   note: "máximo · $5/$25 Mtok" },
];

const QUICK_PROMPTS = [
  "O que está rodando agora?",
  "Qual agente está processando cada card?",
  "Quanto tempo falta até o card atual terminar?",
  "Quanto gastei hoje?",
  "Algum card travado aguardando revisão?",
  "Quais os próximos passos para os cards em curso?",
];

export default function AssistantPage() {
  const [model, setModel] = useState<string>("sonnet");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [snap, setSnap] = useState<any>(null);
  const [error, setError] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/api/assistant/snapshot")
      .then((r) => r.json())
      .then(setSnap)
      .catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(textOverride?: string) {
    const content = (textOverride ?? input).trim();
    if (!content || busy) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, model }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        setMessages([...next, { role: "assistant", content: data.text }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setMessages([]);
    setError("");
  }

  const headline = !snap
    ? "carregando estado do squad…"
    : !snap.active
    ? "nenhum time ativo"
    : `${snap.project.name} (${snap.project.sigla}) · ${snap.running.length} rodando · ${snap.waiting_review.length} aguardando · ${snap.queued.length} na fila`;

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100 font-mono flex flex-col">
      {/* TOPO */}
      <div className="border-b border-ink-800 px-6 py-3 flex items-center justify-between bg-ink-950 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-xs text-ink-400 hover:text-ink-100">
            ← board
          </Link>
          <span className="text-ink-700">·</span>
          <span className="text-sm font-semibold">// squad assistant</span>
          <span className="text-[10px] text-ink-500 ml-1">claude-code style · live</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[11px] text-ink-400">{headline}</div>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="bg-ink-900 border border-ink-700 px-2 py-1 text-xs"
          >
            {MODELS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label} — {m.note}
              </option>
            ))}
          </select>
          {messages.length > 0 && (
            <button onClick={reset} className="text-[11px] text-ink-400 hover:text-ink-100 px-2">
              limpar
            </button>
          )}
        </div>
      </div>

      {/* CONVERSA */}
      <div className="flex-1 overflow-y-auto px-6 py-6 max-w-5xl w-full mx-auto">
        {messages.length === 0 && snap && snap.active && (
          <WelcomeCard snap={snap} onAsk={send} />
        )}
        {messages.length === 0 && snap && !snap.active && (
          <div className="text-sm text-ink-400">
            Selecione um time no board (← board) para que eu possa te ajudar com o estado do squad.
          </div>
        )}
        <div className="space-y-4">
          {messages.map((m, i) => (
            <MessageBlock key={i} msg={m} />
          ))}
          {busy && (
            <div className="flex items-center gap-2 text-xs text-ink-500">
              <span className="inline-block w-2 h-2 bg-discovery animate-pulse" />
              pensando com {MODELS.find((x) => x.key === model)?.label}…
            </div>
          )}
          {error && <div className="text-xs text-qa">erro: {error}</div>}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* PROMPTS RÁPIDOS + INPUT */}
      <div className="border-t border-ink-800 bg-ink-950">
        {messages.length === 0 && (
          <div className="px-6 pt-3 pb-1 max-w-5xl w-full mx-auto flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q}
                onClick={() => send(q)}
                disabled={busy}
                className="text-[11px] text-ink-300 border border-ink-700 hover:border-discovery hover:text-ink-100 px-2 py-1"
              >
                {q}
              </button>
            ))}
          </div>
        )}
        <div className="px-6 py-3 max-w-5xl w-full mx-auto flex items-end gap-2">
          <span className="text-discovery font-mono pb-1.5">{">"}</span>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="pergunte sobre o squad… (enter envia, shift+enter quebra linha)"
            rows={1}
            className="flex-1 bg-ink-900 border border-ink-700 px-3 py-2 text-sm font-mono text-ink-100 focus:border-discovery focus:outline-none resize-none"
          />
          <button
            onClick={() => send()}
            disabled={busy || !input.trim()}
            className="bg-ink-100 text-ink-950 px-4 py-2 text-sm font-semibold hover:bg-ink-300 disabled:opacity-50"
          >
            enviar
          </button>
        </div>
      </div>
    </div>
  );
}

function WelcomeCard({ snap, onAsk }: { snap: any; onAsk: (q: string) => void }) {
  const fmt = (s: number) =>
    s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;
  return (
    <div className="border border-ink-800 bg-ink-900/40 p-4 mb-6">
      <div className="text-xs uppercase tracking-widest text-ink-400 mb-2">
        // estado do squad — gerado agora
      </div>
      <div className="text-sm text-ink-200 mb-3">
        Sou seu copiloto pra acompanhar o squad. Já carreguei tudo que está em curso —
        posso explicar o que cada agente está fazendo, estimar tempo restante, listar
        gastos e apontar cards travados.
      </div>
      {snap.running.length === 0 && snap.waiting_review.length === 0 && snap.queued.length === 0 && (
        <div className="text-xs text-ink-400">
          Nenhum card em execução agora. Pergunte sobre os gastos de hoje, ou crie um
          novo card no board pra colocar o squad pra rodar.
        </div>
      )}
      {snap.running.length > 0 && (
        <div className="space-y-1 text-xs">
          <div className="text-ink-300 mb-1">{snap.running.length} card(s) rodando:</div>
          {snap.running.slice(0, 3).map((c: any) => (
            <div key={c.id} className="flex items-baseline gap-2 text-ink-200">
              <span className="text-discovery">{c.slug}</span>
              <span className="text-ink-400">{c.stage}</span>
              <span className="text-ink-500">·</span>
              <span className="text-ink-400">{c.current_agent ?? "?"}</span>
              {c.elapsed_seconds != null && (
                <>
                  <span className="text-ink-500">·</span>
                  <span className="text-ink-400">
                    rodando há {fmt(c.elapsed_seconds)}
                    {c.est_remaining_seconds != null
                      ? ` · ~${fmt(c.est_remaining_seconds)} restando`
                      : ""}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {snap.today.completed_stages > 0 && (
        <div className="text-[11px] text-ink-500 mt-3">
          hoje: {snap.today.completed_stages} etapa(s) concluída(s) · gasto acumulado{" "}
          {snap.today.total_cost.toFixed(2)} {snap.today.currency}
        </div>
      )}
      <div className="text-[11px] text-ink-500 mt-3">
        toque um atalho abaixo ou digite sua pergunta.
      </div>
    </div>
  );
}

function MessageBlock({ msg }: { msg: Msg }) {
  if (msg.role === "user") {
    return (
      <div className="flex gap-2">
        <span className="text-discovery font-mono shrink-0">{">"}</span>
        <div className="text-sm text-ink-100 whitespace-pre-wrap">{msg.content}</div>
      </div>
    );
  }
  return (
    <div className="border-l-2 border-development pl-3 ml-2">
      <div className="text-[10px] uppercase tracking-widest text-ink-500 mb-1">
        assistant
      </div>
      <div className="text-sm text-ink-200 whitespace-pre-wrap leading-relaxed">
        {msg.content}
      </div>
    </div>
  );
}
