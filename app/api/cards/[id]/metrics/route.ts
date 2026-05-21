import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { recomputeCardMetrics, updateManualMetrics } from "@/lib/metrics";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // recalcula on-demand pra refletir cycle time atual
  try {
    await recomputeCardMetrics(params.id);
  } catch {
    /* best-effort */
  }

  const svc = createServiceClient();
  const { data } = await svc
    .from("card_metrics")
    .select("*")
    .eq("card_id", params.id)
    .maybeSingle();

  // moeda do projeto
  let currency = "BRL";
  if (data?.project_id) {
    const { data: s } = await svc
      .from("app_settings")
      .select("metrics_currency")
      .eq("project_id", data.project_id)
      .limit(1)
      .maybeSingle();
    currency = s?.metrics_currency ?? "BRL";
  }

  return NextResponse.json({ metrics: data, currency });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const patch: { test_coverage_pct?: number | null; human_hours?: number | null } = {};
  if ("test_coverage_pct" in body)
    patch.test_coverage_pct =
      body.test_coverage_pct === null ? null : Number(body.test_coverage_pct);
  if ("human_hours" in body)
    patch.human_hours =
      body.human_hours === null ? null : Number(body.human_hours);

  await updateManualMetrics(params.id, patch);

  const svc = createServiceClient();
  const { data } = await svc
    .from("card_metrics")
    .select("*")
    .eq("card_id", params.id)
    .maybeSingle();
  return NextResponse.json({ metrics: data });
}
