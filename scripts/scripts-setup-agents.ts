/**
 * Cria ou atualiza todos os agents no Claude. Persiste mapping no Supabase.
 * Uso: npm run setup-agents
 * (Você também pode usar a página web /admin/setup — mesma funcionalidade.)
 */
import "dotenv/config";
import { beta } from "../lib/claude";
import {
  ALL_ROLES,
  buildSpec,
  hashPrompt,
  type AgentRole,
} from "../lib/agents";
import { createServiceClient } from "../lib/supabase/server";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

async function main() {
  const conventionsPath = resolve(process.cwd(), "CONVENTIONS.md");
  const conventions = existsSync(conventionsPath)
    ? readFileSync(conventionsPath, "utf-8")
    : "";

  const sb = createServiceClient();

  for (const role of ALL_ROLES) {
    const spec = buildSpec(role as AgentRole, conventions);
    const promptHash = hashPrompt(spec.system);

    const { data: existing } = await sb
      .from("agents")
      .select("claude_agent_id, system_prompt_hash")
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
      console.log(`[created] ${role} -> ${agent.id} v${agent.version ?? 1}`);
      continue;
    }

    if (existing.system_prompt_hash === promptHash) {
      console.log(
        `[no-op]   ${role} -> ${existing.claude_agent_id} (unchanged)`
      );
      continue;
    }

    const agent = await beta.agents.update(existing.claude_agent_id, spec);
    await sb.from("agents").update({ is_current: false }).eq("role", role);
    await sb.from("agents").insert({
      role,
      claude_agent_id: agent.id,
      claude_agent_version: agent.version,
      system_prompt_hash: promptHash,
    });
    console.log(`[updated] ${role} -> ${agent.id} v${agent.version}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
