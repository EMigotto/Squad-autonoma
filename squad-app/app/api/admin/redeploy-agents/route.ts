import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";
import { redeployAllAgents } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Redeploy em massa: re-sincroniza TODOS os agentes do time ativo com o
 * Console, forçando o redeploy e atualizando as definitions builtin com os
 * prompts mais recentes do código (ex.: tradução pt-BR).
 * Body opcional: { refreshBuiltins?: boolean } (default true).
 */
export async function POST(req: Request) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY não configurada" },
        { status: 500 }
      );
    }

    const projectId = await getActiveProjectId(user.id);
    if (!projectId) {
      return NextResponse.json(
        { error: "nenhum time ativo. Selecione um time em /settings." },
        { status: 400 }
      );
    }

    let refreshBuiltins = true;
    let onlyRole: string | undefined;
    try {
      const body = await req.json();
      if (body?.refreshBuiltins === false) refreshBuiltins = false;
      if (body?.role) onlyRole = body.role;
    } catch {
      /* sem body, usa default */
    }

    const result = await redeployAllAgents(projectId, { refreshBuiltins, onlyRole });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
