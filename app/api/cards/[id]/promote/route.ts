import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { promoteEnvironment } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const svc = createServiceClient();
    const { data: card } = await svc
      .from("cards")
      .select("feature:features(environment_id)")
      .eq("id", params.id)
      .maybeSingle();
    const envId = (card as any)?.feature?.environment_id;
    if (!envId) return NextResponse.json({ error: "card sem ambiente" }, { status: 400 });
    const result = await promoteEnvironment(envId);
    return NextResponse.json({ status: "ok", ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
