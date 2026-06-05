"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

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

interface PendingFile {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  storagePath?: string;
  error?: string;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB por arquivo
const MAX_FILES = 5;

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
  const [repos, setRepos] = useState<any[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string>("");
  const [environments, setEnvironments] = useState<any[]>([]);
  const [selectedEnvId, setSelectedEnvId] = useState<string>("");
  const [branchMode, setBranchMode] = useState<"env" | "new">("env");
  const [newBranch, setNewBranch] = useState<string>("");
  const [sourceBranch, setSourceBranch] = useState<string>("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>("");
  const [stack, setStack] = useState<string>("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/projects/repos")
      .then((r) => r.json())
      .then((data) => {
        setRepos(data.repos ?? []);
        if (data.repos?.length) setSelectedRepoId(data.repos[0].id);
      })
      .catch(() => {});
  }, []);

  // Ambientes pertencem à Aplicação: recarrega quando a aplicação muda
  useEffect(() => {
    if (!selectedRepoId) {
      setEnvironments([]);
      setSelectedEnvId("");
      return;
    }
    fetch(`/api/environments?repository_id=${selectedRepoId}`)
      .then((r) => r.json())
      .then((data) => {
        const envs = data.environments ?? [];
        setEnvironments(envs);
        const def = envs.find((e: any) => e.is_default) ?? envs[0];
        setSelectedEnvId(def?.id ?? "");
      })
      .catch(() => {});
  }, [selectedRepoId]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    const valid: PendingFile[] = [];
    const errors: string[] = [];

    for (const f of selected) {
      if (files.length + valid.length >= MAX_FILES) {
        errors.push(`máximo ${MAX_FILES} arquivos`);
        break;
      }
      const lower = f.name.toLowerCase();
      const isAllowed =
        lower.endsWith(".html") ||
        lower.endsWith(".htm") ||
        lower.endsWith(".docx") ||
        lower.endsWith(".doc") ||
        lower.endsWith(".fig") ||
        f.type === "text/html" ||
        f.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        f.type === "application/msword";
      if (!isAllowed) {
        errors.push(`${f.name} — formato não suportado (use .html, .docx ou .fig)`);
        continue;
      }
      if (f.size > MAX_FILE_SIZE) {
        errors.push(`${f.name} é maior que 50MB`);
        continue;
      }
      valid.push({ file: f, status: "pending" });
    }

    if (errors.length > 0) {
      setError(errors.join("; "));
    } else {
      setError("");
    }
    setFiles([...files, ...valid]);
    e.target.value = ""; // permite re-selecionar mesmo arquivo
  }

  function removeFile(idx: number) {
    setFiles(files.filter((_, i) => i !== idx));
  }

  async function uploadAll(): Promise<string[]> {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) throw new Error("sessão expirada");

    const uploaded: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const pending = files[i];
      if (pending.status === "done" && pending.storagePath) {
        uploaded.push(pending.storagePath);
        continue;
      }

      // Atualiza status pra "uploading"
      setFiles((prev) =>
        prev.map((f, j) => (j === i ? { ...f, status: "uploading" } : f))
      );

      const path = `${user.id}/${Date.now()}-${pending.file.name}`;
      const { error: upErr } = await sb.storage
        .from("feature-attachments")
        .upload(path, pending.file, {
          contentType: pending.file.type || "text/html",
          upsert: false,
        });

      if (upErr) {
        setFiles((prev) =>
          prev.map((f, j) =>
            j === i ? { ...f, status: "error", error: upErr.message } : f
          )
        );
        throw new Error(`falha no upload de ${pending.file.name}: ${upErr.message}`);
      }

