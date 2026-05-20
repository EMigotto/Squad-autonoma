import { createClient, createServiceClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Board from "@/components/Board";

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

  // Usa service role para stages — evita problemas de RLS no startup
  const svc = createServiceClient();
  const { data: stagesData, error: stagesErr } = await svc
    .from("stages")
    .select("*")
    .order("sort_order");

  const stages =
    stagesData && stagesData.length > 0 ? stagesData : FALLBACK_STAGES;

  // Cards via cliente normal (RLS authenticated)
  const { data: cardsData, error: cardsErr } = await sb
    .from("cards")
    .select(
      `id, stage, status, claude_session_id, updated_at,
       feature:features ( id, slug, title, github_repo, claude_environment_id ),
       human_gates ( id, summary, decision, assignee_id )`
    )
    .order("updated_at", { ascending: false });

  const cards = cardsData ?? [];

  // Settings — pra propagar pro Board e mostrar avisos
  const { data: settings } = await svc
    .from("app_settings")
    .select("*")
    .eq("id", 1)
    .single();

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
      diagnostics={{
        stagesError: stagesErr?.message,
        cardsError: cardsErr?.message,
        stagesFromFallback: !stagesData || stagesData.length === 0,
      }}
    />
  );
}
