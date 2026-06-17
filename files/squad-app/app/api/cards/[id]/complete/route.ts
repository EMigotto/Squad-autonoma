import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { completeCardEarly } from "@/lib/orchestrator";

export const runtime = "nodejs";

export async function POST(
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

    await completeCardEarly(params.id, user.id);
    return NextResponse.json({ status: "completed" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
