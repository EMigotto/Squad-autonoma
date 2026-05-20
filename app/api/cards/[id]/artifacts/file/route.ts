import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

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

    const repo = (card.feature as any).github_repo as string;
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
      html_url: data.html_url,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
