import { createClient, createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Board from "@/components/Board";
import { getActiveProjectId } from "@/lib/projects";

// Stages estáticos como fallback se a query falhar
const FALLBACK_STAGES = [
  { code: "discovery",   label: "Discovery",             sort_order: 10 },
  { code: "planning",    label: "Planejamento técnico",  sort_order: 20 },
  { code: "development", label: "Desenvolvimento",       sort_order: 30 },
  { code: "qa",          label: "Qualidade",             sort_order: 40 },
  { code: "done",        label: "Concluído",             sort_order: 50 },
];

export default async function BoardPage() {
  const sb = createClient();

  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await sb
    .from("user_profiles")
    .select("name, role")
    .eq("id", user.id)
    .single();

  const svc = createServiceClient();

  // Projeto ativo + lista de projetos pro seletor
  const activeProjectId = await getActiveProjectId(user.id);
  const { data: projects } = await svc
    .from("projects")
    .select("id, name, sigla, github_repo")
    .order("created_at", { ascending: true });

  const { data: stagesData, error: stagesErr } = await svc
    .from("stages")
    .select("*")
    .order("sort_order");

  const stages =
    stagesData && stagesData.length > 0 ? stagesData : FALLBACK_STAGES;

  // Cards filtrados pelo projeto ativo (via feature.project_id)
  let cards: any[] = [];
  let cardsErr: any = null;
  if (activeProjectId) {
    const { data: cardsData, error } = await sb
      .from("cards")
      .select(
        `id, stage, status, claude_session_id, updated_at,
         feature:features!inner ( id, slug, title, github_repo, claude_environment_id, project_id ),
         human_gates ( id, summary, decision, assignee_id )`
      )
      .eq("feature.project_id", activeProjectId)
      .order("updated_at", { ascending: false });
    cards = cardsData ?? [];
    cardsErr = error;
  }

  // Settings do projeto ativo
  const { data: settings } = await svc
    .from("app_settings")
    .select("*")
    .eq("project_id", activeProjectId)
    .limit(1)
    .maybeSingle();

  return (
    <Board
      currentUser={{
        id: user.id,
        name: profile?.name ?? user.email!,
        role: profile?.role ?? "pm",
      }}
      initialStages={stages}
      initialCards={cards}
      settings={settings}
      projects={projects ?? []}
      activeProjectId={activeProjectId}
      diagnostics={{
        stagesError: stagesErr?.message,
        cardsError: cardsErr?.message,
        stagesFromFallback: !stagesData || stagesData.length === 0,
        noProject: !activeProjectId,
      }}
    />
  );
}
