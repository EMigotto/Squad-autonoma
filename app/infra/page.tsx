"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * INFRAESTRUTURA — visão IDP (Internal Developer Platform) adaptada do
 * protótipo ORBIT. Mostra: (1) conexão com o MCP de DevOps (provido pelo time
 * de infraestrutura — quando plugado, o provisionamento vira ação real),
 * (2) o catálogo de capacidades provisionáveis, e (3) as necessidades de
 * infra previstas por feature (extraídas do infrastructure.md gerado na
 * conclusão de cada feature).
 */

const CATALOG = [
  { ic: "🐘", t: "PostgreSQL", d: "Banco relacional gerenciado · schemas e usuários por app", tag: "dados" },
  { ic: "⚡", t: "Redis", d: "Cache e sessões · TTL e eviction configuráveis", tag: "dados" },
  { ic: "🪣", t: "Object Storage (S3)", d: "Buckets versionados · políticas de acesso por app", tag: "dados" },
  { ic: "📨", t: "Filas & Mensageria", d: "Kafka / SQS · tópicos, DLQs e contratos de evento", tag: "integração" },
  { ic: "🔐", t: "Secrets & Vault", d: "Segredos por ambiente · rotação e acesso auditado", tag: "segurança" },
  { ic: "🌐", t: "DNS & Certificados", d: "Domínios, TLS automático e roteamento", tag: "rede" },
  { ic: "📈", t: "Observabilidade", d: "Logs, métricas e tracing · dashboards por app", tag: "operação" },
  { ic: "🚀", t: "Compute / Deploy", d: "Containers e runtimes · escala e health-checks", tag: "operação" },
];

