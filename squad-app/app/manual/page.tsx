import Link from "next/link";

export const metadata = { title: "Manual · Squad Autônomo" };

const SECTIONS: { id: string; n: string; label: string }[] = [
  { id: "visao", n: "01", label: "Visão" },
  { id: "arq", n: "02", label: "Arquitetura" },
  { id: "setup", n: "03", label: "Configuração inicial" },
  { id: "time", n: "04", label: "Novo time" },
  { id: "agentes", n: "05", label: "Agentes & esteira" },
  { id: "feature", n: "06", label: "Nova feature" },
  { id: "metricas", n: "07", label: "Métricas & custo" },
  { id: "codigo", n: "08", label: "Código no GitHub" },
  { id: "porque", n: "09", label: "Por que AI-native" },
  { id: "comparativo", n: "10", label: "Comparativo" },
  { id: "papeis", n: "11", label: "Papéis humanos" },
  { id: "artefatos", n: "12", label: "Artefatos por agente" },
  { id: "validar", n: "13", label: "Validação local" },
];

export default function ManualPage() {
  return (
    <div className="h-screen flex flex-col bg-ink-950 text-ink-100">
      {/* topo */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-ink-800 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold font-mono">// manual</span>
          <span className="text-[11px] text-ink-400">Squad Autônomo — guia how-to & arquitetura</span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/manual-content.html"
            target="_blank"
            rel="noreferrer"
            className="text-[11px] uppercase tracking-widest text-ink-400 hover:text-ink-100"
          >
            abrir em nova aba ↗
          </a>
          <Link
            href="/"
            className="text-[11px] uppercase tracking-widest text-ink-300 hover:text-ink-100"
          >
            ← board
          </Link>
        </div>
      </div>

      {/* corpo: menu à esquerda + conteúdo */}
      <div className="flex-1 flex min-h-0">
        <nav className="w-60 shrink-0 border-r border-ink-800 overflow-y-auto py-4 px-2 bg-ink-950">
          <div className="text-[10px] uppercase tracking-widest text-ink-500 px-3 mb-2 font-mono">
            seções
          </div>
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`/manual-content.html#${s.id}`}
                  target="manualframe"
                  className="flex items-baseline gap-2 px-3 py-1.5 text-[13px] text-ink-300 hover:bg-ink-900 hover:text-ink-100 rounded font-mono"
                >
                  <span className="text-ink-600 text-[11px]">{s.n}</span>
                  <span>{s.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <iframe
          name="manualframe"
          title="Manual"
          src="/manual-content.html"
          className="flex-1 border-0 bg-ink-950"
        />
      </div>
    </div>
  );
}
