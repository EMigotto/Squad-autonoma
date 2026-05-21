"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AgentEditor from "@/components/AgentEditor";

interface Settings {
  auto_merge_prs: boolean;
  commit_to_existing_branch: boolean;
  auto_advance_after_pm: boolean;
  auto_advance_after_tl: boolean;
  default_base_branch: string;
  notification_slack_webhook: string | null;
  human_hourly_cost?: number;
  token_cost_input_mtok?: number;
  token_cost_output_mtok?: number;
  metrics_currency?: string;
}

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
  deployed?: {
    claude_agent_id: string;
    version: number;
  } | null;
  needs_deploy?: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  auto_merge_prs: false,
  commit_to_existing_branch: false,
  auto_advance_after_pm: false,
  auto_advance_after_tl: false,
  default_base_branch: "main",
  notification_slack_webhook: null,
};

const STAGE_INFO: Record<
  string,
  { label: string; color: string; description: string }
> = {
  discovery: {
    label: "Discovery",
    color: "border-discovery text-discovery",
    description: "PRD + acceptance criteria + protótipo",
  },
  planning: {
    label: "Planejamento",
    color: "border-planning text-planning",
    description: "ADR + decomposição em chunks (sub-issues)",
  },
  development: {
    label: "Desenvolvimento",
    color: "border-development text-development",
    description: "Devs implementam chunks · Reviewer revisa PRs",
  },
  qa: {
    label: "QA",
    color: "border-qa text-qa",
    description: "Test suite + CI verde + coverage",
  },
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [showAgentEditor, setShowAgentEditor] = useState(false);
  const [creatingNew, setCreatingNew] = useState(false);
  const [consoleAgents, setConsoleAgents] = useState<any[]>([]);
  const [consoleError, setConsoleError] = useState<string | null>(null);
  const [needsSeed, setNeedsSeed] = useState(false);
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/settings").then((r) => r.json()),
      fetch("/api/agents").then((r) => r.json()),
    ])
      .then(([settingsData, agentsData]) => {
        if (settingsData.settings) setSettings(settingsData.settings);
        if (agentsData.agents) setAgents(agentsData.agents);
        if (agentsData.console_agents)
          setConsoleAgents(agentsData.console_agents);
        setConsoleError(agentsData.console_error ?? null);
        setNeedsSeed(!!agentsData.needs_seed);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  async function runSeed() {
    const secret = prompt(
      "para rodar o setup (seed + deploy), informe o ADMIN_SECRET:"
    );
    if (!secret) return;
    setSeeding(true);
    try {
      const res = await fetch("/api/admin/setup-agents", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      const data = await res.json();
      if (!res.ok) {
        alert("erro: " + (data.error ?? res.status));
      } else {
        await reloadAgents();
      }
    } catch (e) {
      alert("erro: " + String(e));
    } finally {
      setSeeding(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    setSaved(false);
    setError("");
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
    setSaving(false);
  }

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings({ ...settings, [key]: value });
  }

  async function reloadAgents() {
    const res = await fetch("/api/agents");
    const data = await res.json();
    if (data.agents) setAgents(data.agents);
    if (data.console_agents) setConsoleAgents(data.console_agents);
    setConsoleError(data.console_error ?? null);
    setNeedsSeed(!!data.needs_seed);
  }

  async function deleteAgent(role: string) {
    if (!confirm(`deletar agente "${role}"?`)) return;
    const res = await fetch(`/api/agents/${role}`, { method: "DELETE" });
    if (res.ok) {
      reloadAgents();
    } else {
      const j = await res.json().catch(() => ({}));
      alert("erro: " + (j.error ?? res.status));
    }
  }

  async function toggleEnabled(role: string, enabled: boolean) {
    await fetch(`/api/agents/${role}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    reloadAgents();
  }

  if (loading) {
    return <main className="p-8 text-sm text-ink-300">carregando...</main>;
  }

  // Agrupa agents por stage
  const byStage: Record<string, Agent[]> = {};
  for (const a of agents) {
    if (!byStage[a.stage]) byStage[a.stage] = [];
    byStage[a.stage].push(a);
  }
  const stageOrder = ["discovery", "planning", "development", "qa"];

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-5xl mx-auto space-y-12">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-ink-400 mb-2">
              // configurações do squad
            </div>
            <h1 className="text-xl font-semibold">
              Configurações<span className="text-discovery">.</span>
            </h1>
          </div>
          <Link
            href="/"
            className="text-xs uppercase tracking-widest text-ink-300 hover:text-ink-100"
          >
            ← voltar ao board
          </Link>
        </div>

        {/* PROJETOS */}
        <ProjectsSection />

        {/* CUSTOS DE REFERÊNCIA (para os indicadores) */}
        <section>
          <h2 className="text-sm uppercase tracking-widest text-ink-400 mb-4">
            // custos de referência (indicadores)
          </h2>
          <div className="text-xs text-ink-400 mb-4 leading-relaxed">
            Usados para calcular o <strong>custo por feature</strong>. Definidos
            por projeto (equipe). O custo humano costuma ser o fator dominante.
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] text-ink-400 block mb-1">
                custo humano / hora
              </label>
              <input
                type="number"
                value={settings.human_hourly_cost ?? 0}
                onChange={(e) => update("human_hourly_cost", Number(e.target.value) as any)}
                className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm text-ink-100 focus:border-discovery focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] text-ink-400 block mb-1">
                custo input / Mtok
              </label>
              <input
                type="number"
                value={settings.token_cost_input_mtok ?? 0}
                onChange={(e) => update("token_cost_input_mtok", Number(e.target.value) as any)}
                className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm text-ink-100 focus:border-discovery focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] text-ink-400 block mb-1">
                custo output / Mtok
              </label>
              <input
                type="number"
                value={settings.token_cost_output_mtok ?? 0}
                onChange={(e) => update("token_cost_output_mtok", Number(e.target.value) as any)}
                className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm text-ink-100 focus:border-discovery focus:outline-none"
              />
            </div>
            <div>
              <label className="text-[11px] text-ink-400 block mb-1">moeda</label>
              <input
                type="text"
                value={settings.metrics_currency ?? "BRL"}
                onChange={(e) => update("metrics_currency", e.target.value as any)}
                className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm text-ink-100 focus:border-discovery focus:outline-none"
              />
            </div>
          </div>
          <button
            onClick={saveSettings}
            className="mt-4 bg-ink-100 text-ink-950 px-4 py-1.5 text-sm font-semibold hover:bg-ink-300"
          >
            salvar custos
          </button>
        </section>

        {/* WORKFLOW DIAGRAM */}
        <section>
          <h2 className="text-sm uppercase tracking-widest text-ink-400 mb-4">
            // orquestração atual
          </h2>
          <div className="text-xs text-ink-400 mb-6 leading-relaxed">
            Cada feature é UM card que percorre as quatro raias. Em cada raia,
            os agentes habilitados rodam em ordem de <code>sort_order</code>. No
            modo atual, apenas o primeiro habilitado por stage é despachado;
            múltiplos agentes na mesma raia ficam disponíveis para uso futuro.
          </div>

          <WorkflowDiagram byStage={byStage} stageOrder={stageOrder} />
        </section>

        {/* AGENTS */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm uppercase tracking-widest text-ink-400">
              // agentes ({agents.length})
            </h2>
            <button
              onClick={() => {
                setCreatingNew(true);
                setEditingAgent(null);
                setShowAgentEditor(true);
              }}
              className="bg-ink-100 text-ink-950 px-3 py-1.5 text-xs font-semibold hover:bg-ink-300 transition-colors"
            >
              + adicionar agente
            </button>
          </div>

          {needsSeed && (
            <div className="border border-planning bg-planning/10 p-4 mb-4">
              <div className="text-sm text-planning font-semibold mb-1">
                ⚠ Nenhum agente configurado no banco
              </div>
              <div className="text-xs text-ink-300 mb-3 leading-relaxed">
                A tabela <code>agent_definitions</code> está vazia. Rode o setup
                para semear os 7 agentes builtin e fazer deploy no Claude. Isso
                também sincroniza os agentes que já existem no Console.
              </div>
              <button
                onClick={runSeed}
                disabled={seeding}
                className="bg-planning text-ink-950 px-3 py-1.5 text-xs font-semibold hover:bg-planning/80 disabled:opacity-50"
              >
                {seeding ? "rodando setup..." : "rodar setup agora"}
              </button>
            </div>
          )}

          {/* Agents existentes no Claude Console */}
          <div className="border border-ink-800 bg-ink-900/30 p-4 mb-6">
            <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-2">
              // agentes no claude console ({consoleAgents.length})
            </div>
            {consoleError ? (
              <div className="text-xs text-qa font-mono">
                erro ao listar do Console: {consoleError}
              </div>
            ) : consoleAgents.length === 0 ? (
              <div className="text-xs text-ink-400 italic">
                nenhum agente encontrado no Claude Console
              </div>
            ) : (
              <div className="space-y-1">
                {consoleAgents.map((ca) => (
                  <div
                    key={ca.id}
                    className="flex items-center gap-2 text-xs py-1 border-b border-ink-800 last:border-0"
                  >
                    <span className="text-ink-100">{ca.name}</span>
                    <span className="text-ink-400 font-mono text-[10px]">
                      {ca.id}
                    </span>
                    {ca.model && (
                      <span className="text-ink-400 text-[10px]">
                        · {ca.model}
                      </span>
                    )}
                    {ca.version !== undefined && (
                      <span className="text-ink-400 text-[10px]">
                        · v{ca.version}
                      </span>
                    )}
                    <span className="ml-auto">
                      {ca.mapped_stage ? (
                        <span
                          className={`text-[10px] uppercase tracking-widest ${
                            STAGE_INFO[ca.mapped_stage]?.color ?? "text-ink-400"
                          }`}
                        >
                          {STAGE_INFO[ca.mapped_stage]?.label ??
                            ca.mapped_stage}
                        </span>
                      ) : (
                        <span className="text-[10px] text-ink-400 italic">
                          não mapeado a uma stage
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-6">
            {stageOrder.map((stage) => (
              <div key={stage}>
                <div
                  className={`text-[10px] uppercase tracking-widest mb-2 ${
                    STAGE_INFO[stage]?.color ?? "text-ink-400"
                  }`}
                >
                  // {STAGE_INFO[stage]?.label ?? stage} ·{" "}
                  {byStage[stage]?.length ?? 0} agente
                  {(byStage[stage]?.length ?? 0) === 1 ? "" : "s"}
                </div>
                {(!byStage[stage] || byStage[stage].length === 0) ? (
                  <div className="text-xs text-ink-400 italic border border-dashed border-ink-800 p-4">
                    nenhum agente configurado para esta stage
                  </div>
                ) : (
                  <div className="space-y-2">
                    {byStage[stage].map((a) => (
                      <AgentRow
                        key={a.role}
                        agent={a}
                        onEdit={() => {
                          setEditingAgent(a);
                          setCreatingNew(false);
                          setShowAgentEditor(true);
                        }}
                        onDelete={() => deleteAgent(a.role)}
                        onToggle={(enabled) => toggleEnabled(a.role, enabled)}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* GIT WORKFLOW */}
        <section>
          <h2 className="text-sm uppercase tracking-widest text-ink-400 mb-4">
            // git workflow
          </h2>
          <div className="space-y-3">
            <Toggle
              label="commit em branch existente"
              description="Em vez de criar branch nova por chunk, os agentes commitam direto na default branch. Pula o PR review."
              danger
              value={settings.commit_to_existing_branch}
              onChange={(v) => update("commit_to_existing_branch", v)}
            />
            <Toggle
              label="auto-merge de PRs após CI verde"
              description="Quando CI passa, o agent merge automaticamente."
              value={settings.auto_merge_prs}
              onChange={(v) => update("auto_merge_prs", v)}
            />
            <SimpleField
              label="default base branch"
              value={settings.default_base_branch}
              onChange={(v) => update("default_base_branch", v)}
              placeholder="main"
            />
          </div>
        </section>

        {/* GATES HUMANOS */}
        <section>
          <h2 className="text-sm uppercase tracking-widest text-ink-400 mb-4">
            // gates humanos
          </h2>
          <div className="space-y-3">
            <Toggle
              label="auto-aprovar PM Agent (Discovery)"
              description="Pula o gate humano após PM Agent terminar."
              danger
              value={settings.auto_advance_after_pm}
              onChange={(v) => update("auto_advance_after_pm", v)}
            />
            <Toggle
              label="auto-aprovar Tech Lead (Planning)"
              description="Pula o gate humano após Tech Lead Agent decompor."
              danger
              value={settings.auto_advance_after_tl}
              onChange={(v) => update("auto_advance_after_tl", v)}
            />
          </div>
        </section>

        <section>
          <h2 className="text-sm uppercase tracking-widest text-ink-400 mb-4">
            // notificações
          </h2>
          <SimpleField
            label="slack webhook url (opcional)"
            value={settings.notification_slack_webhook ?? ""}
            onChange={(v) => update("notification_slack_webhook", v || null)}
            placeholder="https://hooks.slack.com/services/..."
          />
        </section>

        <div className="pt-4 border-t border-ink-700 flex items-center justify-between">
          {error && <div className="text-xs text-qa font-mono">{error}</div>}
          {saved && <div className="text-xs text-qa">salvo ✓</div>}
          <div className="ml-auto">
            <button
              onClick={saveSettings}
              disabled={saving}
              className="bg-ink-100 text-ink-950 px-4 py-2 text-sm font-semibold hover:bg-ink-300 transition-colors disabled:opacity-50"
            >
              {saving ? "salvando..." : "salvar configurações"}
            </button>
          </div>
        </div>
      </div>

      {showAgentEditor && (
        <AgentEditor
          agent={creatingNew ? null : editingAgent}
          onClose={() => setShowAgentEditor(false)}
          onSaved={() => {
            setShowAgentEditor(false);
            reloadAgents();
          }}
        />
      )}
    </main>
  );
}

function ProjectsSection() {
  const [projects, setProjects] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    sigla: "",
    github_repo: "",
    default_base_branch: "main",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/projects");
    const data = await res.json();
    setProjects(data.projects ?? []);
    setActiveId(data.active_project_id ?? null);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function createProject() {
    if (!form.name.trim() || !form.sigla.trim()) {
      setError("nome e sigla são obrigatórios");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? `HTTP ${res.status}`);
      setSaving(false);
      return;
    }
    // Ativa o projeto recém-criado e roda o setup de agentes nele
    await fetch("/api/projects/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: data.project.id }),
    });
    await fetch("/api/admin/setup-agents", { method: "POST" });
    window.location.reload();
  }

  async function activate(id: string) {
    await fetch("/api/projects/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: id }),
    });
    window.location.reload();
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm uppercase tracking-widest text-ink-400">
          // times e projetos
        </h2>
        <button
          onClick={() => setCreating(!creating)}
          className="bg-ink-100 text-ink-950 px-3 py-1.5 text-xs font-semibold hover:bg-ink-300 transition-colors"
        >
          {creating ? "fechar" : "+ novo projeto"}
        </button>
      </div>

      <div className="text-xs text-ink-400 mb-4 leading-relaxed">
        Cada projeto tem nome, sigla e repositório próprios, e carrega suas
        próprias configurações de agentes e settings. Trocar de projeto no
        seletor do board muda todo o contexto.
      </div>

      {creating && (
        <div className="border border-ink-700 bg-ink-900/40 p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <SimpleField
              label="nome do projeto"
              value={form.name}
              onChange={(v) => setForm({ ...form, name: v })}
              placeholder="ex: Certificado Digital"
            />
            <SimpleField
              label="sigla"
              value={form.sigla}
              onChange={(v) => setForm({ ...form, sigla: v })}
              placeholder="ex: CERT"
            />
            <SimpleField
              label="github repo"
              value={form.github_repo}
              onChange={(v) => setForm({ ...form, github_repo: v })}
              placeholder="owner/repo"
            />
            <SimpleField
              label="branch base"
              value={form.default_base_branch}
              onChange={(v) => setForm({ ...form, default_base_branch: v })}
              placeholder="main"
            />
          </div>
          {error && (
            <div className="text-xs text-qa font-mono">{error}</div>
          )}
          <div className="text-[10px] text-ink-400">
            ao criar, os 7 agentes builtin são semeados e deployados
            automaticamente neste projeto.
          </div>
          <button
            onClick={createProject}
            disabled={saving}
            className="bg-discovery text-ink-950 px-4 py-1.5 text-sm font-semibold hover:bg-discovery/80 disabled:opacity-50"
          >
            {saving ? "criando + deployando agentes..." : "criar projeto"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-ink-400">carregando projetos...</div>
      ) : projects.length === 0 ? (
        <div className="text-xs text-ink-400 italic border border-dashed border-ink-800 p-4">
          nenhum projeto ainda. Crie o primeiro acima.
        </div>
      ) : (
        <div className="space-y-2">
          {projects.map((p) => (
            <div
              key={p.id}
              className={`border p-3 flex items-center justify-between ${
                p.id === activeId
                  ? "border-discovery bg-discovery/5"
                  : "border-ink-700 bg-ink-900/40"
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-discovery border border-discovery/40 px-1.5 py-0.5">
                    {p.sigla}
                  </span>
                  <span className="text-sm font-semibold">{p.name}</span>
                  {p.id === activeId && (
                    <span className="text-[10px] text-discovery">● ativo</span>
                  )}
                </div>
                <div className="text-[11px] text-ink-400 mt-1 font-mono">
                  {p.github_repo ?? "sem repo"}
                  {p.team?.name && ` · time: ${p.team.name}`}
                </div>
              </div>
              {p.id !== activeId && (
                <button
                  onClick={() => activate(p.id)}
                  className="text-xs text-development hover:underline px-2"
                >
                  ativar
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Repositórios do projeto ativo */}
      <ReposManager />
    </section>
  );
}

function ReposManager() {
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRepo, setNewRepo] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/projects/repos");
    const data = await res.json();
    setRepos(data.repos ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function addRepo() {
    if (!newRepo.trim()) return;
    setAdding(true);
    setError("");
    const res = await fetch("/api/projects/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ github_repo: newRepo.trim(), label: newLabel.trim() }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? `HTTP ${res.status}`);
    } else {
      setNewRepo("");
      setNewLabel("");
      await load();
    }
    setAdding(false);
  }

  async function removeRepo(id: string) {
    if (!confirm("remover este repositório do projeto?")) return;
    const res = await fetch(`/api/projects/repos?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      load();
    } else {
      const j = await res.json().catch(() => ({}));
      alert("erro: " + (j.error ?? res.status));
    }
  }

  return (
    <div className="mt-6 pt-6 border-t border-ink-800">
      <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-2">
        // repositórios do projeto ativo ({repos.length})
      </div>
      <div className="text-xs text-ink-400 mb-3 leading-relaxed">
        Um projeto pode ter vários repositórios. Ao criar uma feature, você
        escolhe em qual repo ela vai rodar.
      </div>

      {loading ? (
        <div className="text-xs text-ink-400">carregando...</div>
      ) : (
        <div className="space-y-2 mb-3">
          {repos.length === 0 && (
            <div className="text-xs text-ink-400 italic">
              nenhum repositório ainda
            </div>
          )}
          {repos.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between border border-ink-700 bg-ink-900/40 p-2"
            >
              <div>
                <span className="text-sm text-ink-100 font-mono">
                  {r.github_repo}
                </span>
                {r.label && r.label !== r.github_repo && (
                  <span className="text-[11px] text-ink-400 ml-2">
                    {r.label}
                  </span>
                )}
                <span className="text-[10px] text-ink-400 ml-2">
                  base: {r.default_base_branch}
                </span>
              </div>
              <button
                onClick={() => removeRepo(r.id)}
                className="text-xs text-qa hover:underline px-2"
              >
                remover
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">
            github repo (owner/repo)
          </label>
          <input
            type="text"
            value={newRepo}
            onChange={(e) => setNewRepo(e.target.value)}
            placeholder="ex: EMigotto/outro-repo"
            className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
          />
        </div>
        <div className="flex-1 min-w-[150px]">
          <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">
            label (opcional)
          </label>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="ex: API"
            className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
          />
        </div>
        <button
          onClick={addRepo}
          disabled={adding || !newRepo.trim()}
          className="bg-development text-ink-950 px-3 py-1.5 text-sm font-semibold hover:bg-development/80 disabled:opacity-50"
        >
          {adding ? "..." : "+ adicionar repo"}
        </button>
      </div>
      {error && <div className="text-xs text-qa font-mono mt-2">{error}</div>}
    </div>
  );
}

function WorkflowDiagram({
  byStage,
  stageOrder,
}: {
  byStage: Record<string, Agent[]>;
  stageOrder: string[];
}) {
  return (
    <div className="border border-ink-700 p-6 bg-ink-900/40">
      <div className="flex items-stretch gap-3 overflow-x-auto">
        {stageOrder.map((stage, idx) => (
          <div key={stage} className="flex items-center gap-3 shrink-0">
            <StageBox stage={stage} agents={byStage[stage] ?? []} />
            {idx < stageOrder.length - 1 && (
              <ArrowGate label="gate humano" />
            )}
          </div>
        ))}
        <div className="flex items-center gap-3 shrink-0">
          <ArrowGate label="gate humano" />
          <DoneBox />
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 text-[11px] text-ink-400">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border border-ink-100" />
          <span>card percorre as raias (mesmo card)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border border-planning" />
          <span>gate humano (aprovar/rejeitar)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-development">⚡</span>
          <span>sessão Claude (uma por stage rodada)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-ink-300">↺</span>
          <span>rejeição refaz na mesma stage com feedback</span>
        </div>
      </div>
    </div>
  );
}

function StageBox({ stage, agents }: { stage: string; agents: Agent[] }) {
  const info = STAGE_INFO[stage] ?? {
    label: stage,
    color: "border-ink-700 text-ink-300",
    description: "",
  };
  const enabledAgents = agents.filter((a) => a.enabled);
  const primary = enabledAgents.sort((a, b) => a.sort_order - b.sort_order)[0];

  return (
    <div className={`w-48 border ${info.color} p-3 bg-ink-950`}>
      <div className="text-xs uppercase tracking-widest mb-2">{info.label}</div>
      <div className="text-[10px] text-ink-400 mb-3">{info.description}</div>
      <div className="border-t border-ink-800 pt-2 space-y-1">
        {agents.length === 0 ? (
          <div className="text-[10px] text-ink-400 italic">sem agentes</div>
        ) : (
          agents.map((a) => (
            <div
              key={a.role}
              className={`text-[11px] flex items-center gap-1 ${
                a.enabled ? "text-ink-100" : "text-ink-400 line-through"
              }`}
            >
              {a === primary && <span>⚡</span>}
              <span className="truncate">{a.name}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function DoneBox() {
  return (
    <div className="w-40 border border-done text-done p-3 bg-ink-950">
      <div className="text-xs uppercase tracking-widest mb-2">Concluído</div>
      <div className="text-[10px] text-ink-400">card terminal</div>
    </div>
  );
}

function ArrowGate({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-[9px] uppercase tracking-widest text-planning">
        {label}
      </div>
      <div className="text-planning text-2xl leading-none">→</div>
    </div>
  );
}

function AgentRow({
  agent,
  onEdit,
  onDelete,
  onToggle,
}: {
  agent: Agent;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <div
      className={`border ${
        agent.enabled ? "border-ink-700" : "border-ink-800"
      } bg-ink-900/40 p-3 ${agent.enabled ? "" : "opacity-60"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold">{agent.name}</span>
            {agent.is_builtin && (
              <span className="text-[10px] text-ink-400 border border-ink-700 px-1.5 py-0.5">
                builtin
              </span>
            )}
            <span className="text-[10px] text-ink-400 font-mono">
              {agent.role}
            </span>
            <span className="text-[10px] text-ink-400">
              · {agent.model} · order {agent.sort_order}
            </span>
            {agent.needs_deploy && (
              <span className="text-[10px] text-planning border border-planning/40 px-1.5 py-0.5">
                precisa redeploy
              </span>
            )}
          </div>
          {agent.description && (
            <div className="text-xs text-ink-300 mb-2">
              {agent.description}
            </div>
          )}
          {agent.deployed && (
            <div className="text-[10px] text-ink-400 font-mono">
              {agent.deployed.claude_agent_id} · v{agent.deployed.version}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={agent.enabled}
              onChange={(e) => onToggle(e.target.checked)}
              className="accent-ink-100"
            />
            <span className="text-[11px] text-ink-400">on</span>
          </label>
          <button
            onClick={onEdit}
            className="text-xs text-development hover:underline px-2"
          >
            editar
          </button>
          {!agent.is_builtin && (
            <button
              onClick={onDelete}
              className="text-xs text-qa hover:underline px-2"
            >
              deletar
            </button>
          )}
        </div>
      </div>
    </div>
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

function SimpleField({
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
