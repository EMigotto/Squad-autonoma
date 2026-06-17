import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Lista features concluídas que têm infrastructure.md na branch base. */
export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = createServiceClient();
  const { data: rows } = await svc
    .from("features")
    .select("id, slug, title, github_repo, stage")
    .eq("stage", "done")
    .order("created_at", { ascending: false })
    .limit(50);

  const features = (rows ?? []).map((f: any) => ({
    id: f.id,
    slug: f.slug,
    title: f.title,
    repo: f.github_repo,
    infra_url: `https://github.com/${f.github_repo}/blob/main/docs/features/${f.slug}/infrastructure.md`,
  }));
  return NextResponse.json({ features });
}
