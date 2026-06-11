import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { previewKickoff } from "@/lib/orchestrator";

export const runtime = "nodejs";

const NEXT: Record<string, string> = {
  discovery: "planning",
  planning: "development",
  development: "qa",
  qa: "done",
};

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const svc = createServiceClient();
    const { data: card } = await svc
      .from("cards")
      .select("*")
      .eq("id", params.id)
      .single();
    if (!card)
      return NextResponse.json({ error: "card not found" }, { status: 404 });

    const targetStage = NEXT[card.stage];
    if (!targetStage || targetStage === "done") {
      return NextResponse.json({
        target_stage: "done",
        message: "Sem próxima stage — card seria marcado como done.",
      });
    }

    const preview = await previewKickoff(params.id, targetStage as any);
    return NextResponse.json({
      target_stage: targetStage,
      ...preview,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