export default function InfraPage() {
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpToken, setMcpToken] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [features, setFeatures] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const d = await res.json();
          setMcpUrl(d.settings?.infra_mcp_url ?? "");
          setMcpToken(d.settings?.infra_mcp_token ?? "");
        }
        const fres = await fetch("/api/infra/features");
        if (fres.ok) {
          const fd = await fres.json();
          setFeatures(fd.features ?? []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function saveMcp() {
    setSavedMsg("");
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ infra_mcp_url: mcpUrl, infra_mcp_token: mcpToken }),
    });
    setSavedMsg(res.ok ? "configuração salva ✓" : "erro ao salvar");
  }

  const connected = !!mcpUrl;

  return (
    <main className="min-h-screen max-w-[1180px] mx-auto px-7 pb-20">
      <header className="pt-12 pb-2">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="font-mono text-[11px] tracking-[.16em] uppercase text-ink-400">
            plataforma · infraestrutura
          </span>
          <span className="h-px flex-1 bg-ink-700" />
          <Link href="/" className="pill text-ink-300 hover:text-ink-100">← board</Link>
        </div>
        <h1 className="font-disp font-semibold text-[clamp(26px,3.6vw,40px)] leading-[1.05] mb-3">
          Provisionamento <span className="text-development">previsto e estruturado</span>
        </h1>
        <p className="text-ink-400 max-w-[720px] text-[15px]">
          Cada feature concluída gera um <span className="font-mono text-development">infrastructure.md</span> com
          o que ela precisa pra rodar. Quando o <b className="text-ink-100">MCP de DevOps</b> estiver plugado,
          essas necessidades viram ações de provisionamento reais — com gate humano, como tudo aqui.
        </p>
      </header>

      {/* MCP DevOps */}
      <section className="card-surface rounded-panel p-6 my-8">
        <div className="flex items-center gap-3 mb-4">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-qa shadow-[0_0_0_4px_rgba(55,201,124,.18)]" : "bg-planning shadow-[0_0_0_4px_rgba(227,163,61,.15)]"}`} />
          <h2 className="font-disp text-lg text-ink-100">MCP DevOps</h2>
          <span className="pill text-[10px]">{connected ? "configurado" : "aguardando endpoint do time de DevOps"}</span>
        </div>
        <p className="text-[13px] text-ink-400 mb-4 max-w-[760px]">
          O time de DevOps fornece um servidor MCP com as ferramentas de provisionamento. Cole aqui a URL e a
          credencial — a partir daí, os agentes passam a <b className="text-ink-200">enxergar as capacidades reais</b>
          {" "}e podem solicitar provisionamento (sempre com aprovação humana antes de executar).
        </p>
        <div className="grid md:grid-cols-[1fr_1fr_auto] gap-3">
          <input
            value={mcpUrl}
            onChange={(e) => setMcpUrl(e.target.value)}
            placeholder="URL do MCP (ex: https://mcp.devops.cielo/sse)"
            className="bg-ink-900 border border-ink-700 rounded-card px-3 py-2 text-sm text-ink-100 focus:border-development focus:outline-none"
          />
          <input
            value={mcpToken}
            onChange={(e) => setMcpToken(e.target.value)}
            placeholder="token / credencial (opcional)"
            type="password"
            className="bg-ink-900 border border-ink-700 rounded-card px-3 py-2 text-sm text-ink-100 focus:border-development focus:outline-none"
          />
          <button onClick={saveMcp} className="pill !bg-development !text-ink-950 !border-development font-semibold">
            salvar conexão
          </button>
        </div>
        {savedMsg && <div className="mt-3 text-[12px] font-mono text-qa">{savedMsg}</div>}
      </section>

      {/* Catálogo de capacidades */}
      <section className="my-10">
        <div className="flex items-baseline gap-3 mb-5">
          <span className="font-mono text-[12px] text-ink-500">01</span>
          <h2 className="font-disp font-semibold text-xl text-ink-100">Catálogo de capacidades</h2>
          <span className="h-px flex-1 bg-ink-700" />
          <span className="font-mono text-[11px] text-ink-500">o que é previsto provisionar</span>
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          {CATALOG.map((c) => (
            <div key={c.t} className="card-surface p-4">
              <div className="text-xl mb-2">{c.ic}</div>
              <div className="font-disp font-semibold text-[14.5px] text-ink-100">{c.t}</div>
              <div className="text-[12px] text-ink-400 mt-1 leading-snug">{c.d}</div>
              <div className="mt-3 font-mono text-[9.5px] tracking-[.13em] uppercase text-development">{c.tag}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Necessidades por feature */}
      <section className="my-10">
        <div className="flex items-baseline gap-3 mb-5">
          <span className="font-mono text-[12px] text-ink-500">02</span>
          <h2 className="font-disp font-semibold text-xl text-ink-100">Necessidades por feature</h2>
          <span className="h-px flex-1 bg-ink-700" />
          <span className="font-mono text-[11px] text-ink-500">infrastructure.md das features concluídas</span>
        </div>
        {loading ? (
          <div className="skeleton h-20 rounded-card" />
        ) : features.length === 0 ? (
          <div className="card-surface p-5 text-[13px] text-ink-400">
            Nenhuma feature concluída com resumo de infraestrutura ainda. Ao concluir uma feature, o
            resumo <span className="font-mono text-development">infrastructure.md</span> aparece aqui,
            estruturado para o provisionador.
          </div>
        ) : (
          <div className="space-y-2">
            {features.map((f: any) => (
              <div key={f.id} className="card-surface p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="font-disp font-semibold text-[14px] text-ink-100">{f.title}</div>
                  <div className="font-mono text-[11px] text-ink-500">{f.slug} · {f.repo}</div>
                </div>
                <a
                  href={f.infra_url}
                  target="_blank"
                  rel="noreferrer"
                  className="pill text-development hover:text-ink-100 shrink-0"
                >
                  infrastructure.md →
                </a>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="text-ink-500 font-mono text-[11px] mt-6">
        // fluxo previsto: feature concluída → infrastructure.md estruturado → MCP DevOps lista capacidades →
        humano aprova → provisionamento executa → status volta pro board.
      </p>
    </main>
  );
}
