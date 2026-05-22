import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";

export const runtime = "nodejs";

/** Recalcula o custo/hora médio do projeto a partir das pessoas e grava em app_settings. */
async function syncHourlyCost(projectId: string) {
  const svc = createServiceClient();
  const { data: people } = await svc
    .from("project_people")
    .select("monthly_salary, monthly_hours")
    .eq("project_id", projectId);

  let hourly = 0;
  const valid = (people ?? []).filter((p) => Number(p.monthly_hours) > 0);
  if (valid.length > 0) {
    const rates = valid.map(
      (p) => Number(p.monthly_salary) / Number(p.monthly_hours)
    );
    hourly = rates.reduce((a, b) => a + b, 0) / rates.length;
  }

  // upsert em app_settings (por projeto)
  const { data: existing } = await svc
    .from("app_settings")
    .select("id")
    .eq("project_id", projectId)
    .limit(1)
    .maybeSingle();
  if (existing) {
    await svc
      .from("app_settings")
      .update({ human_hourly_cost: +hourly.toFixed(2) })
      .eq("project_id", projectId);
  } else {
    await svc
      .from("app_settings")
      .insert({ project_id: projectId, human_hourly_cost: +hourly.toFixed(2) });
  }
  return +hourly.toFixed(2);
}

export async function GET() {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const projectId = await getActiveProjectId(user.id);
  if (!projectId) return NextResponse.json({ people: [], hourly_cost: 0 });

  const svc = createServiceClient();
  const { data: people } = await svc
    .from("project_people")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  const hourly = await syncHourlyCost(projectId);
  return NextResponse.json({ people: people ?? [], hourly_cost: hourly });
}

export async function POST(req: Request) {
  try {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const projectId = await getActiveProjectId(user.id);
    if (!projectId)
      return NextResponse.json({ error: "nenhum projeto ativo" }, { status: 400 });

    const body = await req.json();
    if (!body.name)
      return NextResponse.json({ error: "nome é obrigatório" }, { status: 400 });

    const svc = createServiceClient();
    const { data, error } = await svc
      .from("project_people")
      .insert({
        project_id: projectId,
        name: body.name,
        role: body.role ?? null,
        monthly_salary: Number(body.monthly_salary ?? 0),
        monthly_hours: Number(body.monthly_hours ?? 160),
        created_by: user.id,
      })
      .select()
      .single();
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    const hourly = await syncHourlyCost(projectId);
    return NextResponse.json({ person: data, hourly_cost: hourly });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
