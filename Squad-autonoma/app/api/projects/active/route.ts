import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setActiveProject } from "@/lib/projects";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.project_id) {
    return NextResponse.json({ error: "project_id required" }, { status: 400 });
  }

  await setActiveProject(user.id, body.project_id);
  return NextResponse.json({ status: "ok", active_project_id: body.project_id });
}
