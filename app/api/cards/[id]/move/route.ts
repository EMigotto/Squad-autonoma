import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { moveCardToStage } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

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

    const body = await req.json().catch(() => ({}));
    const targetStage = body.stage;
    const dispatch = body.dispatch !== false; // default true
    if (!targetStage) {
      return NextResponse.json({ error: "stage required" }, { status: 400 });
    }

    await moveCardToStage(
      params.id,
      targetStage,
      dispatch,
      body.gate_decision === "approved" ? "approved" : "rejected",
      body.gate_reason,
      body.model
    );
    return NextResponse.json({ status: "moved", stage: targetStage });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
