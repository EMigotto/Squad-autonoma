import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";

export const runtime = "nodejs";

export async function GET() {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const projectId = await getActiveProjectId(user.id);
  const svc = createServiceClient();

  let { data } = await svc
    .from("app_settings")
    .select("*")
    .eq("project_id", projectId)
    .limit(1)
    .maybeSingle();

  // Se o projeto ainda não tem settings, cria um registro default (upsert
  // atômico — evita corrida e o conflito de PK singleton legado).
  if (!data && projectId) {
    const { data: created } = await svc
      .from("app_settings")
      .upsert(
        { project_id: projectId, default_base_branch: "main" },
        { onConflict: "project_id" }
      )
      .select("*")
      .maybeSingle();
    data = created;
  }

  return NextResponse.json({ settings: data });
}

export async function PUT(req: Request) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const projectId = await getActiveProjectId(user.id);
  if (!projectId) {
    return NextResponse.json({ error: "nenhum projeto ativo" }, { status: 400 });
  }

  const body = await req.json();
  const allowed = [
    "auto_merge_prs",
    "commit_to_existing_branch",
    "auto_advance_after_pm",
    "auto_advance_after_tl",
    "default_base_branch",
    "notification_slack_webhook",
    "notification_teams_webhook",
    "human_hourly_cost",
    "token_cost_input_mtok",
    "token_cost_output_mtok",
    "metrics_currency",
    "usd_to_brl",
    "require_reinforced_review",
    "sensitive_paths",
    "teams_command_token",
    "infra_mcp_url",
    "infra_mcp_token",
    "vercel_deploy_hook",
    "vercel_token",
    "preview_base_url",
    "teams_chat_link",
    "baseline_loc_per_dev_day",
    "baseline_hours_per_day",
    "baseline_dev_hourly",
    "baseline_hours_s",
    "baseline_hours_m",
    "baseline_hours_l",
    "baseline_hours_xl",
    "baseline_default_complexity",
  ];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in body) patch[k] = body[k];
  }
  patch.updated_by = user.id;
  patch.updated_at = new Date().toISOString();
  patch.project_id = projectId;

  const svc = createServiceClient();

  // Upsert ATÔMICO por projeto (evita corrida entre o GET que cria a linha
  // default e o PATCH; e o erro de PK singleton legado id=1).
  let { error } = await svc
    .from("app_settings")
    .upsert(patch, { onConflict: "project_id" });

  // Fallback: bases ainda com a PK antiga (id=1) podem recusar o upsert por
  // project_id. Nesse caso, tenta update direto; se não existir, insert.
  if (error) {
    const { data: existing } = await svc
      .from("app_settings")
      .select("id")
      .eq("project_id", projectId)
      .limit(1)
      .maybeSingle();
    if (existing) {
      ({ error } = await svc
        .from("app_settings")
        .update(patch)
        .eq("project_id", projectId));
    } else {
      ({ error } = await svc.from("app_settings").insert(patch));
    }
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ status: "ok" });
}
