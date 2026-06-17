import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSquadSnapshot } from "@/lib/squad-snapshot";

export const runtime = "nodejs";

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const snap = await getSquadSnapshot(user.id);
  return NextResponse.json(snap);
}
