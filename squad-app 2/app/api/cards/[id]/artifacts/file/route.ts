import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { normalizeGithubRepo } from "@/lib/github";

export const runtime = "nodejs";

/**
 * Fetch o conteúdo de um arquivo específico do GitHub.
 * Query params: path, branch
 */
export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const url = new URL(req.url);
    const path = url.searchParams.get("path");
    const branch = url.searchParams.get("branch") ?? "main";
    if (!path) {
      return NextResponse.json({ error: "path required" }, { status: 400 });
    }

    const svc = createServiceClient();
    const { data: card } = await svc
      .from("cards")
      .select("feature:features(github_repo)")
      .eq("id", params.id)
      .single();

    if (!card?.feature) {
      return NextResponse.json({ error: "card not found" }, { status: 404 });
    }

    const repo = normalizeGithubRepo((card.feature as any).github_repo as string);
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: "GITHUB_TOKEN não configurado" },
        { status: 500 }
      );
    }

    const ghUrl = `https://api.github.com/repos/${repo}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?ref=${encodeURIComponent(branch)}`;
    const res = await fetch(ghUrl, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
    });

    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json(
        { error: `GitHub API ${res.status}: ${errBody.slice(0, 200)}` },
        { status: 200 }
      );
    }

    const data = await res.json();
    // GitHub retorna conteúdo em base64
    const content = Buffer.from(data.content, "base64").toString("utf-8");

    return NextResponse.json({
      path: data.path,
      name: data.name,
      size: data.size,
      content,
      sha: data.sha,
      html_url: data.html_url,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

// PUT: salva alterações no arquivo (commit direto na branch).
// Body: { path, branch, sha, content, message? }
export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    const { path, branch, sha, content, message } = body ?? {};
    if (!path || !branch || !sha || typeof content !== "string") {
      return NextResponse.json({ error: "path, branch, sha e content são obrigatórios" }, { status: 400 });
    }

    const svc = createServiceClient();
    const { data: card } = await svc
      .from("cards")
      .select("feature:features(github_repo, slug)")
      .eq("id", params.id)
      .single();
    if (!card?.feature) return NextResponse.json({ error: "card not found" }, { status: 404 });
    const repo = normalizeGithubRepo((card.feature as any).github_repo as string);
    const slug = (card.feature as any).slug as string;
    const token = process.env.GITHUB_TOKEN;
    if (!token) return NextResponse.json({ error: "GITHUB_TOKEN não configurado" }, { status: 500 });

    const ghUrl = `https://api.github.com/repos/${repo}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const res = await fetch(ghUrl, {
      method: "PUT",
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
      body: JSON.stringify({
        message: message || `docs(${slug}): edit ${path} via squad`,
        content: Buffer.from(content, "utf-8").toString("base64"),
        sha,
        branch,
      }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      return NextResponse.json(
        { error: `GitHub API ${res.status}: ${errBody.slice(0, 300)}` },
        { status: res.status === 409 ? 409 : 500 }
      );
    }
    const data = await res.json();
    return NextResponse.json({
      status: "ok",
      sha: data.content?.sha,
      html_url: data.content?.html_url,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
