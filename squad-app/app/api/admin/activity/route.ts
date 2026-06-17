import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/admin";

export const runtime = "nodejs";

/** Painel de atividade: quem logou, quando, e quantos times/boards criou. */
export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isPlatformAdmin(user.id)))
    return NextResponse.json({ error: "acesso restrito a administradores" }, { status: 403 });

  const svc = createServiceClient();
  const { data, error } = await svc
    .from("platform_activity")
    .select("*")
    .order("last_sign_in_at", { ascending: false, nullsFirst: false });

  if (error) {
    // fallback se a view não existir ainda
    return NextResponse.json({ rows: [], error: error.message });
  }
  return NextResponse.json({ rows: data ?? [] });
}
