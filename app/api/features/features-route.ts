import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createFeature, kickoffFirstStage } from "@/lib/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;

function errorToString(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export async function POST(req: Request) {
  try {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const required = ["slug", "title", "description", "github_repo"];
    for (const k of required) {
      if (!body[k]) {
        return NextResponse.json(
          { error: `missing required field: ${k}` },
          { status: 400 }
        );
      }
    }

    const attachmentPaths: string[] = Array.isArray(body.attachment_paths)
      ? body.attachment_paths
      : [];
    const attachmentFilenames: string[] = Array.isArray(body.attachment_filenames)
      ? body.attachment_filenames
      : [];

    try {
      // 1. Cria feature + card (NÃO dispara session ainda)
      const result = await createFeature({
        slug: body.slug,
        title: body.title,
        description: body.description,
        github_repo: body.github_repo,
        github_parent_issue: body.github_parent_issue ?? 0,
        created_by: user.id,
      });

      // 2. Persiste feature_attachments rows (antes de disparar agente)
      if (attachmentPaths.length > 0) {
        const svc = createServiceClient();
        const { error: attErr } = await svc.from("feature_attachments").insert(
          attachmentPaths.map((path, i) => ({
            feature_id: result.feature_id,
            filename: attachmentFilenames[i] ?? `attachment-${i + 1}.html`,
            content_type: "text/html",
            storage_path: path,
            uploaded_by: user.id,
          }))
        );
        if (attErr) {
          console.error("[POST /api/features] failed to insert attachments:", attErr);
          // Continua mesmo assim — feature está criada
        }
      }

      // 3. AGORA dispara o PM Agent (que vai ler os anexos)
      await kickoffFirstStage(result.card_id);

      return NextResponse.json(result);
    } catch (e) {
      console.error("[POST /api/features] createFeature failed:", e);
      const stack = e instanceof Error ? e.stack : undefined;
      return NextResponse.json(
        { error: errorToString(e), stack },
        { status: 500 }
      );
    }
  } catch (e) {
    console.error("[POST /api/features] global error:", e);
    return NextResponse.json({ error: errorToString(e) }, { status: 500 });
  }
}
