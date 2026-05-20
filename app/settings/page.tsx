"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Settings {
  auto_merge_prs: boolean;
  commit_to_existing_branch: boolean;
  auto_advance_after_pm: boolean;
  auto_advance_after_tl: boolean;
  default_base_branch: string;
  notification_slack_webhook: string | null;
}

const DEFAULT_SETTINGS: Settings = {
  auto_merge_prs: false,
  commit_to_existing_branch: false,
  auto_advance_after_pm: false,
  auto_advance_after_tl: false,
  default_base_branch: "main",
  notification_slack_webhook: null,
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.settings) setSettings(data.settings);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `HTTP ${res.status}`);
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings({ ...settings, [key]: value });
  }

  if (loading) {
    return (
      <main className="p-8 text-sm text-ink-300">carregando settings...</main>
    );
  }

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-2xl mx-auto">
        <div className="mb-8 flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-ink-400 mb-2">
              // configurações do squad
            </div>
            <h1 className="text-xl font-semibold">
              Modo de operação<span className="text-discovery">.</span>
            </h1>
            <p className="text-sm text-ink-300 mt-2 leading-relaxed">
              Estas configurações aplicam-se a TODAS as features novas. Features
              em andamento continuam usando a configuração do momento em que
              começaram.
            </p>
          </div>
          <Link
            href="/"
            className="text-xs uppercase tracking-widest text-ink-300 hover:text-ink-100"
          >
            ← voltar ao board
          </Link>
        </div>

        <div className="space-y-6">
          {/* Branch handling */}
          <Section title="git workflow">
            <Toggle
              label="commit em branch existente"
              description="Em vez de criar uma branch nova por chunk, os Dev Agents commitam direto na default branch. Pula a etapa de PR review. ATENÇÃO: remove a proteção de revisão humana do código."
              danger
              value={settings.commit_to_existing_branch}
              onChange={(v) => update("commit_to_existing_branch", v)}
            />
            <Toggle
              label="auto-merge de PRs após CI verde"
              description="Quando CI passa, o agent faz merge automático. Recomendado se você confia no QA Agent."
              value={settings.auto_merge_prs}
              onChange={(v) => update("auto_merge_prs", v)}
            />
            <Field
              label="default base branch"
              value={settings.default_base_branch}
              onChange={(v) => update("default_base_branch", v)}
              placeholder="main"
            />
          </Section>

          {/* Gates humanos */}
          <Section title="gates humanos">
            <Toggle
              label="auto-aprovar PM Agent (Discovery)"
              description="Pula o gate humano após o PM Agent terminar. Card avança direto pro Tech Lead. Use só quando confiar no PRD gerado."
              danger
              value={settings.auto_advance_after_pm}
              onChange={(v) => update("auto_advance_after_pm", v)}
            />
            <Toggle
              label="auto-aprovar Tech Lead (Planning)"
              description="Pula o gate humano após o Tech Lead Agent decompor em chunks. Devs começam imediatamente."
              danger
              value={settings.auto_advance_after_tl}
              onChange={(v) => update("auto_advance_after_tl", v)}
            />
          </Section>

          {/* Notificações */}
          <Section title="notificações">
            <Field
              label="slack webhook url (opcional)"
              value={settings.notification_slack_webhook ?? ""}
              onChange={(v) =>
                update("notification_slack_webhook", v || null)
              }
              placeholder="https://hooks.slack.com/services/..."
            />
            <div className="text-[11px] text-ink-400">
              Quando um gate abre, o squad recebe uma notificação. Deixe vazio para desabilitar.
            </div>
          </Section>

          {/* Actions */}
          <div className="pt-4 border-t border-ink-700 flex items-center justify-between">
            {error && (
              <div className="text-xs text-qa font-mono">{error}</div>
            )}
            {saved && (
              <div className="text-xs text-qa">salvo ✓</div>
            )}
            <div className="ml-auto">
              <button
                onClick={save}
                disabled={saving}
                className="bg-ink-100 text-ink-950 px-4 py-2 text-sm font-semibold hover:bg-ink-300 transition-colors disabled:opacity-50"
              >
                {saving ? "salvando..." : "salvar configurações"}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-ink-700 text-[11px] text-ink-400 leading-relaxed">
          Configurações com ⚠ removem ou enfraquecem a revisão humana no fluxo do
          squad. Use apenas em projetos de baixo risco ou repos sandbox até ganhar
          confiança no comportamento dos agentes.
        </div>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="text-[10px] uppercase tracking-widest text-ink-400">
        // {title}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Toggle({
  label,
  description,
  value,
  onChange,
  danger,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
  danger?: boolean;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer p-3 border border-ink-800 hover:border-ink-700 transition-colors">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-ink-100"
      />
      <div className="flex-1">
        <div className="text-sm font-semibold flex items-center gap-2">
          {danger && <span className="text-qa text-xs">⚠</span>}
          {label}
        </div>
        <div className="text-xs text-ink-400 mt-0.5 leading-relaxed">
          {description}
        </div>
      </div>
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
      />
    </div>
  );
}
