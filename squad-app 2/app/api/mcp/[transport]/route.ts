import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import {
  userIdFromMcpToken,
  activeProjectFor,
  listCards,
  buildCardContext,
} from "@/lib/mcp-context";

export const runtime = "nodejs";
export const maxDuration = 60;

const handler = createMcpHandler(
  (server) => {
    // Fase 1 — LEITURA: listar cards do projeto ativo
    server.tool(
      "squad_list_cards",
      "Lista os cards da Squad Autônoma no projeto ativo do desenvolvedor. " +
        "Use para ver o que está em andamento e escolher um card para trabalhar. " +
        "Por padrão mostra a etapa de desenvolvimento.",
      {
        stage: z
          .enum(["discovery", "planning", "development", "qa", "done", "all"])
          .optional()
          .describe("Filtra por etapa. 'all' para todas. Default: development."),
      },
      async ({ stage }, { authInfo }) => {
        const userId = (authInfo?.extra?.userId as string) ?? null;
        if (!userId)
          return { content: [{ type: "text", text: "Não autenticado." }] };
        const project = await activeProjectFor(userId);
        if (!project)
          return { content: [{ type: "text", text: "Nenhum projeto ativo." }] };
        const filter = !stage || stage === "all" ? undefined : stage;
        const cards = await listCards(project.id, filter ?? "development");
        const header = `Projeto ativo: ${project.name} [${project.sigla}]\nRepo padrão: ${project.github_repo}\n\n`;
        if (cards.length === 0)
          return {
            content: [
              { type: "text", text: header + "Nenhum card nesta etapa." },
            ],
          };
        const lines = cards
          .map(
            (c) =>
              `• [${c.stage}/${c.status}] ${c.title} (${c.slug})\n  card_id: ${c.card_id} · repo: ${c.repo}`
          )
          .join("\n");
        return { content: [{ type: "text", text: header + lines }] };
      }
    );

    // Fase 1 — LEITURA: contexto completo de um card
    server.tool(
      "squad_get_context",
      "Traz para a sessão todo o contexto de um card: descrição, contexto do " +
        "projeto (tipo, stack, instruções, conhecimento, áreas sensíveis, repos), " +
        "chunks e os documentos (PRD, ADR/SPEC, critérios de aceite Gherkin, ordem " +
        "de build). Use antes de começar a implementar. Aceita card_id ou slug.",
      {
        card: z.string().describe("O card_id (uuid) ou o slug da feature."),
      },
      async ({ card }, { authInfo }) => {
        const userId = (authInfo?.extra?.userId as string) ?? null;
        if (!userId)
          return { content: [{ type: "text", text: "Não autenticado." }] };
        const project = await activeProjectFor(userId);
        if (!project)
          return { content: [{ type: "text", text: "Nenhum projeto ativo." }] };
        const text = await buildCardContext(project, card);
        return { content: [{ type: "text", text }] };
      }
    );
  },
  {},
  { basePath: "/api/mcp", maxDuration: 60, verboseLogs: false }
);

// Autenticação por bearer token (token MCP do desenvolvedor)
const authHandler = withMcpAuth(
  handler,
  async (_req, bearer) => {
    if (!bearer) return undefined;
    const userId = await userIdFromMcpToken(bearer);
    if (!userId) return undefined;
    return {
      token: bearer,
      scopes: ["squad:read"],
      clientId: userId,
      extra: { userId },
    };
  },
  { required: true }
);

export { authHandler as GET, authHandler as POST };
