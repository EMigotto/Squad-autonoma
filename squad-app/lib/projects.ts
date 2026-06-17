import { createServiceClient } from "@/lib/supabase/server";

/**
 * Resolve o projeto ativo de um usuário (lido de user_profiles.active_project_id).
 * Se não houver, cai no primeiro projeto disponível.
 */
export async function getActiveProjectId(
  userId: string
): Promise<string | null> {
  const sb = createServiceClient();
  const { data: profile } = await sb
    .from("user_profiles")
    .select("active_project_id")
    .eq("id", userId)
    .single();

  if (profile?.active_project_id) return profile.active_project_id;

  // Fallback: primeiro projeto existente
  const { data: project } = await sb
    .from("projects")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  return project?.id ?? null;
}

export async function getProject(projectId: string) {
  const sb = createServiceClient();
  const { data } = await sb
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  return data;
}

export async function setActiveProject(
  userId: string,
  projectId: string
): Promise<void> {
  const sb = createServiceClient();
  await sb
    .from("user_profiles")
    .update({ active_project_id: projectId })
    .eq("id", userId);
}
