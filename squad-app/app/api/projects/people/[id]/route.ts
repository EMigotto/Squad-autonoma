import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const projectId = await getActiveProjectId(user.id);
  const svc = createServiceClient();
  await svc.from("project_people").delete().eq("id", params.id);

  // recalcula custo/hora médio
  let hourly = 0;
  if (projectId) {
    const { data: people } = await svc
      .from("project_people")
      .select("monthly_salary, monthly_hours")
      .eq("project_id", projectId);
    const valid = (people ?? []).filter((p) => Number(p.monthly_hours) > 0);
    if (valid.length > 0) {
      const rates = valid.map(
        (p) => Number(p.monthly_salary) / Number(p.monthly_hours)
      );
      hourly = +(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(2);
    }
    await svc
      .from("app_settings")
      .update({ human_hourly_cost: hourly })
      .eq("project_id", projectId);
  }

  return NextResponse.json({ status: "deleted", hourly_cost: hourly });
}
