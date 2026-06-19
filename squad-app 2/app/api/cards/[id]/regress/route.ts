import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { regressCardToStage } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const target = body.target_stage as string;
    if (!target) return NextResponse.json({ error: "target_stage obrigatório" }, { status: 400 });
    await regressCardToStage(params.id, target as any, body.note);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
