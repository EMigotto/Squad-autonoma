"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * Wizard de onboarding de APLICAÇÃO LEGADA — guia o PM/TL do zero até a
 * primeira feature rodando com segurança sobre um codebase existente.
 * Passos: 1 Aplicação → 2 Ambientes → 3 Mapeamento (arqueólogo) →
 * 4 Revisão humana → 5 Primeira feature.
 */

const STEPS = [
  { n: 1, id: "app", title: "Aplicação", desc: "Cadastre o repositório legado" },
  { n: 2, id: "env", title: "Ambientes", desc: "Branches por ambiente" },
  { n: 3, id: "map", title: "Mapeamento", desc: "Agente arqueólogo investiga" },
  { n: 4, id: "review", title: "Revisão humana", desc: "Valide o conhecimento" },
  { n: 5, id: "first", title: "Primeira feature", desc: "Piloto pequeno e seguro" },
];

const DOCS = [
  { f: "ARQUITETURA.md", o: "Estilo arquitetural, módulos, fluxos de ponta a ponta", lê: "Tech Lead · Devs" },
  { f: "STACK-TECNICA.md", o: "Linguagens, frameworks, libs e para que cada uma é usada", lê: "Tech Lead · Devs" },
  { f: "CONVENCOES.md", o: "Padrões REAIS do código, com exemplos copiados dele", lê: "Devs · Code Reviewer" },
  { f: "MAPA-MODULOS.md", o: "Módulo → responsabilidade → dependências → risco ao mexer", lê: "Tech Lead · Devs" },
  { f: "GLOSSARIO-DOMINIO.md", o: "Termos de negócio encontrados no código", lê: "PM · todos" },
  { f: "AREAS-DE-RISCO.md", o: "Código frágil, o que NUNCA tocar sem aprovação humana", lê: "Todos os agentes" },
  { f: "AGENTS.md (raiz)", o: "Contrato operacional: build/test/run, branches, ordem de leitura", lê: "Todos, sempre, primeiro" },
];

