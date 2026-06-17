import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic } from "@/lib/claude";
import { getSquadSnapshot, snapshotAsText } from "@/lib/squad-snapshot";

export const runtime = "nodejs";
export const maxDuration = 90;

const ALLOWED_MODELS: Record<string, string> = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-7",
};

export async function POST(req: Request) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    const messages = (body.messages ?? []) as Array<{ role: "user" | "assistant"; content: string }>;
    const modelKey = (body.model as string) ?? "sonnet";
    const model = ALLOWED_MODELS[modelKey] ?? ALLOWED_MODELS.sonnet;
    if (!messages.length) {
      return NextResponse.json({ error: "messages obrigatório" }, { status: 400 });
    }

    const snap = await getSquadSnapshot(user.id);
    const snapshotText = snapshotAsText(snap);

    const system =
      `You are the Squad Assistant — a copilot that helps a human operator understand and steer the autonomous squad working on this team's features. ` +
      `Be direct, fast, and concrete. Reply in Portuguese (Brazil) by default; switch to English if the user does.\n\n` +
      `Always ground answers in the SQUAD STATE SNAPSHOT below. If the user asks something not covered by the snapshot, say what you do see and what you'd need to answer it.\n` +
      `For "how long until X finishes?" use the running card's elapsed time and the team's avg duration for that stage to estimate remaining. Be clear that it's an estimate.\n` +
      `For "which agent is processing?" name the agent role and model from the snapshot.\n` +
      `When you mention a card use its slug. Use short bullet lists. Keep currency formatting from the snapshot.\n\n` +
      `=== SQUAD STATE SNAPSHOT ===\n${snapshotText}\n=== END SNAPSHOT ===`;

    const res = await anthropic.messages.create({
      model,
      max_tokens: 1024,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });
    const text = res.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    return NextResponse.json({
      text,
      model,
      usage: res.usage ?? null,
      snapshot_summary: {
        running: snap.running.length,
        waiting_review: snap.waiting_review.length,
        queued: snap.queued.length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
