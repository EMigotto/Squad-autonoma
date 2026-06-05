"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import AssistantFAB from "@/components/AssistantFAB";

interface Weekly {
  week: string;
  cycle_days: number;
  coverage: number;
  cost: number;
  first_pass_rate: number;
  manual_cycle_days?: number;
  manual_cost?: number;
  saving?: number;
  cum_cycle_days?: number;
  cum_cost?: number;
  cum_manual_cycle_days?: number;
  cum_manual_cost?: number;
  cum_saving?: number;
}
interface Summary {
  total_cards: number;
  done_cards: number;
  avg_cycle_days: number;
  first_pass_rate: number;
  avg_coverage: number;
  avg_cost: number;
}

export default function DashboardsPage() {
  const [scope, setScope] = useState<"all" | "team" | "project">("all");
  const [projects, setProjects] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [teamId, setTeamId] = useState<string>("");
  const [projectId, setProjectId] = useState<string>("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [weekly, setWeekly] = useState<Weekly[]>([]);
  const [roi, setRoi] = useState<any | null>(null);
  const [roiWeekly, setRoiWeekly] = useState<{ week: string; saving: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [granularity, setGranularity] = useState<"week" | "day">("week");

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => {
        setProjects(d.projects ?? []);
        const ts = new Map<string, string>();
        for (const p of d.projects ?? []) {
          if (p.team?.id) ts.set(p.team.id, p.team.name);
        }
        setTeams(Array.from(ts, ([id, name]) => ({ id, name })));
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ scope });
    if (scope === "team" && teamId) qs.set("team_id", teamId);
    if (scope === "project" && projectId) qs.set("project_id", projectId);
    qs.set("granularity", granularity);
    const res = await fetch(`/api/dashboard?${qs.toString()}`);
    const data = await res.json();
    setSummary(data.summary);
    setWeekly(data.weekly ?? []);
    setRoi(data.roi ?? null);
    setRoiWeekly(data.roiWeekly ?? []);
    setLoading(false);
  }, [scope, teamId, projectId, granularity]);

  const [backfilling, setBackfilling] = useState(false);
  const [backfillMsg, setBackfillMsg] = useState("");
  async function backfillLoc() {
    if (backfilling) return;
    setBackfilling(true);
    setBackfillMsg("medindo linhas de código no GitHub… pode levar um pouco.");
    const qs = new URLSearchParams({ scope });
    if (scope === "team" && teamId) qs.set("team_id", teamId);
    if (scope === "project" && projectId) qs.set("project_id", projectId);
    try {
      const res = await fetch(`/api/dashboard/backfill-loc?${qs.toString()}`, { method: "POST" });
      const j = await res.json();
      if (res.ok) {
        setBackfillMsg(
          `pronto: ${j.updated} de ${j.candidates} feature(s) medidas (${j.total_loc_measured.toLocaleString("pt-BR")} LOC). Atualizando…`
        );
        await load();
      } else {
        setBackfillMsg(`erro: ${j.error ?? res.status}`);
      }
    } catch (e) {
      setBackfillMsg("erro ao recalcular: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBackfilling(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100 p-6">
      <AssistantFAB />
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-ink-400 mb-2">
              // indicadores
            </div>
            <h1 className="text-xl font-semibold">
              Dashboards<span className="text-discovery">.</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/assistant"
              className="text-xs uppercase tracking-widest text-ink-950 bg-discovery hover:bg-discovery/80 px-3 py-1.5 font-semibold flex items-center gap-1.5"
              title="abrir Squad Assistant"
            >
              <span className="text-base leading-none">◈</span>
              assistente
            </Link>
            <Link
              href="/"
              className="text-xs uppercase tracking-widest text-ink-300 hover:text-ink-100"
            >
              ← voltar ao board
            </Link>
          </div>
        </div>

        {/* BANNER ASSISTENTE */}
        <Link
          href="/assistant"
          className="block border border-discovery/40 bg-discovery/5 hover:bg-discovery/10 px-4 py-3 transition-colors"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl text-discovery">◈</span>
            <div className="flex-1">
              <div className="text-sm font-semibold text-ink-100">Squad Assistant</div>
              <div className="text-[11px] text-ink-400">
                pergunte ao vivo o que está rodando, qual agente está
                processando, tempo restante e gastos — modelo selecionável (Haiku/Sonnet/Opus)
              </div>
            </div>
            <span className="text-xs text-discovery uppercase tracking-widest">abrir →</span>
          </div>
        </Link>

        {/* FILTROS */}
        <div className="flex flex-wrap items-end gap-3 border border-ink-700 bg-ink-900/40 p-4">
          <div>
            <label className="text-[11px] text-ink-400 block mb-1">visão</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as any)}
              className="bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
            >
              <option value="all">Geral (todos)</option>
              <option value="team">Por time</option>
              <option value="project">Por projeto</option>
            </select>
          </div>
          {scope === "team" && (
            <div>
              <label className="text-[11px] text-ink-400 block mb-1">time</label>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
              >
                <option value="">selecione…</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {scope === "project" && (
            <div>
              <label className="text-[11px] text-ink-400 block mb-1">projeto</label>
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="bg-ink-900 border border-ink-700 px-2 py-1.5 text-sm focus:border-discovery focus:outline-none"
              >
                <option value="">selecione…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.sigla}] {p.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {loading ? (
          <div className="text-sm text-ink-400">carregando indicadores…</div>
        ) : !summary || summary.total_cards === 0 ? (
          <div className="text-sm text-ink-400 italic border border-dashed border-ink-800 p-8 text-center">
            ainda não há dados de indicadores para esta visão. Conforme os cards
            avançam pelos gates, as métricas aparecem aqui.
          </div>
        ) : (
          <>
            {/* KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi label="Cycle time médio" value={`${summary.avg_cycle_days}`} unit="dias" tone="text-development" />
              <Kpi label="Aprovação na 1ª" value={`${summary.first_pass_rate}`} unit="%" tone="text-qa" />
              <Kpi label="Cobertura média" value={`${summary.avg_coverage}`} unit="%" tone="text-planning" />
              <Kpi label="Custo médio / feature" value={`R$ ${Number(summary.avg_cost ?? 0).toFixed(2)}`} unit="" tone="text-discovery" />
            </div>
            <div className="text-[11px] text-ink-400">
              {summary.done_cards} de {summary.total_cards} cards concluídos nesta visão
            </div>

            {/* Recalcular LOC do histórico (popular ROI retroativo) */}
            <div className="mt-3 flex items-center gap-3 flex-wrap">
              <button
                onClick={backfillLoc}
                disabled={backfilling}
                className="bg-qa text-ink-950 px-3 py-1.5 text-xs font-semibold hover:bg-qa/80 disabled:opacity-50"
              >
                {backfilling ? "recalculando…" : "↻ recalcular LOC do histórico (ROI retroativo)"}
              </button>
              {backfillMsg && <span className="text-[11px] text-ink-400">{backfillMsg}</span>}
              {(!roi || roi.features_considered === 0) && !backfillMsg && (
                <span className="text-[11px] text-ink-400">
                  a seção de ROI aparece após medir as linhas de código das features concluídas — clique para medir o histórico.
                </span>
              )}
            </div>

            {/* ROI / ECONOMIA */}
            {roi && roi.features_considered > 0 && (
              <div className="mt-6 mb-8 border border-qa/30 bg-qa/5 p-4">
                <div className="text-xs uppercase tracking-widest text-qa mb-3 font-mono">
                  // roi &amp; economia vs. desenvolvimento humano
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <Kpi label="Dias economizados" value={`${roi.days_saved}`} unit="dias" tone="text-development" />
                  <Kpi label="Economia (saving)" value={`R$ ${roi.savings_money.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} unit="" tone="text-qa" />
                  <Kpi label="Baseline humano" value={`R$ ${roi.baseline_cost_total.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`} unit="" tone="text-planning" />
                  <Kpi label="Custo do squad" value={`R$ ${roi.actual_cost_total.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`} unit="" tone="text-discovery" />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="text-xs text-ink-300 leading-relaxed">
                    Sobre <strong>{roi.features_considered}</strong> feature(s) concluída(s)
                    {roi.via_loc > 0 && (
                      <> — <strong>{roi.via_loc}</strong> medida(s) por LOC ({roi.loc_total.toLocaleString("pt-BR")} linhas)</>
                    )}
                    {roi.via_complexity > 0 && (
                      <> {roi.via_loc > 0 ? "e" : "—"} <strong>{roi.via_complexity}</strong> por complexidade (S/M/L/XL)</>
                    )}
                    : um time humano levaria <strong>~{roi.baseline_days_total} dias-dev</strong>; o squad
                    entregou em <strong>~{roi.cycle_days_total} dias</strong> de cycle time — saving de{" "}
                    <strong className="text-qa">{roi.savings_pct}%</strong> no custo.
                    <div className="mt-2 text-[10px] text-ink-500">
                      Premissas em Settings → custos → "ROI · baseline humano": LOC/dev-dia, horas/dia,
                      custo/hora e horas por tamanho (S/M/L/XL). Features sem LOC usam a complexidade (tag
                      da feature ou o tamanho padrão). Baseline = esforço ÷ produtividade; dias-dev são úteis,
                      cycle time é calendário.
                    </div>
                  </div>
                  <ChartCard title="Saving ACUMULADO (R$) — running sum">
                    <LineChart data={roiWeekly.map((w) => ({ x: w.week, y: w.saving }))} color="#1a8a4a" prefix="R$ " />
                    <div className="text-[9px] text-ink-500 mt-1 font-mono leading-snug">
                      cada ponto = soma de TODO saving até essa data. linha sempre sobe (nunca cai com nova feature).
                    </div>
                  </ChartCard>
                </div>
              </div>
            )}

            {/* GRANULARIDADE */}
            <div className="mt-6 mb-2 flex items-center gap-2 text-[11px]">
              <span className="uppercase tracking-wider text-ink-400 font-mono">// granularidade</span>
              {(["week", "day"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`px-3 py-1 border font-mono ${
                    granularity === g ? "border-ink-100 text-ink-100" : "border-ink-700 text-ink-400 hover:text-ink-100"
                  }`}
                >
                  {g === "week" ? "por semana" : "por dia"}
                </button>
              ))}
              <span className="text-[10px] text-ink-500 ml-2">
                gráficos abaixo usam <strong>média acumulada</strong> — estabilizam com mais dados, nunca caem por entrada de feature menor
              </span>
            </div>

            {/* EVOLUÇÃO POR PERÍODO — comparativo manual × squad (CUMULATIVO) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <ChartCard title="Cycle time — squad vs. manual (média acumulada, dias)">
                <LineChart
                  data={weekly.map((w) => ({ x: w.week, y: w.cum_cycle_days ?? w.cycle_days }))}
                  color="#0086b8"
                  compare={weekly.map((w) => ({ x: w.week, y: w.cum_manual_cycle_days ?? w.manual_cycle_days ?? 0 }))}
                  compareColor="#a8730a"
                  mainLabel="squad (vibe coding)"
                  compareLabel="manual (estimado)"
                />
                <div className="text-[9px] text-ink-500 mt-1 font-mono leading-snug">
                  média acumulada de TODAS as features concluídas até a data. quanto mais dados, mais estável. squad ↓ manual = comparação direta.
                </div>
              </ChartCard>
              <ChartCard title="Taxa de aprovação na 1ª (%)">
                <LineChart data={weekly.map((w) => ({ x: w.week, y: w.first_pass_rate }))} color="#5BD17B" max={100} />
                <div className="text-[9px] text-ink-500 mt-1 font-mono leading-snug">
                  % de etapas aprovadas na 1ª tentativa em cada período. alto = qualidade da entrega do agente.
                </div>
              </ChartCard>
              <ChartCard title="Cobertura de testes (%)">
                <LineChart data={weekly.map((w) => ({ x: w.week, y: w.coverage }))} color="#C792EA" max={100} />
                <div className="text-[9px] text-ink-500 mt-1 font-mono leading-snug">
                  cobertura média do período. extraída do qa-report.md das features concluídas — se aparece 0 é porque o artefato não trouxe a métrica.
                </div>
              </ChartCard>
              <ChartCard title="Custo médio por feature — squad vs. manual (acumulado)">
                <LineChart
                  data={weekly.map((w) => ({ x: w.week, y: w.cum_cost ?? w.cost }))}
                  color="#7c3aed"
                  compare={weekly.map((w) => ({ x: w.week, y: w.cum_manual_cost ?? w.manual_cost ?? 0 }))}
                  compareColor="#a8730a"
                  prefix="R$ "
                  mainLabel="squad (vibe coding)"
                  compareLabel="manual (estimado)"
                />
                <div className="text-[9px] text-ink-500 mt-1 font-mono leading-snug">
                  R$ médio acumulado por feature. squad inclui tokens + (cycle × time × R$/hora). manual = esforço × time × R$/hora.
                </div>
              </ChartCard>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, unit, tone }: { label: string; value: string; unit: string; tone: string }) {
  return (
    <div className="border border-ink-700 bg-ink-900/40 p-4">
      <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-2">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className={`text-3xl font-semibold ${tone}`}>{value}</span>
        {unit && <span className="text-sm text-ink-400">{unit}</span>}
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-ink-700 bg-ink-900/40 p-4">
      <div className="text-xs uppercase tracking-wider text-ink-400 mb-3">{title}</div>
      {children}
    </div>
  );
}

/** Gráfico de linha SVG simples, responsivo via viewBox. */
function LineChart({
  data,
  color,
  max,
  prefix = "",
  compare,
  compareColor = "#a8730a",
  compareLabel,
  mainLabel,
}: {
  data: { x: string; y: number }[];
  color: string;
  max?: number;
  prefix?: string;
  compare?: { x: string; y: number }[];
  compareColor?: string;
  compareLabel?: string;
  mainLabel?: string;
}) {
  const W = 480, H = 180, pad = 30;
  if (data.length === 0)
    return <div className="text-xs text-ink-500 italic">sem dados</div>;

  const ys = data.map((d) => d.y);
  const cys = (compare ?? []).map((d) => d.y);
  const maxY = max ?? Math.max(1, ...ys, ...cys) * 1.15;
  const minY = 0;
  const n = data.length;
  const xStep = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  const scaleY = (v: number) => H - pad - ((v - minY) / (maxY - minY)) * (H - pad * 2);
  const px = (i: number) => pad + i * xStep;

  const pts = data.map((d, i) => `${px(i)},${scaleY(d.y)}`).join(" ");
  const area = `${pad},${H - pad} ${pts} ${px(n - 1)},${H - pad}`;
  const cmpPts = (compare ?? []).slice(0, n).map((d, i) => `${px(i)},${scaleY(d.y)}`).join(" ");

  const grid = [0, 0.5, 1].map((f) => ({ y: scaleY(maxY * f), v: Math.round(maxY * f) }));

  return (
    <div>
      {(mainLabel || compareLabel) && (
        <div className="flex gap-3 text-[10px] mb-1 font-mono">
          {mainLabel && <span style={{ color }}>● {mainLabel}</span>}
          {compareLabel && <span style={{ color: compareColor }}>● {compareLabel}</span>}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
        {grid.map((g, i) => (
          <g key={i}>
            <line x1={pad} y1={g.y} x2={W - pad} y2={g.y} stroke="#e4eaef" strokeWidth="1" />
            <text x={pad - 6} y={g.y + 3} textAnchor="end" fontSize="9" fill="#67757f">
              {prefix}{g.v.toLocaleString("pt-BR")}
            </text>
          </g>
        ))}
        {compare && compare.length > 1 && (
          <polyline points={cmpPts} fill="none" stroke={compareColor} strokeWidth="2.5" strokeDasharray="4 3" />
        )}
        {compare && compare.map((d, i) => (
          i < n ? <circle key={`cmp-${i}`} cx={px(i)} cy={scaleY(d.y)} r="3" fill={compareColor} /> : null
        ))}
        {n > 1 && <polygon points={area} fill={color} opacity="0.12" />}
        {n > 1 && <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" />}
        {data.map((d, i) => (
          <g key={i}>
            <circle cx={px(i)} cy={scaleY(d.y)} r="3.5" fill={color} />
            <text x={px(i)} y={scaleY(d.y) - 8} textAnchor="middle" fontSize="9" fill="#67757f">
              {prefix}{d.y.toLocaleString("pt-BR")}
            </text>
            <text x={px(i)} y={H - pad + 14} textAnchor="middle" fontSize="8" fill="#67757f">
              {d.x.replace(/^\d{4}-/, "")}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
