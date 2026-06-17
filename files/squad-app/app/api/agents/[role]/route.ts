import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { beta } from "@/lib/claude";
import { buildClaudeSpec, hashPrompt } from "@/lib/agents";
import { getActiveProjectId } from "@/lib/projects";

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

    const projectId = await getActiveProjectId(user.id);
    if (!projectId)
      return NextResponse.json({ error: "nenhum projeto ativo" }, { status: 400 });

    const body = await req.json();
    const svc = createServiceClient();

    const { data: existing } = await svc
      .from("agent_definitions")
      .select("*")
      .eq("project_id", projectId)
      .eq("role", params.role)
      .maybeSingle();
    if (!existing)
      return NextResponse.json({ error: "agent not found" }, { status: 404 });

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    const editable = [
      "name",
      "stage",
      "model",
      "system_prompt",
      "sort_order",
      "enabled",
      "description",
    ];
    for (const k of editable) if (k in body) patch[k] = body[k];

    const { data: updated, error } = await svc
      .from("agent_definitions")
      .update(patch)
      .eq("project_id", projectId)
      .eq("role", params.role)
      .select()
      .single();
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    let deployResult: any = { action: "skipped" };
    const nameChanged = "name" in body && body.name !== existing.name;
    const modelChanged = "model" in body && body.model !== existing.model;
    const promptChanged =
      "system_prompt" in body && body.system_prompt !== existing.system_prompt;
    if (nameChanged || modelChanged || promptChanged) {
      try {
        const spec = buildClaudeSpec({
          name: updated.name,
          model: updated.model,
          system_prompt: updated.system_prompt,
        });
        const { data: currentDeploy } = await svc
          .from("agents")
          .select("claude_agent_id, claude_agent_version")
          .eq("project_id", projectId)
          .eq("role", params.role)
          .eq("is_current", true)
          .maybeSingle();

        if (currentDeploy) {
          // Evita 409 "Concurrent modification": a versão local pode estar
          // defasada em relação ao Console. Busca a versão atual lá e tenta
          // o update; se mesmo assim der conflito, re-busca e tenta de novo.
          const updateWithRetry = async () => {
            let lastErr: any = null;
            for (let attempt = 0; attempt < 3; attempt++) {
              let version = currentDeploy.claude_agent_version;
              try {
                const fresh = await beta.agents.retrieve(currentDeploy.claude_agent_id);
                if (fresh?.version != null) version = fresh.version;
              } catch {
                /* se não conseguir buscar, usa a versão local */
              }
              try {
                return await beta.agents.update(currentDeploy.claude_agent_id, {
                  ...spec,
                  version,
                });
              } catch (e: any) {
                lastErr = e;
                const status = e?.status ?? e?.statusCode;
                const msg = String(e?.message ?? e);
                const isConflict = status === 409 || /concurrent|conflict|version/i.test(msg);
                if (!isConflict) throw e;
                // backoff curto antes de re-tentar com versão fresca
                await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
              }
            }
            throw lastErr ?? new Error("falha ao atualizar agente após retries");
          };
          const agent = await updateWithRetry();
          await svc
            .from("agents")
            .update({ is_current: false })
            .eq("project_id", projectId)
            .eq("role", params.role);
          await svc.from("agents").insert({
            project_id: projectId,
            role: params.role,
            claude_agent_id: agent.id,
            claude_agent_version: agent.version,
            model: updated.model,
            system_prompt_hash: hashPrompt(updated.system_prompt),
          });
          deployResult = { action: "updated", id: agent.id, version: agent.version };
        } else {
          const agent = await beta.agents.create(spec);
          await svc.from("agents").insert({
            project_id: projectId,
            role: params.role,
            claude_agent_id: agent.id,
            claude_agent_version: agent.version ?? 1,
            model: updated.model,
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

    const projectId = await getActiveProjectId(user.id);
    if (!projectId)
      return NextResponse.json({ error: "nenhum projeto ativo" }, { status: 400 });

    const svc = createServiceClient();
    const { data: existing } = await svc
      .from("agent_definitions")
      .select("is_builtin")
      .eq("project_id", projectId)
      .eq("role", params.role)
      .maybeSingle();
    if (!existing)
      return NextResponse.json({ error: "not found" }, { status: 404 });
    if (existing.is_builtin)
      return NextResponse.json(
        { error: "agentes builtin não podem ser deletados, só desabilitados" },
        { status: 403 }
      );

    await svc
      .from("agents")
      .delete()
      .eq("project_id", projectId)
      .eq("role", params.role);
    await svc
      .from("agent_definitions")
      .delete()
      .eq("project_id", projectId)
      .eq("role", params.role);

    return NextResponse.json({ status: "deleted" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
