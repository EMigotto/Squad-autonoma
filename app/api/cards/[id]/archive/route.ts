import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Arquiva/desarquiva um card. Body: { archived: boolean }
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const archived = body.archived !== false; // default true
  const svc = createServiceClient();
  const { error } = await svc.from("cards").update({
    archived,
    archived_at: archived ? new Date().toISOString() : null,
  }).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
