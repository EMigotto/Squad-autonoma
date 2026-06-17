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
 * Notifica o Teams que uma etapa AGUARDA revisão humana, com botões
 * Aprovar / Reprovar que abrem uma página de confirmação no app (sem exigir
 * bot). Best-effort.
 */
export async function notifyAwaitingReview(
  cardId: string,
  stage: string
): Promise<void> {
  try {
    const sb = createServiceClient();
    const { data: card } = await sb
      .from("cards")
      .select("id, feature:features(slug, title, project_id)")
      .eq("id", cardId)
      .maybeSingle();
    const feature = (card as any)?.feature;
    const projectId = feature?.project_id;
    if (!projectId) return;

    const { data: settings } = await sb
      .from("app_settings")
      .select("notification_teams_webhook, teams_command_token")
      .eq("project_id", projectId)
      .limit(1)
      .maybeSingle();
    const webhook = settings?.notification_teams_webhook?.trim();
    const token = settings?.teams_command_token?.trim();
    if (!webhook) return;

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const label = STAGE_LABEL[stage] ?? stage;

    const actions: any[] = [];
    if (appUrl && token) {
      actions.push({
        type: "Action.OpenUrl",
        title: "✅ Aprovar e avançar",
        url: `${appUrl}/teams/act?card=${encodeURIComponent(cardId)}&token=${encodeURIComponent(token)}&do=approve`,
      });
      actions.push({
        type: "Action.OpenUrl",
        title: "✋ Reprovar / pedir ajuste",
        url: `${appUrl}/teams/act?card=${encodeURIComponent(cardId)}&token=${encodeURIComponent(token)}&do=reject`,
      });
    }
    if (appUrl) {
      actions.push({
        type: "Action.OpenUrl",
        title: "abrir no board",
        url: `${appUrl}/?card=${encodeURIComponent(cardId)}`,
      });
    }

    const payload = {
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            type: "AdaptiveCard",
            version: "1.4",
            body: [
              {
                type: "TextBlock",
                size: "Medium",
                weight: "Bolder",
                wrap: true,
                color: "Warning",
                text: `⏸ Aguardando revisão: ${label}`,
              },
              {
                type: "TextBlock",
                wrap: true,
                text: `${feature.title} (${feature.slug}) concluiu a etapa de ${label} e aguarda sua aprovação para avançar.`,
              },
            ],
            actions,
          },
        },
      ],
    };

    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error("[notify] awaiting-review Teams card failed", e);
  }
}

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
