import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cancelCard } from "@/lib/orchestrator";

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

    const body = await req.json().catch(() => ({}));
    const reason = body.reason ?? "sem motivo informado";

    await cancelCard(params.id, reason, user.id);
    return NextResponse.json({ status: "cancelled" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
