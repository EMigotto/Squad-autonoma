"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * /admin — Administração GLOBAL da aplicação (escopo: aplicação inteira, não
 * por time). Hoje: SSO corporativo. Acesso restrito a owners.
 */
function fmtDate(d: string | null): string {
  if (!d) return "nunca";
  try {
    return new Date(d).toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return String(d); }
}

export default function AdminPage() {
  const [sso, setSso] = useState<any>({ enabled: false, provider: "saml", domain: "", metadata_url: "", enforce: true });
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<any[]>([]);
  const [actLoading, setActLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/admin/sso-config").then((x) => x.json()).catch(() => ({}));
      if (r.config) setSso((s: any) => ({ ...s, ...r.config }));
      setIsAdmin(!!r.is_admin);
      setLoading(false);
      const a = await fetch("/api/admin/activity").then((x) => x.json()).catch(() => ({}));
      setActivity(a.rows ?? []);
      setActLoading(false);
    })();
  }, []);

  async function save() {
    setMsg("");
    const res = await fetch("/api/admin/sso-config", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sso),
    });
    const d = await res.json().catch(() => ({}));
    setMsg(res.ok ? "configuração de SSO salva ✓" : `erro: ${d.error ?? res.status}`);
  }

  return (
    <main className="min-h-screen max-w-[1100px] mx-auto px-7 pb-20">
      <header className="pt-12 pb-2">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="font-mono text-[11px] tracking-[.16em] uppercase text-ink-400">
            administração · aplicação global
          </span>
          <span className="h-px flex-1 bg-ink-700" />
          <Link href="/admin/setup" className="pill text-ink-300 hover:text-ink-100">setup de agentes</Link>
          <Link href="/" className="pill text-ink-300 hover:text-ink-100">← board</Link>
        </div>
        <h1 className="font-disp font-semibold text-[clamp(26px,3.4vw,38px)] leading-[1.05] mb-2">
          Administração da plataforma
        </h1>
        <p className="text-ink-400 max-w-[680px] text-[15px]">
          Configurações que valem para <b className="text-ink-100">toda a aplicação</b>, acima de qualquer
          time. O SSO corporativo definido aqui se aplica a todos os usuários.
        </p>
      </header>

      {loading ? (
        <div className="skeleton h-32 rounded-panel mt-8" />
      ) : !isAdmin ? (
        <div className="card-surface rounded-panel p-6 mt-8 text-[13px] text-ink-300">
          Esta área é restrita a <b className="text-ink-100">administradores (owners)</b>. Fale com o
          responsável pelo time para alterar o SSO da plataforma.
          <div className="mt-3 text-ink-500 text-xs">// você pode visualizar, mas não alterar.</div>
        </div>
      ) : null}

      <section className="card-surface rounded-panel p-6 mt-8">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-disp text-lg text-ink-100">Atividade da plataforma</h2>
          <span className="font-mono text-[11px] text-ink-500">{activity.length} usuário(s)</span>
        </div>
        {actLoading ? (
          <div className="skeleton h-24 rounded-card" />
        ) : activity.length === 0 ? (
          <div className="text-[13px] text-ink-400">
            Sem dados de atividade (ou acesso restrito). Rode a migration v35 e garanta que você é admin.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-ink-500 font-mono text-[10px] uppercase tracking-wider text-left border-b border-ink-700">
                  <th className="py-2 pr-4">usuário</th>
                  <th className="py-2 pr-4">último login</th>
                  <th className="py-2 pr-4">cadastro</th>
                  <th className="py-2 pr-4 text-right">times</th>
                  <th className="py-2 pr-4 text-right">boards</th>
                  <th className="py-2 text-right">memberships</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((u) => (
                  <tr key={u.user_id} className="border-b border-ink-800 hover:bg-ink-800/40">
                    <td className="py-2 pr-4">
                      <div className="text-ink-100">{u.display_name ?? "—"}</div>
                      <div className="font-mono text-[11px] text-ink-500">{u.email}</div>
                    </td>
                    <td className="py-2 pr-4 text-ink-300">{fmtDate(u.last_sign_in_at)}</td>
                    <td className="py-2 pr-4 text-ink-400">{fmtDate(u.signed_up_at)}</td>
                    <td className="py-2 pr-4 text-right tabular text-ink-200">{u.teams_created ?? 0}</td>
                    <td className="py-2 pr-4 text-right tabular text-development">{u.projects_created ?? 0}</td>
                    <td className="py-2 text-right tabular text-ink-300">{u.team_memberships ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card-surface rounded-panel p-6 mt-8">
        <h2 className="font-disp text-lg text-ink-100 mb-1">SSO corporativo (global)</h2>
        <p className="text-[13px] text-ink-400 mb-5 max-w-[760px]">
          Login único para <b className="text-ink-200">toda a plataforma</b>. Com SSO habilitado e
          exigido, os próximos logins do domínio configurado passam pelo provedor corporativo. Quem já
          entrava por e-mail/senha é <b className="text-ink-200">reconciliado pelo e-mail</b> — ao logar
          via SSO com o mesmo endereço, continua na mesma conta, sem perder histórico.
        </p>
        <fieldset disabled={!isAdmin} className="disabled:opacity-60">
          <div className="grid md:grid-cols-2 gap-4">
            <label className="flex items-center gap-2 text-sm text-ink-200">
              <input type="checkbox" checked={!!sso.enabled} onChange={(e) => setSso({ ...sso, enabled: e.target.checked })} />
              habilitar SSO na plataforma
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-200">
              <input type="checkbox" checked={sso.enforce !== false} onChange={(e) => setSso({ ...sso, enforce: e.target.checked })} />
              exigir SSO (bloquear senha) para o domínio
            </label>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">provedor</label>
              <select value={sso.provider ?? "saml"} onChange={(e) => setSso({ ...sso, provider: e.target.value })}
                className="w-full bg-ink-900 border border-ink-700 rounded-card px-2 py-1.5 text-sm text-ink-100">
                <option value="saml">SAML 2.0</option>
                <option value="oidc">OIDC</option>
                <option value="azure">Azure AD / Entra ID</option>
                <option value="google">Google Workspace</option>
                <option value="okta">Okta</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">domínio corporativo</label>
              <input value={sso.domain ?? ""} onChange={(e) => setSso({ ...sso, domain: e.target.value })}
                placeholder="ex: cielo.com.br"
                className="w-full bg-ink-900 border border-ink-700 rounded-card px-2 py-1.5 text-sm text-ink-100" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">SAML metadata URL (informativo)</label>
              <input value={sso.metadata_url ?? ""} onChange={(e) => setSso({ ...sso, metadata_url: e.target.value })}
                placeholder="https://idp.cielo.com.br/saml/metadata"
                className="w-full bg-ink-900 border border-ink-700 rounded-card px-2 py-1.5 text-sm text-ink-100" />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={save} disabled={!isAdmin} className="pill !bg-qa !text-ink-950 !border-qa font-semibold disabled:opacity-50">salvar SSO</button>
            {msg && <span className="text-[12px] font-mono text-qa">{msg}</span>}
          </div>
        </fieldset>
        <p className="text-[11px] text-ink-500 mt-4 leading-relaxed">
          // o provedor de identidade (IdP) em si é registrado no Supabase Auth (Authentication → SSO).
          Aqui você define a política global: domínio, provedor e obrigatoriedade. A reconciliação por
          e-mail é automática — o Supabase vincula a identidade SSO à conta existente de mesmo e-mail.
        </p>
      </section>

      <SkillsAdminSection isAdmin={isAdmin} />
    </main>
  );
}

// ============================================================
// Skills GLOBAIS (Admin): upload, listagem com exclusão e matriz global
// papel × skill que vira padrão herdado por TODOS os projetos.
// ============================================================
function SkillsAdminSection({ isAdmin }: { isAdmin: boolean | null }) {
  const [skills, setSkills] = useState<any[]>([]);
  const [assoc, setAssoc] = useState<any[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [capability, setCapability] = useState("");
  const [description, setDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const d = await fetch("/api/admin/skills").then((r) => r.json()).catch(() => ({}));
    setSkills(d.skills ?? []); setAssoc(d.associations ?? []); setRoles(d.roles ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function isOn(role: string, skillId: string) {
    return assoc.some((a) => a.agent_role === role && a.skill_catalog_id === skillId && a.enabled);
  }
  async function toggle(role: string, skillId: string, enabled: boolean) {
    setAssoc((prev) => {
      const others = prev.filter((a) => !(a.agent_role === role && a.skill_catalog_id === skillId));
      return enabled ? [...others, { agent_role: role, skill_catalog_id: skillId, enabled: true }] : others;
    });
    await fetch("/api/admin/skills/associate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_role: role, skill_catalog_id: skillId, enabled }),
    });
  }
  async function upload() {
    setMsg("");
    if (!file || !name) { setMsg("selecione o .zip e dê um nome"); return; }
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file); fd.append("name", name);
    fd.append("capability", capability); fd.append("description", description);
    const res = await fetch("/api/admin/skills", { method: "POST", body: fd });
    const d = await res.json().catch(() => ({}));
    if (res.ok) { setMsg("skill global enviada ✓"); setFile(null); setName(""); setCapability(""); setDescription(""); load(); }
    else setMsg(d.error ?? "falha no upload");
    setUploading(false);
  }
  async function remove(id: string, nm: string) {
    if (!confirm(`Excluir a skill "${nm}"? Isso remove de todos os projetos e do workspace.`)) return;
    const res = await fetch(`/api/admin/skills/${id}`, { method: "DELETE" });
    if (res.ok) load(); else { const d = await res.json().catch(() => ({})); alert(d.error ?? "falha ao excluir"); }
  }

  return (
    <>
      <section className="card-surface rounded-panel p-6 mt-8">
        <h2 className="font-disp text-lg text-ink-100 mb-1">Skills globais — subir</h2>
        <p className="text-[13px] text-ink-400 mb-4 max-w-[720px]">
          Skills enviadas aqui são <b className="text-ink-200">globais</b>: ficam disponíveis para todos os
          times. Envie um <b className="text-ink-200">.zip com SKILL.md na raiz</b>. A capacidade informada é o
          que entra no prompt dos agentes.
        </p>
        <fieldset disabled={!isAdmin} className="disabled:opacity-60">
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">arquivo .zip</label>
              <input type="file" accept=".zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[12px] text-ink-300" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">nome</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: auditor-certificado-digital"
                className="w-full bg-ink-900 border border-ink-700 rounded-card px-2 py-1.5 text-sm text-ink-100" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">capacidade (entra no prompt)</label>
              <input value={capability} onChange={(e) => setCapability(e.target.value)} placeholder="ex: auditar assinatura digital"
                className="w-full bg-ink-900 border border-ink-700 rounded-card px-2 py-1.5 text-sm text-ink-100" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-ink-400 mb-1">descrição (opcional)</label>
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="o que a skill faz"
                className="w-full bg-ink-900 border border-ink-700 rounded-card px-2 py-1.5 text-sm text-ink-100" />
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button onClick={upload} disabled={uploading || !isAdmin}
              className="pill !bg-development !text-ink-950 !border-development font-semibold disabled:opacity-50">
              {uploading ? "enviando…" : "subir skill global"}
            </button>
            {msg && <span className="text-[12px] font-mono text-qa">{msg}</span>}
          </div>
        </fieldset>
      </section>

      <section className="card-surface rounded-panel p-6 mt-8">
        <h2 className="font-disp text-lg text-ink-100 mb-3">Catálogo global & associação padrão</h2>
        {loading ? <div className="skeleton h-24 rounded-card" /> : skills.length === 0 ? (
          <div className="text-[13px] text-ink-400">Nenhuma skill global. Rode a migration v38/v39 e/ou suba uma skill.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-ink-500 font-mono text-[10px] uppercase tracking-wider text-left border-b border-ink-700">
                  <th className="py-2 pr-4">skill</th>
                  {roles.map((r) => <th key={r} className="py-2 px-2 text-center">{r}</th>)}
                  <th className="py-2 pl-2"></th>
                </tr>
              </thead>
              <tbody>
                {skills.map((s) => (
                  <tr key={s.id} className="border-b border-ink-800">
                    <td className="py-2 pr-4">
                      <div className="text-ink-100">{s.name} {s.source === "anthropic" && <span className="text-[10px] text-planning">pré-build</span>}</div>
                      <div className="text-[11px] text-ink-500">{s.capability ?? s.description ?? s.skill_id}</div>
                    </td>
                    {roles.map((r) => (
                      <td key={r} className="py-2 px-2 text-center">
                        <input type="checkbox" disabled={!isAdmin} checked={isOn(r, s.id)}
                          onChange={(e) => toggle(r, s.id, e.target.checked)} />
                      </td>
                    ))}
                    <td className="py-2 pl-2 text-right">
                      <button disabled={!isAdmin} onClick={() => remove(s.id, s.name)}
                        className="text-[11px] text-ink-500 hover:text-qa disabled:opacity-40">excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-ink-500 mt-4">
              // a associação marcada aqui é o <b className="text-ink-300">padrão herdado por todos os projetos</b> (inclusive novos).
              Cada projeto pode sobrescrever/remover em Settings → skills. Após mudar, rode o redeploy em massa nos times afetados.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
