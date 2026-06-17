import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const svc = createServiceClient();
  const { data } = await svc
    .from("user_git_identity")
    .select("git_username, git_email, token_hint, updated_at")  // NUNCA retorna o token
    .eq("user_id", user.id)
    .maybeSingle();
  return NextResponse.json({ identity: data ?? null });
}

export async function PATCH(req: Request) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json();
  const username = String(body.git_username ?? "").trim();
  const email = String(body.git_email ?? "").trim();
  if (!username || !email)
    return NextResponse.json({ error: "git_username e git_email são obrigatórios" }, { status: 400 });

  const patch: any = {
    user_id: user.id,
    git_username: username,
    git_email: email,
    updated_at: new Date().toISOString(),
  };
  // só atualiza o token se um novo for enviado (não apaga ao salvar sem trocar)
  if (typeof body.git_token === "string" && body.git_token.trim()) {
    const tok = body.git_token.trim();
    patch.git_token = tok;
    patch.token_hint = "••••" + tok.slice(-4);
  }
  const svc = createServiceClient();
  const { error } = await svc.from("user_git_identity").upsert(patch, { onConflict: "user_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
