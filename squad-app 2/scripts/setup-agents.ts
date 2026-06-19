/**
 * CLI alternativo ao /admin/setup. Seeda os agentes builtin na tabela
 * agent_definitions e faz deploy no Claude.
 *
 * Uso (local): npx tsx scripts/setup-agents.ts
 * Requer env: ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * NOTA: esta pasta está excluída do type-check do Next (tsconfig "exclude").
 * O caminho recomendado de setup é a página /admin/setup ou o botão em /settings.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import {
  BUILTIN_AGENTS,
  buildClaudeSpec,
  hashPrompt,
} from "../lib/agents";

async function main() {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const beta: any = anthropic.beta;

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Seed das definitions
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

  // 2. Deploy de cada definition
  const { data: defs } = await sb
    .from("agent_definitions")
    .select("*")
    .eq("enabled", true);

  for (const def of defs ?? []) {
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
      console.log(`created ${def.role} -> ${agent.id}`);
    } else if (existing.system_prompt_hash !== promptHash) {
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
      console.log(`updated ${def.role} -> ${agent.id} v${agent.version}`);
    } else {
      console.log(`no-op ${def.role}`);
    }
  }

  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
