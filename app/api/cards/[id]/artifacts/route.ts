import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Lista os arquivos que o agent gerou para esta feature, lendo do GitHub.
 *
 * Estratégia:
 * 1. Pega a branch da PR aberta (ou tenta `feat/<slug>/spec` como fallback)
 * 2. Lista o conteúdo de docs/features/<slug>/ recursivamente
 * 3. Retorna metadados (nome, path, tipo, tamanho). Conteúdo é fetched on-demand.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const svc = createServiceClient();
    const { data: card } = await svc
      .from("cards")
      .select("feature:features(slug, github_repo)")
      .eq("id", params.id)
      .single();

    if (!card?.feature)
      return NextResponse.json({ error: "card or feature not found" }, { status: 404 });

    const feature = card.feature as any;
    const repo = feature.github_repo as string;
    const slug = feature.slug as string;
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "GITHUB_TOKEN não configurado", files: [] },
        { status: 200 }
      );
    }

    const branches = await tryBranches(repo, slug, token);

    // Arquivos no branch (prd.md, adr.md, acceptance-criteria.md, prototypes)
    let files: Array<{ name: string; path: string; type: string; size: number }> =
      [];
    let primary: string | undefined;
    if (branches.length) {
      primary = branches[0];
      files = await listFilesRecursive(
        repo,
        `docs/features/${slug}`,
        primary,
        token
      );
    }

    // Chunks = sub-issues com label feat:<slug>
    const chunks = await listIssues(repo, slug, token);

    // PRs relacionados à feature (branch contém o slug)
    const pulls = await listPulls(repo, slug, token);

    return NextResponse.json({
      files,
      branch: primary,
      branches_available: branches,
      chunks,
      pulls,
      message: branches.length
        ? undefined
        : "nenhuma branch com docs/features/" + slug + "/ encontrada ainda",
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : String(e),
        files: [],
        chunks: [],
        pulls: [],
      },
      { status: 200 }
    );
  }
}

// Lista issues (chunks) com label feat:<slug>
async function listIssues(repo: string, slug: string, token: string) {
  try {
    const url = `https://api.github.com/repos/${repo}/issues?state=all&labels=feat:${encodeURIComponent(
      slug
    )}&per_page=50`;
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) return [];
    const items = await res.json();
    if (!Array.isArray(items)) return [];
    // Filtra PRs (a API de issues retorna PRs também)
    return items
      .filter((it: any) => !it.pull_request)
      .map((it: any) => ({
        number: it.number,
        title: it.title,
        state: it.state,
        labels: (it.labels ?? []).map((l: any) =>
          typeof l === "string" ? l : l.name
        ),
        html_url: it.html_url,
      }));
  } catch {
    return [];
  }
}

// Lista PRs cujo branch (head) contém o slug
async function listPulls(repo: string, slug: string, token: string) {
  try {
    const url = `https://api.github.com/repos/${repo}/pulls?state=all&per_page=50`;
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) return [];
    const items = await res.json();
    if (!Array.isArray(items)) return [];
    const norm = slug.toLowerCase();
    return items
      .filter((pr: any) => {
        const ref = (pr.head?.ref ?? "").toLowerCase();
        const title = (pr.title ?? "").toLowerCase();
        return ref.includes(norm) || title.includes(norm);
      })
      .map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        state: pr.merged_at ? "merged" : pr.state,
        draft: pr.draft,
        head: pr.head?.ref,
        html_url: pr.html_url,
      }));
  } catch {
    return [];
  }
}

async function tryBranches(repo: string, slug: string, token: string) {
  const candidates = [
    `feat/${slug}/spec`,
    `feat/${slug}/plan`,
    `feat/${slug}/integration`,
    "main",
    "master",
  ];
  const ok: string[] = [];
  for (const br of candidates) {
    const url = `https://api.github.com/repos/${repo}/contents/docs/features/${encodeURIComponent(
      slug
    )}?ref=${encodeURIComponent(br)}`;
    const res = await fetch(url, {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
    });
    if (res.ok) ok.push(br);
  }
  return ok;
}

async function listFilesRecursive(
  repo: string,
  path: string,
  branch: string,
  token: string
): Promise<Array<{ name: string; path: string; type: string; size: number }>> {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(
    path
  )}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return [];

  const items = await res.json();
  if (!Array.isArray(items)) return [];

  const result: Array<{ name: string; path: string; type: string; size: number }> = [];
  for (const it of items) {
    if (it.type === "file") {
      result.push({
        name: it.name,
        path: it.path,
        type: "file",
        size: it.size,
      });
    } else if (it.type === "dir") {
      const nested = await listFilesRecursive(repo, it.path, branch, token);
      result.push(...nested);
    }
  }
  return result;
}
