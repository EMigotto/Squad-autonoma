import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Upload de anexos SERVER-SIDE para o Supabase Storage. O browser envia o
 * arquivo (multipart) para esta rota, que grava via service role. Isso evita
 * o erro de CORS que ocorria ao subir direto do browser para o Storage em
 * domínios não cadastrados nas CORS origins do projeto Supabase.
 */
export async function POST(req: Request) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "arquivo ausente" }, { status: 400 });

    const MAX = 50 * 1024 * 1024; // 50MB
    if (file.size > MAX) {
      return NextResponse.json({ error: "arquivo acima de 50MB" }, { status: 413 });
    }

    const safeName = file.name.replace(/[^\w.\-]+/g, "_");
    const path = `${user.id}/${Date.now()}-${safeName}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    const svc = createServiceClient();
    const { error: upErr } = await svc.storage
      .from("feature-attachments")
      .upload(path, bytes, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });

    if (upErr) {
      return NextResponse.json(
        { error: `falha no upload: ${upErr.message}` },
        { status: 500 }
      );
    }
    return NextResponse.json({ path });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
