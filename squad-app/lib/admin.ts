import { createServiceClient } from "@/lib/supabase/server";

/**
 * Admin da plataforma = super admin (platform_admins) OU owner de algum time.
 * Super admins têm acesso total (ex.: ver SSO e o painel de atividade).
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const svc = createServiceClient();
  const { data: sa } = await svc
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (sa) return true;
  const { data: owner } = await svc
    .from("team_members")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();
  return !!owner;
}

export async function isSuperAdmin(userId: string): Promise<boolean> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data;
}
