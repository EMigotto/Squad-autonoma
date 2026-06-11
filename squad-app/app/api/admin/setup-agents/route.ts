import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getActiveProjectId } from "@/lib/projects";
import { provisionTeamAgents } from "@/lib/orchestrator";

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
      const { results } = await provisionTeamAgents(pid);
      for (const r of results) allResults.push({ project: pid, ...r });
    }

    return NextResponse.json({ results: allResults });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: msg, stack }, { status: 500 });
  }
}
