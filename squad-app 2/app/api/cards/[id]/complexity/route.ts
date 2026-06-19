import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const VALID = ["S", "M", "L", "XL"];

// PATCH: define a complexidade (S/M/L/XL) da feature, usada no baseline de ROI
// quando não há LOC medível. Envie {complexity: null} para limpar.
export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    let complexity: string | null = body.complexity ?? null;
    if (complexity != null) {
      complexity = String(complexity).toUpperCase();
      if (!VALID.includes(complexity)) {
        return NextResponse.json({ error: "complexity inválida (use S, M, L ou XL)" }, { status: 400 });
      }
    }

    const svc = createServiceClient();
    // garante uma linha de métricas pro card
    const { data: existing } = await svc
      .from("card_metrics")
      .select("card_id")
      .eq("card_id", params.id)
      .maybeSingle();
    if (existing) {
      await svc
        .from("card_metrics")
        .update({ complexity, updated_at: new Date().toISOString() })
        .eq("card_id", params.id);
    } else {
      await svc.from("card_metrics").insert({ card_id: params.id, complexity });
    }
    return NextResponse.json({ status: "ok", complexity });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
