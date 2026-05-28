import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST { text, target: "pt" | "en" }
 * Traduz preservando estrutura Markdown e nomes técnicos.
 */
export async function POST(req: Request) {
  try {
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { text, target } = await req.json();
    if (typeof text !== "string" || !text.trim())
      return NextResponse.json({ error: "text obrigatório" }, { status: 400 });
    const tgt = target === "pt" ? "Portuguese (Brazil)" : "English";

    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content:
            `Translate the following Markdown document into ${tgt}.\n` +
            `STRICT RULES:\n` +
            `- Preserve Markdown structure exactly (headers, lists, code fences, links, tables).\n` +
            `- Do NOT translate code blocks, identifiers, file paths, URLs, branch names, env vars.\n` +
            `- Do NOT add commentary. Output ONLY the translated document.\n\n` +
            `--- DOCUMENT ---\n${text}\n--- END ---`,
        },
      ],
    });

    const translated = res.content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    return NextResponse.json({ translated, target: target === "pt" ? "pt" : "en" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
