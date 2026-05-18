"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [errMsg, setErrMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const sb = createClient();
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setStatus("error");
      setErrMsg(error.message);
    } else {
      setStatus("sent");
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-12">
          <div className="text-xs uppercase tracking-widest text-ink-400 mb-2">
            // squad autônomo
          </div>
          <h1 className="text-2xl font-semibold">
            Entre com seu email
            <span className="text-discovery">.</span>
          </h1>
          <p className="text-ink-300 text-sm mt-2">
            Mandamos um link mágico. Sem senha.
          </p>
        </div>

        {status === "sent" ? (
          <div className="border border-development bg-development/5 p-4 text-sm">
            Link enviado para{" "}
            <span className="text-ink-100 font-semibold">{email}</span>. Abra
            seu email e clique pra entrar.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs uppercase tracking-widest text-ink-400 mb-2">
                email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="voce@empresa.com"
                className="w-full bg-ink-900 border border-ink-700 px-3 py-2 text-ink-100 focus:border-discovery focus:outline-none"
                disabled={status === "sending"}
              />
            </div>

            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full bg-ink-100 text-ink-950 py-2 font-semibold hover:bg-ink-300 transition-colors disabled:opacity-50"
            >
              {status === "sending" ? "enviando..." : "enviar link →"}
            </button>

            {status === "error" && (
              <div className="text-sm text-qa">{errMsg}</div>
            )}
          </form>
        )}

        <div className="mt-12 text-xs text-ink-400 leading-relaxed">
          Primeiro acesso? Use seu email do trabalho. Depois de entrar, peça a
          um admin pra ajustar seu role (pm, tech_lead ou qa) na tabela
          user_profiles do Supabase.
        </div>
      </div>
    </main>
  );
}
