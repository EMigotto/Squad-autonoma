import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateInfrastructureSummary } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const result = await generateInfrastructureSummary(params.id);
    return NextResponse.json({ status: "ok", ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
