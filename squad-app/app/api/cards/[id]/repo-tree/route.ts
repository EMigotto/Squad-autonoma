import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Lista a ÁRVORE COMPLETA de arquivos do repositório na working branch da
 * feature, para que PMs naveguem e abram qualquer arquivo gerado pelos agentes
 * (não só docs/features/<slug>/). O conteúdo é buscado on-demand via
 * /artifacts/file?path=...&branch=...
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const svc = createServiceClient();
    const { data: card } = await svc
      .from("cards")
      .select("feature:features(slug, github_repo, environment_id, working_branch)")
      .eq("id", params.id)
      .single();

    if (!card?.feature)
      return NextResponse.json({ error: "card not found", tree: [] }, { status: 200 });

    const feature = card.feature as any;
    const repo = feature.github_repo as string;
    const token = process.env.GITHUB_TOKEN;
    if (!token)
      return NextResponse.json({ error: "GITHUB_TOKEN não configurado", tree: [] }, { status: 200 });

    // Resolve a branch: working_branch da feature → branch do ambiente → main
    let branch = (feature.working_branch as string | null) ?? null;
    if (!branch && feature.environment_id) {
      const { data: env } = await svc
        .from("environments")
        .select("branch")
        .eq("id", feature.environment_id)
        .maybeSingle();
      branch = env?.branch ?? null;
    }
    branch = branch || "main";

    const treeUrl = `https://api.github.com/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    const res = await fetch(treeUrl, {
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      const body = await res.text();
      return NextResponse.json(
        { error: `GitHub API ${res.status}: ${body.slice(0, 160)}`, branch, tree: [] },
        { status: 200 }
      );
    }
    const data = await res.json();
    const items = Array.isArray(data.tree) ? data.tree : [];
    // só blobs (arquivos), ignora node_modules/.git/dist
    const ignore = /(^|\/)(node_modules|\.git|\.next|dist|build|vendor)(\/|$)/;
    const files = items
      .filter((t: any) => t.type === "blob" && !ignore.test(t.path))
      .map((t: any) => {
        const name = t.path.split("/").slice(-1)[0];
        const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
        return { path: t.path, name, ext, size: t.size ?? 0 };
      })
      // ordena por path pra montar árvore no front
      .sort((a: any, b: any) => a.path.localeCompare(b.path));

    return NextResponse.json({ branch, tree: files, truncated: !!data.truncated });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), tree: [] },
      { status: 200 }
    );
  }
}
