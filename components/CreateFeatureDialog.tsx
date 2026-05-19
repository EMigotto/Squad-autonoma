"use client";

import { useState } from "react";

function stringifyError(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    try {
      return JSON.stringify(err, null, 2);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

export default function CreateFeatureDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    slug: "",
    title: "",
    description: "",
    github_repo: "",
    github_parent_issue: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>("");
  const [stack, setStack] = useState<string>("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setStack("");
    try {
      const res = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          github_parent_issue:
            parseInt(form.github_parent_issue, 10) || 0,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(stringifyError(j.error) || `HTTP ${res.status}`);
        if (j.stack) setStack(j.stack);
        setSubmitting(false);
        return;
      }
      // Sucesso: mostra confirmação e fecha após 1.5s
      setSuccess(true);
      setTimeout(() => {
        onClose();
        // Force refresh do board pra garantir que o card aparece
        window.location.reload();
      }, 1500);
    } catch (err) {
      setError(stringifyError(err));
      setSubmitting(false);
    }
  }

  function field(
    key: keyof typeof form,
    label: string,
    placeholder: string,
    multiline = false
  ) {
    const Tag = multiline ? "textarea" : "input";
    return (
      <div>
        <label className="block text-xs uppercase tracking-widest text-ink-400 mb-1">
          {label}
        </label>
        <Tag
          {...({ type: multiline ? undefined : "text" } as any)}
          required
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          placeholder={placeholder}
          rows={multiline ? 4 : undefined}
          disabled={success}
          className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm text-ink-100 focus:border-discovery focus:outline-none disabled:opacity-50"
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-ink-950/80 flex items-center justify-center p-4 z-50">
      <form
        onSubmit={handleSubmit}
        className="bg-ink-900 border border-ink-700 w-full max-w-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-ink-400">
              // nova feature
            </div>
            <h2 className="text-lg font-semibold mt-1">
              Inicia a esteira do squad
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={success}
            className="text-ink-400 hover:text-ink-100 text-xl leading-none disabled:opacity-50"
          >
            ×
          </button>
        </div>

        {success && (
          <div className="border border-qa bg-qa/5 p-3 text-sm text-qa">
            <div className="font-semibold mb-1">feature criada ✓</div>
            <div className="text-xs opacity-80">
              PM Agent disparado. Você vai ver o card aparecer em Discovery em segundos. Atualizando…
            </div>
          </div>
        )}

        {!success && (
          <>
            {field("slug", "slug", "ex: dark-mode-toggle")}
            {field("title", "título", "ex: Dark mode no app")}
            {field("description", "descrição", "O que precisa ser feito?", true)}
            {field("github_repo", "github repo", "owner/repo")}
            {field(
              "github_parent_issue",
              "parent issue # (opcional)",
              "ex: 42"
            )}
          </>
        )}

        {error && (
          <div className="border border-qa bg-qa/5 p-3 text-xs text-qa font-mono whitespace-pre-wrap">
            <div className="uppercase tracking-widest mb-1 opacity-70">erro</div>
            {error}
            {stack && (
              <details className="mt-2 opacity-80">
                <summary className="cursor-pointer">stack trace</summary>
                <pre className="mt-2 text-[10px] overflow-x-auto">{stack}</pre>
              </details>
            )}
          </div>
        )}

        {!success && (
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-sm text-ink-300 hover:text-ink-100"
            >
              cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="bg-ink-100 text-ink-950 px-3 py-1.5 text-sm font-semibold hover:bg-ink-300 disabled:opacity-50"
            >
              {submitting ? "criando..." : "criar e disparar PM Agent →"}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
