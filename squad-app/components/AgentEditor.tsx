"use client";

import { useState } from "react";

interface Agent {
  role: string;
  name: string;
  stage: string;
  model: string;
  system_prompt: string;
  sort_order: number;
  enabled: boolean;
  is_builtin: boolean;
  description?: string | null;
}

interface Props {
  agent: Agent | null; // null = criar novo
  onClose: () => void;
  onSaved: () => void;
}

const MODELS = [
  { id: "claude-haiku-4-5", label: "Haiku 4.5 (rápido)" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6 (balanceado)" },
  { id: "claude-opus-4-6", label: "Opus 4.6 (forte)" },
  { id: "claude-opus-4-7", label: "Opus 4.7 (mais novo)" },
];

const STAGES = [
  { id: "discovery", label: "Discovery" },
  { id: "planning", label: "Planejamento" },
  { id: "development", label: "Desenvolvimento" },
  { id: "qa", label: "QA" },
];

export default function AgentEditor({ agent, onClose, onSaved }: Props) {
  const isNew = !agent;
  const [form, setForm] = useState({
    role: agent?.role ?? "",
    name: agent?.name ?? "",
    stage: agent?.stage ?? "discovery",
    model: agent?.model ?? "claude-opus-4-6",
    system_prompt: agent?.system_prompt ?? "",
    sort_order: agent?.sort_order ?? 100,
    enabled: agent?.enabled ?? true,
    description: agent?.description ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deployStatus, setDeployStatus] = useState<string>("");

  async function handleSave() {
    if (!form.name.trim() || !form.system_prompt.trim()) {
      setError("name e system_prompt são obrigatórios");
      return;
    }
    if (isNew && !form.role.trim()) {
      setError("role é obrigatório");
      return;
    }
    setSaving(true);
    setError("");
    setDeployStatus("");

    const url = isNew ? "/api/agents" : `/api/agents/${agent!.role}`;
    const method = isNew ? "POST" : "PATCH";
    const body = isNew
      ? form
      : Object.fromEntries(
          Object.entries(form).filter(([k]) => k !== "role")
        );

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
      } else {
        if (data.deploy) {
          if (data.deploy.action === "failed") {
            setError(`salvo, mas deploy falhou: ${data.deploy.error}`);
          } else if (data.deploy.action !== "skipped") {
            setDeployStatus(
              `salvo + ${data.deploy.action} no Claude (v${data.deploy.version ?? "?"})`
            );
            setTimeout(onSaved, 1500);
            return;
          }
        }
        onSaved();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-ink-950/90 flex items-center justify-center p-4 z-[60]">
      <div className="bg-ink-950 border border-ink-700 w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="border-b border-ink-700 p-5 flex items-start justify-between shrink-0">
          <div>
            <div className="text-xs uppercase tracking-widest text-ink-400">
              // {isNew ? "novo agente" : "editar agente"}
            </div>
            <div className="text-lg font-semibold mt-1">
              {isNew ? "Adicionar agente customizado" : agent!.name}
            </div>
            {agent?.is_builtin && (
              <div className="text-[11px] text-planning mt-1">
                agente builtin — pode editar, mas não deletar
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-ink-400 hover:text-ink-100 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {isNew && (
              <Field
                label="role (id único)"
                value={form.role}
                onChange={(v) => setForm({ ...form, role: v })}
                placeholder="ex: security_reviewer"
                hint="apenas letras minúsculas, números e underscore"
              />
            )}
            <Field
              label="nome de exibição"
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
              placeholder="ex: Security Reviewer Agent"
            />
            <Select
              label="stage do Kanban"
              value={form.stage}
              options={STAGES.map((s) => ({ value: s.id, label: s.label }))}
              onChange={(v) => setForm({ ...form, stage: v })}
            />
            <Select
              label="modelo"
              value={form.model}
              options={MODELS.map((m) => ({ value: m.id, label: m.label }))}
              onChange={(v) => setForm({ ...form, model: v })}
            />
            <Field
              label="sort_order (ordem na stage)"
              value={String(form.sort_order)}
              onChange={(v) =>
                setForm({ ...form, sort_order: parseInt(v, 10) || 100 })
              }
              placeholder="100"
              hint="agentes com menor número rodam antes"
            />
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) =>
                    setForm({ ...form, enabled: e.target.checked })
                  }
                  className="accent-ink-100"
                />
                <span className="text-sm">habilitado</span>
              </label>
            </div>
          </div>

          <Field
            label="descrição (opcional)"
            value={form.description ?? ""}
            onChange={(v) => setForm({ ...form, description: v })}
            placeholder="o que esse agente faz?"
          />

          <div>
            <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">
              system prompt
            </label>
            <textarea
              value={form.system_prompt}
              onChange={(e) =>
                setForm({ ...form, system_prompt: e.target.value })
              }
              rows={18}
              placeholder="instruções completas para o agente..."
              className="w-full bg-ink-900 border border-ink-700 px-3 py-2 text-xs font-mono text-ink-100 focus:border-discovery focus:outline-none"
            />
            <div className="text-[10px] text-ink-400 mt-1">
              {form.system_prompt.length} caracteres ·{" "}
              ~{Math.ceil(form.system_prompt.length / 4)} tokens
            </div>
          </div>

          {error && (
            <div className="border border-qa bg-qa/10 p-3 text-xs text-qa font-mono">
              {error}
            </div>
          )}
          {deployStatus && (
            <div className="border border-qa bg-qa/10 p-3 text-xs text-qa">
              ✓ {deployStatus}
            </div>
          )}
        </div>

        <div className="border-t border-ink-700 p-4 flex justify-end gap-2 shrink-0">
          <button
            onClick={onClose}
            disabled={saving}
            className="text-sm text-ink-300 hover:text-ink-100 px-3 py-1.5"
          >
            cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-ink-100 text-ink-950 px-4 py-1.5 text-sm font-semibold hover:bg-ink-300 disabled:opacity-50"
          >
            {saving
              ? "salvando..."
              : isNew
                ? "criar e deployar"
                : "salvar e deployar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
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
      {hint && <div className="text-[10px] text-ink-400 mt-0.5">{hint}</div>}
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
