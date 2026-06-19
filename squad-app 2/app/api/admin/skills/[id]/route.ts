import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/lib/admin";
import { beta } from "@/lib/claude";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!(await isPlatformAdmin(user.id)))
    return NextResponse.json({ error: "apenas administradores podem excluir skills" }, { status: 403 });

  const svc = createServiceClient();
  const { data: skill } = await svc.from("skills_catalog").select("*").eq("id", params.id).maybeSingle();
  if (!skill) return NextResponse.json({ error: "skill não encontrada" }, { status: 404 });

  // remove do catálogo (associações caem por FK ON DELETE CASCADE)
  const { error } = await svc.from("skills_catalog").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // tenta remover do workspace se for custom (best effort; pré-build não se apaga)
  if (skill.source === "custom" && skill.skill_id) {
    try {
      if (beta?.skills?.delete) await beta.skills.delete(skill.skill_id);
      else {
        await fetch(`https://api.anthropic.com/v1/skills/${skill.skill_id}`, {
          method: "DELETE",
          headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "anthropic-beta": "skills-2025-10-02" },
        });
      }
    } catch (e) { console.error("[skills] delete no workspace falhou (ok)", e); }
  }
  return NextResponse.json({ ok: true });
}
