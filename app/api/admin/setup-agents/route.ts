import { NextResponse } from "next/server";
import { beta } from "@/lib/claude";
import { BUILTIN_AGENTS, buildClaudeSpec, hashPrompt } from "@/lib/agents";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${process.env.ADMIN_SECRET}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY não configurada" },
        { status: 500 }
      );
    }

    const sb = createServiceClient();

    // 1. SEED: insere builtin agents em agent_definitions se ainda não estão lá
    for (const a of BUILTIN_AGENTS) {
      await sb.from("agent_definitions").upsert(
        {
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
        { onConflict: "role", ignoreDuplicates: true }
      );
    }

    // 2. DEPLOY: pega TODAS as agent_definitions (builtin + custom) e sincroniza com Claude
    const { data: definitions } = await sb
      .from("agent_definitions")
      .select("*")
      .eq("enabled", true);

    if (!definitions) {
      return NextResponse.json(
        { error: "failed to load agent_definitions" },
        { status: 500 }
      );
    }

    const results: Array<{
      role: string;
      action: string;
      id?: string;
      version?: number;
      error?: string;
    }> = [];

    for (const def of definitions) {
      try {
        const spec = buildClaudeSpec({
          name: def.name,
          model: def.model,
          system_prompt: def.system_prompt,
        });
        const promptHash = hashPrompt(def.system_prompt);

        const { data: existing } = await sb
          .from("agents")
          .select("claude_agent_id, system_prompt_hash, claude_agent_version")
          .eq("role", def.role)
          .eq("is_current", true)
          .single();

        if (!existing) {
          const agent = await beta.agents.create(spec);
          await sb.from("agents").insert({
            role: def.role,
            claude_agent_id: agent.id,
            claude_agent_version: agent.version ?? 1,
            system_prompt_hash: promptHash,
          });
          results.push({
            role: def.role,
            action: "created",
            id: agent.id,
            version: agent.version ?? 1,
          });
          continue;
        }

        if (existing.system_prompt_hash === promptHash) {
          results.push({
            role: def.role,
            action: "no-op",
            id: existing.claude_agent_id,
            version: existing.claude_agent_version,
          });
          continue;
        }

        const agent = await beta.agents.update(existing.claude_agent_id, {
          ...spec,
          version: existing.claude_agent_version,
        });
        await sb.from("agents").update({ is_current: false }).eq("role", def.role);
        await sb.from("agents").insert({
          role: def.role,
          claude_agent_id: agent.id,
          claude_agent_version: agent.version,
          system_prompt_hash: promptHash,
        });
        results.push({
          role: def.role,
          action: "updated",
          id: agent.id,
          version: agent.version,
        });
      } catch (roleErr) {
        const msg = roleErr instanceof Error ? roleErr.message : String(roleErr);
        console.error(`[setup-agents] erro no role=${def.role}:`, roleErr);
        results.push({ role: def.role, action: "error", error: msg });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[setup-agents] erro global:", err);
    return NextResponse.json({ error: msg, stack }, { status: 500 });
  }
}