      uploaded.push(path);
      setFiles((prev) =>
        prev.map((f, j) =>
          j === i ? { ...f, status: "done", storagePath: path } : f
        )
      );
    }

    return uploaded;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setStack("");
    try {
      const attachmentPaths = files.length > 0 ? await uploadAll() : [];

      const res = await fetch("/api/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          repository_id: selectedRepoId || undefined,
          environment_id: selectedEnvId || undefined,
          working_branch:
            branchMode === "new" && newBranch.trim()
              ? newBranch.trim()
              : undefined,
          source_branch:
            branchMode === "new" && sourceBranch.trim()
              ? sourceBranch.trim()
              : undefined,
          github_parent_issue:
            parseInt(form.github_parent_issue, 10) || 0,
          attachment_paths: attachmentPaths,
          attachment_filenames: files.map((f) => f.file.name),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(stringifyError(j.error) || `HTTP ${res.status}`);
        if (j.stack) setStack(j.stack);
        setSubmitting(false);
        return;
      }
      setSuccess(true);
      setTimeout(() => {
        onClose();
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
    multiline = false,
    optional = false
  ) {
    const Tag = multiline ? "textarea" : "input";
    return (
      <div>
        <label className="block text-xs uppercase tracking-widest text-ink-400 mb-1">
          {label}
        </label>
        <Tag
          {...({ type: multiline ? undefined : "text" } as any)}
          {...(optional ? {} : { required: true })}
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
              PM Agent disparado com os protótipos anexados. Atualizando…
            </div>
          </div>
        )}

        {!success && (
          <>
            {field("slug", "slug", "ex: dark-mode-toggle")}
            {field("title", "título", "ex: Dark mode no app")}
            {field("description", "descrição", "O que precisa ser feito?", true)}
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">
                aplicação
              </label>
              {repos.length === 0 ? (
                <div className="text-[11px] text-planning border border-planning/40 bg-planning/5 p-2">
                  nenhuma aplicação no time. Adicione uma em /settings → aplicações.
                </div>
              ) : (
                <select
                  value={selectedRepoId}
                  onChange={(e) => setSelectedRepoId(e.target.value)}
                  className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
                >
                  {repos.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label ?? r.github_repo} ({r.github_repo})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">
                ambiente
              </label>
              {environments.length === 0 ? (
                <div className="text-[11px] text-planning border border-planning/40 bg-planning/5 p-2">
                  nenhum ambiente nesta aplicação. Crie em /settings → aplicação.
                </div>
              ) : (
                <select
                  value={selectedEnvId}
                  onChange={(e) => setSelectedEnvId(e.target.value)}
                  className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
                >
                  {environments.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}{e.branch ? ` → ${e.branch}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="border border-ink-800 bg-ink-900/40 p-2 space-y-2">
              <label className="block text-[10px] uppercase tracking-widest text-ink-400">
                branch de trabalho
              </label>
              <div className="flex gap-3 text-[11px]">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="branch-mode"
                    checked={branchMode === "env"}
                    onChange={() => setBranchMode("env")}
                  />
                  <span>usar a branch do ambiente</span>
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="branch-mode"
                    checked={branchMode === "new"}
                    onChange={() => {
                      setBranchMode("new");
                      const envBr = environments.find((e: any) => e.id === selectedEnvId)?.branch;
                      if (!sourceBranch && envBr) setSourceBranch(envBr);
                    }}
                  />
                  <span>criar branch nova</span>
                </label>
              </div>
              {branchMode === "new" && (
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <div>
                    <label className="block text-[9px] uppercase tracking-widest text-ink-500 mb-1">
                      nova branch (working)
                    </label>
                    <input
                      type="text"
                      value={newBranch}
                      onChange={(e) => setNewBranch(e.target.value)}
                      placeholder="ex: feature/inventario-c3"
                      className="w-full bg-ink-900 border border-ink-700 px-2 py-1 text-xs font-mono focus:border-discovery focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] uppercase tracking-widest text-ink-500 mb-1">
                      raiz (clonar a partir de)
                    </label>
                    <input
                      type="text"
                      value={sourceBranch}
                      onChange={(e) => setSourceBranch(e.target.value)}
                      placeholder="ex: develop, main"
                      className="w-full bg-ink-900 border border-ink-700 px-2 py-1 text-xs font-mono focus:border-discovery focus:outline-none"
                    />
                  </div>
                  <div className="col-span-2 text-[10px] text-ink-500 leading-relaxed">
                    Se a branch nova não existir, será criada a partir da raiz informada.
                    Os agentes commitam tudo nela.
                  </div>
                </div>
              )}
            </div>
            {field(
              "github_parent_issue",
              "parent issue # (opcional)",
              "ex: 42 (deixe em branco se não houver)",
              false,
              true
            )}

            {/* Upload de HTMLs */}
            <div>
              <label className="block text-xs uppercase tracking-widest text-ink-400 mb-1">
                protótipos (HTML · Word · Figma — opcional · até {MAX_FILES} arquivos · 50MB cada)
              </label>
              <div className="text-[11px] text-ink-400 mb-2 leading-relaxed">
                Anexe HTMLs gerados no Claude Designer (ou outra ferramenta). Os
                agentes vão usar como referência visual exata — o PM Agent
                descreve essas telas no PRD, e os Devs implementam fidelidade visual.
              </div>

              <label className="block bg-ink-950 border border-dashed border-ink-700 hover:border-discovery transition-colors p-4 cursor-pointer text-center text-sm text-ink-300">
                <input
                  type="file"
                  accept=".html,.htm,.docx,.doc,.fig,text/html,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={files.length >= MAX_FILES}
                />
                + adicionar protótipo HTML
              </label>

              {files.length > 0 && (
                <div className="mt-2 space-y-1">
                  {files.map((f, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between bg-ink-950 border border-ink-800 px-2 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span
                          className={
                            f.status === "done"
                              ? "text-qa"
                              : f.status === "error"
                                ? "text-discovery"
                                : f.status === "uploading"
                                  ? "text-planning"
                                  : "text-ink-300"
                          }
                        >
                          {f.status === "done"
                            ? "✓"
                            : f.status === "error"
                              ? "✗"
                              : f.status === "uploading"
                                ? "…"
                                : "○"}
                        </span>
                        <span className="text-ink-100 truncate">{f.file.name}</span>
                        <span className="text-ink-400 shrink-0">
                          {(f.file.size / 1024).toFixed(0)}kb
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="text-ink-400 hover:text-ink-100 ml-2"
                        disabled={f.status === "uploading"}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
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
              {submitting
                ? files.length > 0
                  ? "fazendo upload..."
                  : "criando..."
                : "criar e disparar PM Agent →"}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
