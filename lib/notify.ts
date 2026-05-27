import { createServiceClient } from "@/lib/supabase/server";

const STAGE_LABEL: Record<string, string> = {
  discovery: "Discovery",
  planning: "Planejamento",
  development: "Desenvolvimento",
  qa: "Qualidade (QA)",
  done: "Concluído",
};

const STAGE_COLOR: Record<string, string> = {
  discovery: "Accent",
  planning: "Accent",
  development: "Warning",
  qa: "Good",
  done: "Good",
};

/**
 * Notifica o Teams do time que uma etapa da esteira foi concluída.
 * Best-effort: nunca lança (não pode quebrar o avanço do card).
 */
export async function notifyStageCompleted(
  cardId: string,
  completedStage: string,
  nextStage: string
): Promise<void> {
  try {
    const sb = createServiceClient();
    const { data: card } = await sb
      .from("cards")
      .select(
        "id, feature:features(slug, title, github_repo, project_id)"
      )
      .eq("id", cardId)
      .maybeSingle();
    const feature = (card as any)?.feature;
    const projectId = feature?.project_id;
    if (!projectId) return;

    const { data: settings } = await sb
      .from("app_settings")
      .select("notification_teams_webhook")
      .eq("project_id", projectId)
      .limit(1)
      .maybeSingle();
    const webhook = settings?.notification_teams_webhook?.trim();
    if (!webhook) return;

    // nomes de projeto/time para o cartão
    const { data: project } = await sb
      .from("projects")
      .select("name, sigla, team:teams(name)")
      .eq("id", projectId)
      .maybeSingle();
    const projectName = project?.name ?? "Projeto";
    const teamName = (project as any)?.team?.name ?? "—";

    const completedLabel = STAGE_LABEL[completedStage] ?? completedStage;
    const isDone = nextStage === "done";
    const nextLabel = STAGE_LABEL[nextStage] ?? nextStage;

    const card_payload = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: null,
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              {
                type: "TextBlock",
                size: "Medium",
                weight: "Bolder",
                text: isDone
                  ? `✅ Feature concluída: ${feature.title}`
                  : `✅ Etapa concluída: ${completedLabel}`,
                wrap: true,
                color: STAGE_COLOR[completedStage] ?? "Default",
              },
              {
                type: "FactSet",
                facts: [
                  { title: "Time", value: teamName },
                  { title: "Projeto", value: projectName },
                  { title: "Feature", value: `${feature.title} (${feature.slug})` },
                  { title: "Etapa concluída", value: completedLabel },
                  {
                    title: isDone ? "Status" : "Próxima etapa",
                    value: isDone ? "Entregue 🎉" : nextLabel,
                  },
                  { title: "Repositório", value: feature.github_repo ?? "—" },
                ],
              },
            ],
          },
        },
      ],
    };

    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(card_payload),
    });
  } catch (e) {
    console.error("[notify] Teams webhook failed", e);
  }
}
