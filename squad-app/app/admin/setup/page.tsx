"use client";

import { useState } from "react";

export default function AdminSetupPage() {
  const [secret, setSecret] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function runSetup() {
    setRunning(true);
    setResult("");
    setError("");
    try {
      const res = await fetch("/api/admin/setup-agents", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "erro desconhecido");
      } else {
        setResult(JSON.stringify(data, null, 2));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <div className="text-xs uppercase tracking-widest text-ink-400 mb-2">
            // admin
          </div>
          <h1 className="text-xl font-semibold">
            Criar agentes no Claude
            <span className="text-discovery">.</span>
          </h1>
          <p className="text-sm text-ink-300 mt-2 leading-relaxed">
            Roda os 7 agentes (PM, Tech Lead, 3 Devs, Code Reviewer, QA) na sua
            conta Anthropic e registra os IDs aqui no Supabase. Idempotente:
            rodar de novo sem mudanças é no-op. Rode toda vez que você editar
            os system prompts em <code>lib/agents.ts</code>.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-widest text-ink-400 mb-2">
              admin secret
            </label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="cola aqui o valor de ADMIN_SECRET das env vars do Vercel"
              className="w-full bg-ink-900 border border-ink-700 px-3 py-2 text-ink-100 focus:border-discovery focus:outline-none"
              disabled={running}
            />
            <div className="text-[11px] text-ink-400 mt-1.5">
              Esse valor você inventa e cola tanto no Vercel quanto aqui. Qualquer
              string longa serve (use um gerador de senha).
            </div>
          </div>

          <button
            onClick={runSetup}
            disabled={running || !secret}
            className="bg-ink-100 text-ink-950 px-4 py-2 font-semibold hover:bg-ink-300 transition-colors disabled:opacity-50"
          >
            {running ? "criando agentes..." : "executar setup →"}
          </button>

          {error && (
            <div className="border border-qa bg-qa/5 p-3 text-sm text-qa">
              {error}
            </div>
          )}

          {result && (
            <div>
              <div className="text-xs uppercase tracking-widest text-ink-400 mb-2">
                resultado
              </div>
              <pre className="bg-ink-900 border border-ink-700 p-4 text-[11px] overflow-auto max-h-96">
                {result}
              </pre>
            </div>
          )}
        </div>

        <div className="mt-12 pt-6 border-t border-ink-700 text-xs text-ink-400 leading-relaxed">
          Voltar pro <a href="/" className="text-ink-100 underline">board</a>.
        </div>
      </div>
    </main>
  );
}
