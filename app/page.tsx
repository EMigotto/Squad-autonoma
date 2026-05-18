import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Board from "@/components/Board";

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

  // Estado inicial do board (depois Realtime atualiza)
  const { data: stages } = await sb
    .from("stages")
    .select("*")
    .order("sort_order");

  const { data: cards } = await sb
    .from("cards")
    .select(
      `
      id, stage, status, claude_session_id, updated_at,
      feature:features ( id, slug, title ),
      human_gates ( id, summary, decision, assignee_id )
    `
    )
    .order("updated_at", { ascending: false });

  return (
    <Board
      currentUser={{ id: user.id, name: profile?.name ?? user.email!, role: profile?.role ?? "pm" }}
      initialStages={stages ?? []}
      initialCards={cards ?? []}
    />
  );
}
