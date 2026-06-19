import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const sb = createClient();
    await sb.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}/`);
}