export default function LegacyWizardPage() {
  const [step, setStep] = useState(1);
  const [mapping, setMapping] = useState<"idle" | "running" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function startMapping() {
    setMapping("running");
    setMsg("");
    try {
      const res = await fetch("/api/projects/onboard", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMapping("error");
        setMsg(data.error ?? `HTTP ${res.status}`);
      } else {
        setMapping("done");
        setMsg("Agente arqueólogo disparado. Acompanhe a sessão e, ao final, os documentos aparecem em docs/arquitetura/ na branch base.");
      }
    } catch (e) {
      setMapping("error");
      setMsg(String(e));
    }
  }

  return (
    <main className="min-h-screen max-w-[1180px] mx-auto px-7 pb-20">
      {/* hero */}
      <header className="pt-12 pb-2">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="font-mono text-[11px] tracking-[.16em] uppercase text-ink-400">
            onboarding · aplicação legada
          </span>
          <span className="h-px flex-1 bg-ink-700" />
          <Link href="/" className="pill text-ink-300 hover:text-ink-100">← voltar ao board</Link>
        </div>
        <h1 className="font-disp font-semibold text-[clamp(28px,4vw,44px)] leading-[1.05] mb-3">
          Do repositório legado à <span className="text-qa">primeira feature segura</span>
        </h1>
        <p className="text-ink-400 max-w-[680px] text-[15px]">
          Cinco passos para os agentes entenderem a arquitetura, as tecnologias e os padrões
          do seu código existente — <b className="text-ink-100">antes</b> de escrever a primeira linha.
        </p>
      </header>

      {/* stepper */}
      <div className="grid grid-cols-5 gap-3 my-8">
        {STEPS.map((s) => (
          <button
            key={s.id}
            onClick={() => setStep(s.n)}
            className={`text-left card-surface p-4 ${step === s.n ? "!border-qa/50" : ""}`}
          >
            <div className={`font-mono text-[10px] tracking-[.15em] uppercase mb-2 ${step === s.n ? "text-qa" : "text-ink-500"}`}>
              passo {s.n} {step > s.n && "✓"}
            </div>
            <div className="font-disp font-semibold text-[15px] text-ink-100">{s.title}</div>
            <div className="text-[11.5px] text-ink-400 mt-1">{s.desc}</div>
          </button>
        ))}
      </div>

      {/* conteúdo do passo */}
      <section className="card-surface rounded-panel p-7">
        {step === 1 && (
          <div>
            <h2 className="font-disp text-xl mb-3 text-ink-100">1 · Cadastre a Aplicação</h2>
            <p className="text-ink-300 text-sm mb-4 max-w-[720px]">
              Em <b>Settings → aplicações</b>, adicione o repositório legado com tipo
              <span className="text-planning font-mono"> EXISTENTE</span>, a branch base (ex.: main)
              e, se souber, a stack. O tipo "existente" liga o modo conservador: os agentes passam a
              imitar o código em vez de inventar padrões.
            </p>
            <div className="flex gap-3">
              <Link href="/settings" className="pill !bg-qa !text-ink-950 !border-qa font-semibold">abrir Settings →</Link>
              <button onClick={() => setStep(2)} className="pill text-ink-300 hover:text-ink-100">já cadastrei, próximo</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="font-disp text-xl mb-3 text-ink-100">2 · Defina os Ambientes</h2>
            <p className="text-ink-300 text-sm mb-4 max-w-[720px]">
              Ainda em Settings, crie os ambientes da aplicação (ex.: <span className="font-mono text-development">Dev → Homologação → Produção</span>),
              cada um apontando para a branch correspondente, com a cadeia de promoção. As features nascem
              no ambiente padrão e os agentes commitam <b>somente</b> na working branch da feature.
            </p>
            <div className="flex gap-3">
              <Link href="/settings" className="pill !bg-qa !text-ink-950 !border-qa font-semibold">configurar ambientes →</Link>
              <button onClick={() => setStep(3)} className="pill text-ink-300 hover:text-ink-100">pronto, próximo</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="font-disp text-xl mb-3 text-ink-100">3 · Dispare o Mapeamento (agente arqueólogo)</h2>
            <p className="text-ink-300 text-sm mb-4 max-w-[760px]">
              O agente clona o repo, lê manifestos e pontos de entrada, segue os fluxos, amostra código
              de cada módulo e <b>roda build/teste para confirmar os comandos</b>. Só então escreve a
              Base de Conhecimento Arquitetural — commitando apenas documentos na branch base:
            </p>
            <div className="grid md:grid-cols-2 gap-2 mb-5">
              {DOCS.map((d) => (
                <div key={d.f} className="border border-ink-700 rounded-card p-3 bg-ink-900/60">
                  <div className="font-mono text-[12px] text-development">{d.f}</div>
                  <div className="text-[12px] text-ink-300 mt-1">{d.o}</div>
                  <div className="text-[10.5px] font-mono text-ink-500 mt-1.5">lido por: {d.lê}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={startMapping}
                disabled={mapping === "running"}
                className="pill !bg-qa !text-ink-950 !border-qa font-semibold disabled:opacity-50"
              >
                {mapping === "running" ? "disparando agente…" : "🧭 iniciar mapeamento agora"}
              </button>
              {mapping === "done" && <button onClick={() => setStep(4)} className="pill text-qa">mapeamento disparado ✓ · próximo</button>}
            </div>
            {msg && (
              <div className={`mt-4 text-[12.5px] font-mono p-3 rounded-card border ${mapping === "error" ? "border-planning/50 text-planning bg-planning/10" : "border-qa/40 text-qa bg-qa/10"}`}>
                {msg}
              </div>
            )}
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="font-disp text-xl mb-3 text-ink-100">4 · Revisão humana (30 minutos que valem ouro)</h2>
            <p className="text-ink-300 text-sm mb-4 max-w-[760px]">
              Quando a sessão do arqueólogo terminar, abra os documentos em
              <span className="font-mono text-development"> docs/arquitetura/</span> (pela aba ARQUIVOS de
              qualquer card, ou direto no GitHub) e valide com quem conhece o sistema:
            </p>
            <ul className="space-y-2 text-sm text-ink-300 mb-5">
              <li className="flex gap-2"><span className="text-qa">✓</span> Os comandos de build/teste estão certos? (o agente os executou, mas confirme)</li>
              <li className="flex gap-2"><span className="text-qa">✓</span> O MAPA-MODULOS marcou como <b className="text-planning">risco ALTO</b> os lugares certos?</li>
              <li className="flex gap-2"><span className="text-qa">✓</span> Falta alguma armadilha conhecida no AREAS-DE-RISCO? Adicione à mão — é markdown.</li>
              <li className="flex gap-2"><span className="text-qa">✓</span> As CONVENCOES refletem como o time realmente escreve?</li>
            </ul>
            <button onClick={() => setStep(5)} className="pill !bg-qa !text-ink-950 !border-qa font-semibold">revisado · próximo</button>
          </div>
        )}

        {step === 5 && (
          <div>
            <h2 className="font-disp text-xl mb-3 text-ink-100">5 · Primeira feature (piloto pequeno)</h2>
            <p className="text-ink-300 text-sm mb-4 max-w-[760px]">
              Crie uma feature <b>pequena e de baixo risco</b> (uma melhoria de tela, um endpoint simples).
              Todos os agentes agora leem a Base de Conhecimento antes de trabalhar e seguem os padrões do
              seu código. Revise cada gate com atenção no piloto — os aprendizados do Dreaming realimentam
              o AGENTS.md e o sistema melhora a cada entrega.
            </p>
            <div className="flex gap-3">
              <Link href="/" className="pill !bg-qa !text-ink-950 !border-qa font-semibold">criar a primeira feature →</Link>
              <Link href="/dashboards" className="pill text-ink-300 hover:text-ink-100">ver ROI depois em /dashboards</Link>
            </div>
          </div>
        )}
      </section>

      <p className="text-ink-500 font-mono text-[11px] mt-6">
        // dica: repita o passo 3 a cada grande mudança no repo — o conhecimento fica versionado no Git e evolui com o código.
      </p>
    </main>
  );
}
