import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { advanceCard } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { decision, reason } = await req.json();
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json(
      { error: "decision must be approved | rejected" },
      { status: 400 }
    );
  }
  if (decision === "rejected" && !reason) {
    return NextResponse.json(
      { error: "rejection requires reason" },
      { status: 400 }
    );
  }

  const svc = createServiceClient();
  const { data: gate } = await svc
    .from("human_gates")
    .select("card_id")
    .eq("id", params.id)
    .is("decision", null)
    .single();
  if (!gate) {
    return NextResponse.json(
      { error: "gate not found or already decided" },
      { status: 404 }
    );
  }

  try {
    await advanceCard(gate.card_id, decision, reason, user.id);
    return NextResponse.json({ status: "ok" });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
