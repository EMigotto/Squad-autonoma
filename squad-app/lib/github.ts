/**
 * Normaliza o identificador de um repositório GitHub para o formato curto
 * "owner/repo", aceitando:
 *   - "owner/repo"
 *   - "https://github.com/owner/repo"
 *   - "https://github.com/owner/repo.git"
 *   - "git@github.com:owner/repo.git"
 *   - com barra final, query ou fragmento
 * Usado para montar URLs da API do GitHub (api.github.com/repos/<owner/repo>/...).
 */
export function normalizeGithubRepo(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw).trim();
  // git@github.com:owner/repo.git
  s = s.replace(/^git@github\.com:/i, "");
  // https://github.com/owner/repo  ou  http://  ou  www.
  s = s.replace(/^https?:\/\/(www\.)?github\.com\//i, "");
  // remove credenciais embutidas tipo x-access-token@github.com
  s = s.replace(/^[^/]*@github\.com\//i, "");
  // tira query/fragmento
  s = s.split(/[?#]/)[0];
  // tira sufixo .git e barras nas pontas
  s = s.replace(/\.git$/i, "").replace(/^\/+|\/+$/g, "");
  // colapsa para apenas owner/repo (ignora segmentos extras como /tree/main)
  const parts = s.split("/").filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return s;
}
