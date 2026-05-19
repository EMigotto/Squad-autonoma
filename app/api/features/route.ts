import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createFeature } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const required = ["slug", "title", "description", "github_repo"];
  for (const k of required) {
    if (!body[k]) {
      return NextResponse.json({ error: `missing ${k}` }, { status: 400 });
    }
  }

  try {
    const result = await createFeature({
      slug: body.slug,
      title: body.title,
      description: body.description,
      github_repo: body.github_repo,
      github_parent_issue: body.github_parent_issue ?? 0,
      created_by: user.id,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
