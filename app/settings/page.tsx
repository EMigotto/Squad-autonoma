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
  notification_teams_webhook?: string | null;
  human_hourly_cost?: number;
  token_cost_input_mtok?: number;
  token_cost_output_mtok?: number;
  metrics_currency?: string;
  require_reinforced_review?: boolean;
  sensitive_paths?: string;
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
  const [tab, setTab] = useState<
    "people" | "knowledge" | "agents" | "workflow"
  >("people");
  const [configuring, setConfiguring] = useState(false);
  const [activeName, setActiveName] = useState("");

  useEffect(() => {
    const hasCfg =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("config");
    setConfiguring(!!hasCfg);
    if (hasCfg) {
      fetch("/api/projects")
        .then((r) => r.json())
        .then((d) => {
          const a = (d.projects ?? []).find(
            (p: any) => p.id === d.active_project_id
          );
          setActiveName(a?.name ?? "");
        })
        .catch(() => {});
    }
  }, []);
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
        <ProjectsSection configuringId={configuring} />

        {configuring && (
        <div key="config-panel" className="space-y-8">
          <div className="flex items-center justify-between border border-discovery/40 bg-discovery/5 px-4 py-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-ink-400">
                configurando o time
              </div>
              <div className="text-base font-semibold text-ink-100">
                {activeName || "—"}
              </div>
            </div>
            <a
              href="/settings"
              className="text-xs uppercase tracking-widest text-ink-300 hover:text-ink-100"
            >
              ← lista de times
            </a>
          </div>

        {/* APLICAÇÕES (cada uma com seus ambientes/branches) */}
        <ReposManager />

        {/* ABAS DE CONFIGURAÇÃO DO PROJETO ATIVO */}
        <div className="border-b border-ink-700 flex flex-wrap gap-1 sticky top-0 bg-ink-950 z-10">
          {[
            ["people", "pessoas & custos"],
            ["knowledge", "conhecimento & dreaming"],
            ["agents", "orquestração & agentes"],
            ["workflow", "workflow, gates & notificações"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id as typeof tab)}
              className={`px-4 py-2 text-xs uppercase tracking-widest border-b-2 transition-colors ${
                tab === id
                  ? "border-discovery text-ink-100"
                  : "border-transparent text-ink-400 hover:text-ink-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "people" && (
        <>
        {/* PESSOAS DO PROJETO */}
        <PeopleSection />

        {/* CUSTOS DE REFERÊNCIA (para os indicadores) */}
        <section>
          <h2 className="text-sm uppercase tracking-widest text-ink-400 mb-4">
            // custos de referência (indicadores)
          </h2>
          <div className="text-xs text-ink-400 mb-4 leading-relaxed">
            O <strong>custo humano/hora</strong> é calculado automaticamente a
            partir das pessoas cadastradas acima (média de salário ÷ horas). Você
            pode sobrescrevê-lo manualmente aqui se preferir. O custo de tokens é
            usado quando a captura de uso estiver ativa.
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

        {/* CONHECIMENTO & INSTRUÇÕES */}
        </>
        )}

        {tab === "knowledge" && (
        <>
        <KnowledgeSection />

        {/* DREAMING (evolução contínua) */}
        <DreamingSection />
        </>
        )}

        {tab === "agents" && (
        <>
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
        </>
        )}

        {tab === "agents" && <ClaudeCodeSection />}

        {tab === "workflow" && (
        <>
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
            // revisão reforçada (áreas sensíveis)
          </h2>
          <div className="space-y-3">
            <Toggle
              label="exigir revisão reforçada"
              description="Quando ligado, aprovar transições de Desenvolvimento→QA e QA→Concluído exige uma confirmação extra (digitar APROVAR), reduzindo aprovações por engano em mudanças sensíveis."
              value={settings.require_reinforced_review ?? false}
              onChange={(v) => update("require_reinforced_review", v as any)}
            />
            <div>
              <label className="text-[11px] text-ink-400 block mb-1">
                caminhos sensíveis (um por linha — globs)
              </label>
              <textarea
                value={settings.sensitive_paths ?? ""}
                onChange={(e) => update("sensitive_paths", e.target.value as any)}
                rows={3}
                placeholder={"src/payments/**\ndb/migrations/**\n**/auth/**"}
                className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm font-mono text-ink-100 focus:border-discovery focus:outline-none"
              />
              <div className="text-[10px] text-ink-400 mt-1">
                os agentes são instruídos a destacar no resumo quando tocam esses
                caminhos, para você revisar com atenção redobrada.
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm uppercase tracking-widest text-ink-400 mb-4">
            // notificações
          </h2>
          <div className="text-xs text-ink-400 mb-3 leading-relaxed">
            A cada etapa concluída na esteira (ex.: Discovery finalizado), o time é
            avisado. Cole a URL do fluxo <strong>Workflows</strong> do Teams
            (canal do time → ⋯ → Workflows → “Post to a channel when a webhook
            request is received”).
          </div>
          <SimpleField
            label="microsoft teams — webhook (workflows)"
            value={settings.notification_teams_webhook ?? ""}
            onChange={(v) => update("notification_teams_webhook", v || null)}
            placeholder="https://prod-XX.westus.logic.azure.com:443/workflows/..."
          />
          <div className="mt-3">
            <SimpleField
              label="slack webhook url (opcional / legado)"
              value={settings.notification_slack_webhook ?? ""}
              onChange={(v) => update("notification_slack_webhook", v || null)}
              placeholder="https://hooks.slack.com/services/..."
            />
          </div>
        </section>
        </>
        )}
        </div>
        )}

        {configuring && (
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
        )}
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

function AppEnvironments({ repositoryId, baseBranch }: { repositoryId: string; baseBranch?: string }) {
  const [envs, setEnvs] = useState<any[]>([]);
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const res = await fetch(`/api/environments?repository_id=${repositoryId}`);
    const data = await res.json();
    setEnvs(data.environments ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [repositoryId]);

  async function add() {
    if (!name.trim()) return;
    await fetch("/api/environments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repository_id: repositoryId, name, branch: branch || baseBranch || "main" }),
    });
    setName(""); setBranch(""); load();
  }
  async function remove(id: string) {
    await fetch(`/api/environments/${id}`, { method: "DELETE" });
    load();
  }
  async function saveBranch(id: string, b: string) {
    await fetch(`/api/environments/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch: b }),
    });
  }

  return (
    <div className="mt-3 pl-3 border-l border-ink-800">
      <div className="text-[10px] uppercase tracking-widest text-ink-400 mb-2">
        ambientes (branches) desta aplicação
      </div>
      {loading ? (
        <div className="text-[11px] text-ink-500">carregando…</div>
      ) : (
        <div className="space-y-1 mb-2">
          {envs.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-sm">
              <span className="text-ink-200 w-40 truncate">{e.name}</span>
              <span className="text-ink-500 text-xs">→</span>
              <input
                defaultValue={e.branch}
                onBlur={(ev) => saveBranch(e.id, ev.target.value)}
                className="flex-1 bg-ink-900 border border-ink-700 px-2 py-1 text-xs font-mono text-ink-100 focus:border-discovery focus:outline-none"
              />
              {e.is_default && (
                <span className="text-[9px] uppercase text-qa border border-qa/40 px-1 py-0.5">default</span>
              )}
              <button onClick={() => remove(e.id)} className="text-qa hover:underline text-[11px]">remover</button>
            </div>
          ))}
          {envs.length === 0 && (
            <div className="text-[11px] text-ink-500 italic">nenhum ambiente — adicione abaixo (ex.: Dev → develop)</div>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="ambiente (ex: Homologação)"
          className="flex-1 bg-ink-900 border border-ink-700 px-2 py-1 text-xs focus:border-discovery focus:outline-none" />
        <input value={branch} onChange={(e) => setBranch(e.target.value)}
          placeholder={`branch (ex: ${baseBranch || "main"})`}
          className="flex-1 bg-ink-900 border border-ink-700 px-2 py-1 text-xs font-mono focus:border-discovery focus:outline-none" />
        <button onClick={add} className="bg-ink-100 text-ink-950 px-2 py-1 text-xs font-semibold hover:bg-ink-300">+ ambiente</button>
      </div>
    </div>
  );
}

function PeopleSection() {
  const [people, setPeople] = useState<any[]>([]);
  const [hourly, setHourly] = useState(0);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", role: "", monthly_salary: "", monthly_hours: "160" });
  const [saving, setSaving] = useState(false);

  async function load() {
    const res = await fetch("/api/projects/people");
    const data = await res.json();
    setPeople(data.people ?? []);
    setHourly(data.hourly_cost ?? 0);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  async function add() {
    if (!form.name.trim()) return;
    setSaving(true);
    const res = await fetch("/api/projects/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        role: form.role,
        monthly_salary: Number(form.monthly_salary || 0),
        monthly_hours: Number(form.monthly_hours || 160),
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setForm({ name: "", role: "", monthly_salary: "", monthly_hours: "160" });
      await load();
    } else {
      alert(data.error ?? "erro");
    }
    setSaving(false);
  }

  async function remove(id: string) {
    await fetch(`/api/projects/people/${id}`, { method: "DELETE" });
    await load();
  }

  const fmt = (n: number) =>
    n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <section>
      <h2 className="text-sm uppercase tracking-widest text-ink-400 mb-4">
        // pessoas do projeto
      </h2>
      <div className="text-xs text-ink-400 mb-4 leading-relaxed">
        Cadastre quem atua no projeto. O custo/hora de cada pessoa ={" "}
        <span className="font-mono">salário ÷ horas/mês</span>, e o custo/hora do
        projeto (usado nos indicadores) é a média entre elas.
      </div>

      {loading ? (
        <div className="text-xs text-ink-400">carregando…</div>
      ) : (
        <>
          {people.length > 0 && (
            <div className="border border-ink-700 mb-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-ink-400 border-b border-ink-800">
                    <th className="text-left p-2">nome</th>
                    <th className="text-left p-2">cargo</th>
                    <th className="text-right p-2">salário/mês</th>
                    <th className="text-right p-2">horas/mês</th>
                    <th className="text-right p-2">custo/hora</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id} className="border-b border-ink-900">
                      <td className="p-2 text-ink-100">{p.name}</td>
                      <td className="p-2 text-ink-300">{p.role ?? "—"}</td>
                      <td className="p-2 text-right text-ink-300">R$ {fmt(Number(p.monthly_salary))}</td>
                      <td className="p-2 text-right text-ink-300">{Number(p.monthly_hours)}</td>
                      <td className="p-2 text-right text-development font-mono">
                        R$ {fmt(Number(p.monthly_salary) / Number(p.monthly_hours || 160))}
                      </td>
                      <td className="p-2 text-right">
                        <button onClick={() => remove(p.id)} className="text-qa hover:underline text-xs">
                          remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="border border-discovery/30 bg-discovery/5 px-3 py-2 mb-4 text-sm">
            custo/hora do projeto (média):{" "}
            <span className="text-discovery font-semibold font-mono">R$ {fmt(hourly)}</span>
            <span className="text-[11px] text-ink-400"> — aplicado automaticamente nos indicadores</span>
          </div>

          <div className="grid grid-cols-5 gap-2 items-end">
            <div>
              <label className="text-[11px] text-ink-400 block mb-1">nome</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none" />
            </div>
            <div>
              <label className="text-[11px] text-ink-400 block mb-1">cargo</label>
              <input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                placeholder="ex: Dev Sênior"
                className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none" />
            </div>
            <div>
              <label className="text-[11px] text-ink-400 block mb-1">salário/mês</label>
              <input type="number" value={form.monthly_salary} onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })}
                placeholder="11000"
                className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none" />
            </div>
            <div>
              <label className="text-[11px] text-ink-400 block mb-1">horas/mês</label>
              <input type="number" value={form.monthly_hours} onChange={(e) => setForm({ ...form, monthly_hours: e.target.value })}
                className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none" />
            </div>
            <button onClick={add} disabled={saving}
              className="bg-ink-100 text-ink-950 px-3 py-1.5 text-sm font-semibold hover:bg-ink-300 disabled:opacity-50">
              {saving ? "…" : "+ adicionar"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function KnowledgeSection() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState({ title: "", kind: "doc", location: "", notes: "" });
  const [onboarding, setOnboarding] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const res = await fetch("/api/projects/knowledge");
    const data = await res.json();
    setItems(data.knowledge ?? []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!form.title.trim()) return;
    const res = await fetch("/api/projects/knowledge", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) { setForm({ title: "", kind: "doc", location: "", notes: "" }); load(); }
  }
  async function remove(id: string) {
    await fetch(`/api/projects/knowledge/${id}`, { method: "DELETE" });
    load();
  }
  async function onboard() {
    setOnboarding(true); setMsg("");
    const res = await fetch("/api/projects/onboard", { method: "POST" });
    const data = await res.json();
    setMsg(res.ok ? "agente de onboarding disparado — acompanhe o PR de instruções no GitHub." : `erro: ${data.error}`);
    setOnboarding(false);
  }

  return (
    <section>
      <h2 className="text-sm uppercase tracking-widest text-ink-400 mb-4">// conhecimento & instruções</h2>
      <div className="text-xs text-ink-400 mb-4 leading-relaxed">
        Documentos, runbooks, ADRs, convenções e links que os agentes devem
        consultar. Esse contexto é injetado nos kickoffs. Para aplicações
        existentes, use “mapear repositório” para o agente gerar as instruções a
        partir do código.
      </div>

      <button
        onClick={onboard}
        disabled={onboarding}
        className="mb-4 border border-development text-development px-3 py-1.5 text-xs hover:bg-development/10 disabled:opacity-50"
      >
        {onboarding ? "disparando agente…" : "🔍 mapear repositório e gerar instruções (app existente)"}
      </button>
      {msg && <div className="text-[11px] text-ink-300 mb-3 font-mono">{msg}</div>}

      {items.length > 0 && (
        <div className="space-y-1 mb-3">
          {items.map((k) => (
            <div key={k.id} className="border border-ink-700 bg-ink-900/40 px-3 py-2 flex items-center gap-2 text-sm">
              <span className="text-[9px] uppercase text-development border border-development/40 px-1 py-0.5">{k.kind}</span>
              <span className="text-ink-100">{k.title}</span>
              {k.location && <span className="text-[11px] text-ink-400 font-mono">{k.location}</span>}
              <button onClick={() => remove(k.id)} className="ml-auto text-qa hover:underline text-xs">remover</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-4 gap-2 items-end">
        <SimpleField label="título" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="ex: Arquitetura do serviço" />
        <div>
          <label className="text-[11px] text-ink-400 block mb-1">tipo</label>
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none">
            <option value="doc">doc</option>
            <option value="runbook">runbook</option>
            <option value="adr">ADR</option>
            <option value="convention">convenção</option>
            <option value="api">API</option>
            <option value="link">link</option>
          </select>
        </div>
        <SimpleField label="caminho ou URL" value={form.location} onChange={(v) => setForm({ ...form, location: v })} placeholder="docs/arch.md ou https://…" />
        <button onClick={add} className="bg-ink-100 text-ink-950 px-3 py-1.5 text-sm font-semibold hover:bg-ink-300">+ adicionar</button>
      </div>
    </section>
  );
}

function DreamingSection() {
  const [learnings, setLearnings] = useState<any[]>([]);
  const [content, setContent] = useState("");
  const [dreaming, setDreaming] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const res = await fetch("/api/projects/dreaming");
    const data = await res.json();
    setLearnings(data.learnings ?? []);
  }
  useEffect(() => { load(); }, []);

  async function addLearning() {
    if (!content.trim()) return;
    await fetch("/api/projects/dreaming", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", content }),
    });
    setContent(""); load();
  }
  async function dream() {
    setDreaming(true); setMsg("");
    const res = await fetch("/api/projects/dreaming", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    const data = await res.json();
    setMsg(res.ok ? "Dreaming disparado — o agente vai consolidar os aprendizados nas instruções e abrir um PR." : `erro: ${data.error}`);
    setDreaming(false);
    load();
  }

  const pending = learnings.filter((l) => !l.applied_at);

  return (
    <section>
      <h2 className="text-sm uppercase tracking-widest text-ink-400 mb-4">// dreaming (evolução contínua)</h2>
      <div className="text-xs text-ink-400 mb-4 leading-relaxed">
        Aprendizados acumulados do projeto (decisões, padrões, armadilhas). O
        “Dreaming” consolida esses aprendizados no arquivo de instruções, fazendo
        os agentes ficarem mais inteligentes a cada ciclo.
      </div>

      <div className="flex gap-2 mb-4">
        <input value={content} onChange={(e) => setContent(e.target.value)}
          placeholder="registrar um aprendizado (ex: 'sempre validar CPF na camada de domínio')"
          className="flex-1 bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none" />
        <button onClick={addLearning} className="bg-ink-100 text-ink-950 px-3 py-1.5 text-sm font-semibold hover:bg-ink-300">+ registrar</button>
        <button onClick={dream} disabled={dreaming}
          className="bg-planning text-ink-950 px-4 py-1.5 text-sm font-semibold hover:bg-planning/80 disabled:opacity-50">
          {dreaming ? "sonhando…" : "💭 consolidar (dreaming)"}
        </button>
      </div>
      {msg && <div className="text-[11px] text-ink-300 mb-3 font-mono">{msg}</div>}

      {learnings.length === 0 ? (
        <div className="text-xs text-ink-400 italic">nenhum aprendizado ainda. Registre acima ou deixe o Dreaming inferir do repositório.</div>
      ) : (
        <div className="space-y-1">
          <div className="text-[11px] text-ink-400">{pending.length} pendente(s) de consolidação</div>
          {learnings.map((l) => (
            <div key={l.id} className={`border px-3 py-2 text-sm ${l.applied_at ? "border-ink-800 text-ink-400" : "border-ink-700 text-ink-100"}`}>
              <span className="text-[9px] uppercase border border-ink-600 px-1 py-0.5 mr-2">{l.kind}</span>
              {l.content}
              {l.applied_at && <span className="text-[10px] text-qa ml-2">✓ consolidado</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectsSection({ configuringId }: { configuringId?: boolean }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    sigla: "",
    github_repo: "",
    default_base_branch: "main",
    app_type: "new",
    app_kind: "app",
    tech_stack: "",
    instructions_path: "CLAUDE.md",
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
    window.location.href = `/settings?config=${data.project.id}`;
  }

  async function activate(id: string) {
    await fetch("/api/projects/active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: id }),
    });
    window.location.href = `/settings?config=${id}`;
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm uppercase tracking-widest text-ink-400">
          // times
        </h2>
        <button
          onClick={() => setCreating(!creating)}
          className="bg-ink-100 text-ink-950 px-3 py-1.5 text-xs font-semibold hover:bg-ink-300 transition-colors"
        >
          {creating ? "fechar" : "+ novo time"}
        </button>
      </div>

      <div className="text-xs text-ink-400 mb-4 leading-relaxed">
        Clique em <strong>configurar</strong> num time para abrir todas as suas
        configurações (aplicações, ambientes, pessoas, custos, conhecimento,
        agentes, workflow, gates e notificações). Cada time é independente; o
        seletor do board alterna entre eles.
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

          <div className="border-t border-ink-800 pt-3">
            <div className="text-[11px] uppercase tracking-widest text-ink-400 mb-2">
              tipo de aplicação
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-ink-400 block mb-1">é nova ou existente?</label>
                <select
                  value={form.app_type}
                  onChange={(e) => setForm({ ...form, app_type: e.target.value })}
                  className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
                >
                  <option value="new">Nova (greenfield)</option>
                  <option value="existing">Existente (legado)</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-ink-400 block mb-1">natureza</label>
                <select
                  value={form.app_kind}
                  onChange={(e) => setForm({ ...form, app_kind: e.target.value })}
                  className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
                >
                  <option value="app">Aplicação / Web app</option>
                  <option value="microservice">Microsserviço</option>
                  <option value="monolith">Monólito</option>
                  <option value="library">Biblioteca / SDK</option>
                  <option value="other">Outro</option>
                </select>
              </div>
              <SimpleField
                label="stack (tecnologias)"
                value={form.tech_stack}
                onChange={(v) => setForm({ ...form, tech_stack: v })}
                placeholder="ex: Java Spring, Postgres, Kafka"
              />
              <SimpleField
                label="arquivo de instruções"
                value={form.instructions_path}
                onChange={(v) => setForm({ ...form, instructions_path: v })}
                placeholder="CLAUDE.md"
              />
            </div>
            {form.app_type === "existing" ? (
              <div className="text-[10px] text-development mt-2 leading-relaxed">
                aplicação existente: depois de criar, use “mapear repositório” na
                seção de conhecimento para o agente ler o código e gerar as
                instruções, e cadastre os documentos/runbooks que já existem.
              </div>
            ) : (
              <div className="text-[10px] text-ink-400 mt-2 leading-relaxed">
                aplicação nova: os agentes vão criar o arquivo de instruções no
                repositório conforme constroem, e o Dreaming mantém vivo.
              </div>
            )}
          </div>

          {error && (
            <div className="text-xs text-qa font-mono">{error}</div>
          )}
          <div className="text-[10px] text-ink-400">
            ao criar, os 7 agentes builtin são semeados e deployados
            automaticamente neste time.
          </div>
          <button
            onClick={createProject}
            disabled={saving}
            className="bg-discovery text-ink-950 px-4 py-1.5 text-sm font-semibold hover:bg-discovery/80 disabled:opacity-50"
          >
            {saving ? "criando time + deployando agentes..." : "criar time"}
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-xs text-ink-400">carregando times...</div>
      ) : projects.length === 0 ? (
        <div className="text-xs text-ink-400 italic border border-dashed border-ink-800 p-4">
          nenhum time ainda. Crie o primeiro acima.
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
              <button
                onClick={() => activate(p.id)}
                className="text-xs text-development hover:underline px-2 uppercase tracking-widest"
              >
                {p.id === activeId && configuringId ? "configurando" : "configurar →"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReposManager() {
  const [repos, setRepos] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRepo, setNewRepo] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newDeps, setNewDeps] = useState("");
  const [newAppType, setNewAppType] = useState("new");
  const [newStack, setNewStack] = useState("");
  const [newInstr, setNewInstr] = useState("CLAUDE.md");
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
      body: JSON.stringify({
        github_repo: newRepo.trim(),
        label: newLabel.trim(),
        description: newDesc.trim(),
        depends_on: newDeps.trim(),
        app_type: newAppType,
        tech_stack: newStack.trim(),
        instructions_path: newInstr.trim() || "CLAUDE.md",
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? `HTTP ${res.status}`);
    } else {
      setNewRepo("");
      setNewLabel("");
      setNewDesc("");
      setNewDeps("");
      await load();
    }
    setAdding(false);
  }

  async function removeRepo(id: string) {
    if (!confirm("remover esta aplicação do time?")) return;
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
        // aplicações do time ({repos.length})
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
              nenhuma aplicação ainda
            </div>
          )}
          {repos.map((r) => (
            <div
              key={r.id}
              className="border border-ink-700 bg-ink-900/40 p-3"
            >
              <div className="flex items-center justify-between">
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
                    {r.app_type === "existing" ? " · existente" : " · nova"}
                    {r.tech_stack ? ` · ${r.tech_stack}` : ""}
                  </span>
                </div>
                <button
                  onClick={() => removeRepo(r.id)}
                  className="text-xs text-qa hover:underline px-2"
                >
                  remover
                </button>
              </div>
              <AppEnvironments repositoryId={r.id} baseBranch={r.default_base_branch} />
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
        <div className="flex-1 min-w-[150px]">
          <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">
            papel (opcional)
          </label>
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="ex: serviço de pagamentos"
            className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
          />
        </div>
        <div className="flex-1 min-w-[150px]">
          <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">
            depende de (opcional)
          </label>
          <input
            type="text"
            value={newDeps}
            onChange={(e) => setNewDeps(e.target.value)}
            placeholder="ex: API, Auth"
            className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
          />
        </div>
        <div className="min-w-[130px]">
          <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">
            tipo
          </label>
          <select
            value={newAppType}
            onChange={(e) => setNewAppType(e.target.value)}
            className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
          >
            <option value="new">Nova</option>
            <option value="existing">Existente</option>
          </select>
        </div>
        <div className="flex-1 min-w-[150px]">
          <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">
            stack
          </label>
          <input
            type="text"
            value={newStack}
            onChange={(e) => setNewStack(e.target.value)}
            placeholder="ex: Java Spring, Postgres"
            className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
          />
        </div>
        <div className="min-w-[130px]">
          <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">
            instruções
          </label>
          <input
            type="text"
            value={newInstr}
            onChange={(e) => setNewInstr(e.target.value)}
            placeholder="CLAUDE.md"
            className="w-full bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
          />
        </div>
        <button
          onClick={addRepo}
          disabled={adding || !newRepo.trim()}
          className="bg-development text-ink-950 px-3 py-1.5 text-sm font-semibold hover:bg-development/80 disabled:opacity-50"
        >
          {adding ? "..." : "+ adicionar aplicação"}
        </button>
      </div>
      <div className="text-[10px] text-ink-400 mt-2">
        cada aplicação carrega sua própria config (tipo nova/existente, stack,
        arquivo de instruções) e suas dependências. “depende de” declara a ordem
        entre aplicações — os agentes implementam as dependidas primeiro.
      </div>
      {error && <div className="text-xs text-qa font-mono mt-2">{error}</div>}
    </div>
  );
}

function ClaudeCodeSection() {
  const [token, setToken] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState("");

  async function load() {
    const res = await fetch("/api/mcp-token");
    const data = await res.json();
    setHasToken(data.has_token);
    setToken(data.token ?? null);
    setLoading(false);
  }
  useEffect(() => {
    setOrigin(window.location.origin);
    load();
  }, []);

  async function generate() {
    const res = await fetch("/api/mcp-token", { method: "POST" });
    const data = await res.json();
    if (data.token) {
      setToken(data.token);
      setHasToken(true);
    }
  }
  async function revoke() {
    await fetch("/api/mcp-token", { method: "DELETE" });
    setToken(null);
    setHasToken(false);
  }

  const url = `${origin}/api/mcp/mcp`;
  const cmd = `claude mcp add --transport http squad ${url} --header "Authorization: Bearer ${token ?? "SEU_TOKEN"}"`;

  return (
    <section>
      <h2 className="text-sm uppercase tracking-widest text-ink-400 mb-4">
        // conector claude code (fase 1 — leitura)
      </h2>
      <div className="text-xs text-ink-400 mb-4 leading-relaxed">
        Trabalhe no Claude Code com todo o harness e puxe o contexto dos cards da
        Squad. Nesta fase é só leitura: as tools{" "}
        <span className="font-mono text-ink-200">squad_list_cards</span> e{" "}
        <span className="font-mono text-ink-200">squad_get_context</span> trazem
        cards, instruções do projeto, critérios e ADR para a sua sessão. A
        submissão e o avanço de etapas continuam pela Squad.
      </div>

      {loading ? (
        <div className="text-xs text-ink-400">carregando…</div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {hasToken ? (
              <>
                <span className="text-xs text-qa">● token ativo</span>
                <button onClick={generate} className="text-xs text-development hover:underline">
                  regenerar
                </button>
                <button onClick={revoke} className="text-xs text-qa hover:underline">
                  revogar
                </button>
              </>
            ) : (
              <button
                onClick={generate}
                className="bg-ink-100 text-ink-950 px-3 py-1.5 text-sm font-semibold hover:bg-ink-300"
              >
                gerar token de acesso
              </button>
            )}
          </div>

          {token && (
            <div className="border border-planning/40 bg-planning/5 p-2 text-[11px] text-planning font-mono break-all">
              {token}
              <div className="text-ink-400 mt-1">
                copie agora — guarde em local seguro. Trate como uma senha.
              </div>
            </div>
          )}

          <div>
            <div className="text-[11px] text-ink-400 mb-1">
              1 · conecte o conector no seu Claude Code:
            </div>
            <pre className="border border-ink-700 bg-ink-950 p-2 text-[11px] text-ink-100 font-mono overflow-x-auto whitespace-pre-wrap break-all">
{cmd}
            </pre>
          </div>
          <div className="text-[11px] text-ink-400 leading-relaxed">
            2 · no Claude Code, rode{" "}
            <span className="font-mono text-ink-200">/mcp__squad__squad_list_cards</span>{" "}
            para ver os cards, e{" "}
            <span className="font-mono text-ink-200">
              /mcp__squad__squad_get_context
            </span>{" "}
            com o slug ou card_id para puxar todo o contexto.
          </div>
        </div>
      )}
    </section>
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
