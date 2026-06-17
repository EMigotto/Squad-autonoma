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
    </main>
  );
}
