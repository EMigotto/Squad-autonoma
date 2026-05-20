import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { beta } from "@/lib/claude";
import { buildClaudeSpec, hashPrompt } from "@/lib/agents";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function PATCH(
  req: Request,
  { params }: { params: { role: string } }
) {
  try {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    const svc = createServiceClient();

    const { data: existing } = await svc
      .from("agent_definitions")
      .select("*")
      .eq("role", params.role)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "agent not found" }, { status: 404 });
    }

    // Constrói patch (só campos editáveis)
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    const editable = [
      "name",
      "stage",
      "model",
      "system_prompt",
      "sort_order",
      "enabled",
      "description",
    ];
    for (const k of editable) {
      if (k in body) patch[k] = body[k];
    }

    const { data: updated, error } = await svc
      .from("agent_definitions")
      .update(patch)
      .eq("role", params.role)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Se o system_prompt mudou, faz deploy ao Claude
    let deployResult: any = { action: "skipped" };
    if (body.system_prompt && body.system_prompt !== existing.system_prompt) {
      try {
        const spec = buildClaudeSpec({
          name: updated.name,
          model: updated.model,
          system_prompt: updated.system_prompt,
        });
        const { data: currentDeploy } = await svc
          .from("agents")
          .select("claude_agent_id, claude_agent_version")
          .eq("role", params.role)
          .eq("is_current", true)
          .single();

        if (currentDeploy) {
          const agent = await beta.agents.update(currentDeploy.claude_agent_id, {
            ...spec,
            version: currentDeploy.claude_agent_version,
          });
          await svc
            .from("agents")
            .update({ is_current: false })
            .eq("role", params.role);
          await svc.from("agents").insert({
            role: params.role,
            claude_agent_id: agent.id,
            claude_agent_version: agent.version,
            system_prompt_hash: hashPrompt(updated.system_prompt),
          });
          deployResult = { action: "updated", id: agent.id, version: agent.version };
        } else {
          // Não tem deploy ainda — cria
          const agent = await beta.agents.create(spec);
          await svc.from("agents").insert({
            role: params.role,
            claude_agent_id: agent.id,
            claude_agent_version: agent.version ?? 1,
            system_prompt_hash: hashPrompt(updated.system_prompt),
          });
          deployResult = { action: "created", id: agent.id };
        }
      } catch (e) {
        deployResult = {
          action: "failed",
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }

    return NextResponse.json({ agent: updated, deploy: deployResult });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { role: string } }
) {
  try {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const svc = createServiceClient();

    const { data: existing } = await svc
      .from("agent_definitions")
      .select("is_builtin")
      .eq("role", params.role)
      .single();

    if (!existing) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (existing.is_builtin) {
      return NextResponse.json(
        { error: "agentes builtin não podem ser deletados, só desabilitados" },
        { status: 403 }
      );
    }

    // Arquiva no Claude se aplicável
    try {
      const { data: deployed } = await svc
        .from("agents")
        .select("claude_agent_id")
        .eq("role", params.role)
        .eq("is_current", true)
        .single();
      if (deployed) {
        // beta.agents.archive(...) — se a API tiver isso. Se não, só removemos
        // do nosso DB e o agent fica órfão no Claude (sem impacto).
        try {
          await beta.agents.archive(deployed.claude_agent_id);
        } catch {
          // ignora se não suportado
        }
      }
    } catch {
      // ok
    }

    await svc.from("agents").delete().eq("role", params.role);
    await svc.from("agent_definitions").delete().eq("role", params.role);

    return NextResponse.json({ status: "deleted" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
