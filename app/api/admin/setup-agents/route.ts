import { NextResponse } from "next/server";
import { beta } from "@/lib/claude";
import {
  ALL_ROLES,
  buildSpec,
  hashPrompt,
  type AgentRole,
} from "@/lib/agents";
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
        { error: "ANTHROPIC_API_KEY não está configurada nas env vars" },
        { status: 500 }
      );
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "SUPABASE_SERVICE_ROLE_KEY não está configurada" },
        { status: 500 }
      );
    }

    const sb = createServiceClient();
    const results: Array<{
      role: string;
      action: string;
      id?: string;
      version?: number;
      error?: string;
    }> = [];

    for (const role of ALL_ROLES) {
      try {
        const spec = buildSpec(role as AgentRole);
        const promptHash = hashPrompt(spec.system);

        // INCLUI claude_agent_version no select — necessário pro update
        const { data: existing } = await sb
          .from("agents")
          .select("claude_agent_id, system_prompt_hash, claude_agent_version")
          .eq("role", role)
          .eq("is_current", true)
          .single();

        if (!existing) {
          const agent = await beta.agents.create(spec);
          await sb.from("agents").insert({
            role,
            claude_agent_id: agent.id,
            claude_agent_version: agent.version ?? 1,
            system_prompt_hash: promptHash,
          });
          results.push({
            role,
            action: "created",
            id: agent.id,
            version: agent.version ?? 1,
          });
          continue;
        }

        if (existing.system_prompt_hash === promptHash) {
          results.push({
            role,
            action: "no-op",
            id: existing.claude_agent_id,
            version: existing.claude_agent_version,
          });
          continue;
        }

        // PASSA version no update — optimistic lock que a API exige
        const agent = await beta.agents.update(existing.claude_agent_id, {
          ...spec,
          version: existing.claude_agent_version,
        });

        await sb
          .from("agents")
          .update({ is_current: false })
          .eq("role", role);
        await sb.from("agents").insert({
          role,
          claude_agent_id: agent.id,
          claude_agent_version: agent.version,
          system_prompt_hash: promptHash,
        });
        results.push({
          role,
          action: "updated",
          id: agent.id,
          version: agent.version,
        });
      } catch (roleErr) {
        const msg = roleErr instanceof Error ? roleErr.message : String(roleErr);
        console.error(`[setup-agents] erro no role=${role}:`, roleErr);
        results.push({ role, action: "error", error: msg });
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
