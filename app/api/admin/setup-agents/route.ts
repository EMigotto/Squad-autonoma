import { NextResponse } from "next/server";
import { beta } from "@/lib/claude";
import { BUILTIN_AGENTS, buildClaudeSpec, hashPrompt } from "@/lib/agents";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization");
    const bySecret = auth === `Bearer ${process.env.ADMIN_SECRET}`;

    // Aceita ou ADMIN_SECRET (CLI/admin) ou usuário logado (botão no /settings)
    let projectId: string | null = null;
    if (!bySecret) {
      const sb = createClient();
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (!user) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      projectId = await getActiveProjectId(user.id);
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY não configurada" },
        { status: 500 }
      );
    }

    const svc = createServiceClient();

    // Se veio por ADMIN_SECRET sem projeto, aplica a TODOS os projetos
    let projectIds: string[];
    if (projectId) {
      projectIds = [projectId];
    } else {
      const { data: allProjects } = await svc.from("projects").select("id");
      projectIds = (allProjects ?? []).map((p) => p.id);
      if (projectIds.length === 0) {
        return NextResponse.json(
          { error: "nenhum projeto encontrado. Crie um projeto primeiro." },
          { status: 400 }
        );
      }
    }

    const allResults: any[] = [];

    for (const pid of projectIds) {
      // 1. SEED: builtin agents no projeto (se ainda não existem)
      for (const a of BUILTIN_AGENTS) {
        await svc.from("agent_definitions").upsert(
          {
            project_id: pid,
            role: a.role,
            name: a.name,
            stage: a.stage,
            model: a.model,
            system_prompt: a.system_prompt,
            sort_order: a.sort_order,
            enabled: true,
            is_builtin: true,
            description: a.description,
          },
          { onConflict: "project_id,role", ignoreDuplicates: true }
        );
      }

      // 2. DEPLOY de cada definition do projeto
      const { data: definitions } = await svc
        .from("agent_definitions")
        .select("*")
        .eq("project_id", pid)
        .eq("enabled", true);

      for (const def of definitions ?? []) {
        try {
          const spec = buildClaudeSpec({
            name: def.name,
            model: def.model,
            system_prompt: def.system_prompt,
          });
          const promptHash = hashPrompt(def.system_prompt);

          const { data: existing } = await svc
            .from("agents")
            .select("claude_agent_id, system_prompt_hash, claude_agent_version")
            .eq("project_id", pid)
            .eq("role", def.role)
            .eq("is_current", true)
            .maybeSingle();

          if (!existing) {
            const agent = await beta.agents.create(spec);
            await svc.from("agents").insert({
              project_id: pid,
              role: def.role,
              claude_agent_id: agent.id,
              claude_agent_version: agent.version ?? 1,
              system_prompt_hash: promptHash,
            });
            allResults.push({ project: pid, role: def.role, action: "created" });
            continue;
          }

          if (existing.system_prompt_hash === promptHash) {
            allResults.push({ project: pid, role: def.role, action: "no-op" });
            continue;
          }

          const agent = await beta.agents.update(existing.claude_agent_id, {
            ...spec,
            version: existing.claude_agent_version,
          });
          await svc
            .from("agents")
            .update({ is_current: false })
            .eq("project_id", pid)
            .eq("role", def.role);
          await svc.from("agents").insert({
            project_id: pid,
            role: def.role,
            claude_agent_id: agent.id,
            claude_agent_version: agent.version,
            system_prompt_hash: promptHash,
          });
          allResults.push({ project: pid, role: def.role, action: "updated" });
        } catch (roleErr) {
          const msg =
            roleErr instanceof Error ? roleErr.message : String(roleErr);
          allResults.push({
            project: pid,
            role: def.role,
            action: "error",
            error: msg,
          });
        }
      }
    }

    return NextResponse.json({ results: allResults });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: msg, stack }, { status: 500 });
  }
}
