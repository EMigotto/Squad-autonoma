"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Weekly {
  week: string;
  cycle_days: number;
  coverage: number;
  cost: number;
  first_pass_rate: number;
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
  const [loading, setLoading] = useState(true);

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
    const res = await fetch(`/api/dashboard?${qs.toString()}`);
    const data = await res.json();
    setSummary(data.summary);
    setWeekly(data.weekly ?? []);
    setLoading(false);
  }, [scope, teamId, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100 p-6">
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
          <Link
            href="/"
            className="text-xs uppercase tracking-widest text-ink-300 hover:text-ink-100"
          >
            ← voltar ao board
          </Link>
        </div>

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
              <Kpi label="Custo médio / feature" value={`${summary.avg_cost}`} unit="" tone="text-discovery" />
            </div>
            <div className="text-[11px] text-ink-400">
              {summary.done_cards} de {summary.total_cards} cards concluídos nesta visão
            </div>

            {/* EVOLUÇÃO SEMANAL */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <ChartCard title="Cycle time (dias) — semana a semana">
                <LineChart data={weekly.map((w) => ({ x: w.week, y: w.cycle_days }))} color="#4F9DF7" />
              </ChartCard>
              <ChartCard title="Taxa de aprovação na 1ª (%)">
                <LineChart data={weekly.map((w) => ({ x: w.week, y: w.first_pass_rate }))} color="#5BD17B" max={100} />
              </ChartCard>
              <ChartCard title="Cobertura de testes (%)">
                <LineChart data={weekly.map((w) => ({ x: w.week, y: w.coverage }))} color="#C792EA" max={100} />
              </ChartCard>
              <ChartCard title="Custo médio por feature">
                <LineChart data={weekly.map((w) => ({ x: w.week, y: w.cost }))} color="#F78C6C" />
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
}: {
  data: { x: string; y: number }[];
  color: string;
  max?: number;
}) {
  const W = 480, H = 180, pad = 30;
  if (data.length === 0)
    return <div className="text-xs text-ink-500 italic">sem dados</div>;

  const ys = data.map((d) => d.y);
  const maxY = max ?? Math.max(1, ...ys) * 1.15;
  const minY = 0;
  const n = data.length;
  const xStep = n > 1 ? (W - pad * 2) / (n - 1) : 0;
  const scaleY = (v: number) => H - pad - ((v - minY) / (maxY - minY)) * (H - pad * 2);
  const px = (i: number) => pad + i * xStep;

  const pts = data.map((d, i) => `${px(i)},${scaleY(d.y)}`).join(" ");
  const area = `${pad},${H - pad} ${pts} ${px(n - 1)},${H - pad}`;

  // gridlines (0, 50%, 100% do maxY)
  const grid = [0, 0.5, 1].map((f) => ({ y: scaleY(maxY * f), v: Math.round(maxY * f) }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 200 }}>
      {grid.map((g, i) => (
        <g key={i}>
          <line x1={pad} y1={g.y} x2={W - pad} y2={g.y} stroke="#1f2d38" strokeWidth="1" />
          <text x={pad - 6} y={g.y + 3} textAnchor="end" fontSize="9" fill="#5C7080">
            {g.v}
          </text>
        </g>
      ))}
      {n > 1 && <polygon points={area} fill={color} opacity="0.12" />}
      {n > 1 && <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" />}
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={px(i)} cy={scaleY(d.y)} r="3.5" fill={color} />
          <text x={px(i)} y={scaleY(d.y) - 8} textAnchor="middle" fontSize="9" fill="#9FB8C6">
            {d.y}
          </text>
          <text x={px(i)} y={H - pad + 14} textAnchor="middle" fontSize="8" fill="#5C7080">
            {d.x.replace(/^\d{4}-/, "")}
          </text>
        </g>
      ))}
    </svg>
  );
}
