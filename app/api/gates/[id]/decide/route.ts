import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { advanceCard } from "@/lib/orchestrator";

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

    const body = await req.json();
    if (!["approved", "rejected"].includes(body.decision)) {
      return NextResponse.json(
        { error: "decision must be 'approved' or 'rejected'" },
        { status: 400 }
      );
    }

    // Pega o card_id do gate
    const svc = createServiceClient();
    const { data: gate } = await svc
      .from("human_gates")
      .select("card_id")
      .eq("id", params.id)
      .single();
    if (!gate)
      return NextResponse.json({ error: "gate not found" }, { status: 404 });

    await advanceCard(
      gate.card_id,
      body.decision,
      body.reason,
      user.id,
      body.override_initial_message
    );

    return NextResponse.json({ status: "ok" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
