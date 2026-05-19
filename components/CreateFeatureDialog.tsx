"use client";

import { useState } from "react";

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
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    const res = await fetch("/api/features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        github_parent_issue: parseInt(form.github_parent_issue, 10) || 0,
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
          className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm text-ink-100 focus:border-discovery focus:outline-none"
        />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-ink-950/80 flex items-center justify-center p-4 z-50">
      <form
        onSubmit={handleSubmit}
        className="bg-ink-900 border border-ink-700 w-full max-w-xl p-6 space-y-4"
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
            className="text-ink-400 hover:text-ink-100 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {field("slug", "slug", "ex: dark-mode-toggle")}
        {field("title", "título", "ex: Dark mode no app")}
        {field("description", "descrição", "O que precisa ser feito?", true)}
        {field("github_repo", "github repo", "myorg/myrepo")}
        {field(
          "github_parent_issue",
          "parent issue # (opcional)",
          "ex: 42"
        )}

        {error && <div className="text-sm text-qa">{error}</div>}

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
      </form>
    </div>
  );
}
