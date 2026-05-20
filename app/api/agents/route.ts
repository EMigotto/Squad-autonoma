import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { beta } from "@/lib/claude";
import { buildClaudeSpec, hashPrompt } from "@/lib/agents";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const svc = createServiceClient();
  const { data: definitions } = await svc
    .from("agent_definitions")
    .select("*")
    .order("stage", { ascending: true })
    .order("sort_order", { ascending: true });

  // Junta com info de deployment (claude_agent_id atual)
  const { data: deployed } = await svc
    .from("agents")
    .select("role, claude_agent_id, claude_agent_version, system_prompt_hash")
    .eq("is_current", true);

  const deployedMap = new Map(
    (deployed ?? []).map((d) => [
      d.role,
      {
        claude_agent_id: d.claude_agent_id,
        version: d.claude_agent_version,
        hash: d.system_prompt_hash,
      },
    ])
  );

  const enriched = (definitions ?? []).map((def) => ({
    ...def,
    deployed: deployedMap.get(def.role) ?? null,
    needs_deploy:
      !deployedMap.get(def.role) ||
      deployedMap.get(def.role)!.hash !== hashPrompt(def.system_prompt),
  }));

  // Lista os agents que existem de fato no Claude Console.
  // Mapeia cada um para a definition/stage local quando possível.
  let consoleAgents: Array<{
    id: string;
    name: string;
    model?: string;
    version?: number;
    mapped_role: string | null;
    mapped_stage: string | null;
  }> = [];
  let consoleError: string | null = null;

  try {
    const idToRole = new Map(
      (deployed ?? []).map((d) => [d.claude_agent_id, d.role])
    );
    const roleToStage = new Map(
      (definitions ?? []).map((d) => [d.role, d.stage])
    );

    // beta.agents.list() — pode paginar; pegamos a primeira página (suficiente)
    const list = await beta.agents.list({ limit: 100 });
    const items = list?.data ?? list?.agents ?? [];
    consoleAgents = items.map((a: any) => {
      const role = idToRole.get(a.id) ?? null;
      return {
        id: a.id,
        name: a.name ?? "(sem nome)",
        model:
          typeof a.model === "string" ? a.model : a.model?.id ?? undefined,
        version: a.version,
        mapped_role: role,
        mapped_stage: role ? roleToStage.get(role) ?? null : null,
      };
    });
  } catch (e) {
    consoleError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    agents: enriched,
    console_agents: consoleAgents,
    console_error: consoleError,
    needs_seed: (definitions ?? []).length === 0,
  });
}

export async function POST(req: Request) {
  try {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    const required = ["role", "name", "stage", "model", "system_prompt"];
    for (const k of required) {
      if (!body[k]) {
        return NextResponse.json(
          { error: `missing field: ${k}` },
          { status: 400 }
        );
      }
    }

    // Valida stage
    const validStages = ["discovery", "planning", "development", "qa"];
    if (!validStages.includes(body.stage)) {
      return NextResponse.json(
        { error: `stage must be one of: ${validStages.join(", ")}` },
        { status: 400 }
      );
    }

    // Role: slug-friendly
    const role = body.role
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");

    const svc = createServiceClient();

    // Verifica se já existe
    const { data: existing } = await svc
      .from("agent_definitions")
      .select("role")
      .eq("role", role)
      .single();
    if (existing) {
      return NextResponse.json(
        { error: `agent ${role} already exists; edit it instead` },
        { status: 409 }
      );
    }

    // Insere
    const { data: created, error } = await svc
      .from("agent_definitions")
      .insert({
        role,
        name: body.name,
        stage: body.stage,
        model: body.model,
        system_prompt: body.system_prompt,
        sort_order: body.sort_order ?? 100,
        enabled: true,
        is_builtin: false,
        description: body.description ?? null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Deploy imediato no Claude
    let deployResult: any = { action: "skipped" };
    try {
      const spec = buildClaudeSpec({
        name: created.name,
        model: created.model,
        system_prompt: created.system_prompt,
      });
      const agent = await beta.agents.create(spec);
      await svc.from("agents").insert({
        role: created.role,
        claude_agent_id: agent.id,
        claude_agent_version: agent.version ?? 1,
        system_prompt_hash: hashPrompt(created.system_prompt),
      });
      deployResult = { action: "created", id: agent.id };
    } catch (e) {
      deployResult = {
        action: "failed",
        error: e instanceof Error ? e.message : String(e),
      };
    }

    return NextResponse.json({ agent: created, deploy: deployResult });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
