import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 90;

const GH = "https://api.github.com";

async function resolveRepo(cardId: string) {
  const svc = createServiceClient();
  const { data: card } = await svc
    .from("cards")
    .select("feature:features(slug, github_repo)")
    .eq("id", cardId)
    .single();
  const feature = card?.feature as any;
  return {
    repo: feature?.github_repo as string | undefined,
    slug: feature?.slug as string | undefined,
  };
}

// GET: lista os PRs abertos relacionados à feature
export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const sb = createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { repo, slug } = await resolveRepo(params.id);
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) return NextResponse.json({ pulls: [] });

  const res = await fetch(`${GH}/repos/${repo}/pulls?state=open&per_page=100`, {
    headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!res.ok) return NextResponse.json({ pulls: [], error: `GitHub ${res.status}` });

  const items = await res.json();
  const norm = (slug ?? "").toLowerCase();
  const pulls = (Array.isArray(items) ? items : [])
    .filter((pr: any) => {
      const ref = (pr.head?.ref ?? "").toLowerCase();
      const title = (pr.title ?? "").toLowerCase();
      return ref.includes(norm) || title.includes(norm);
    })
    .map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      draft: pr.draft,
      head: pr.head?.ref,
      mergeable_state: pr.mergeable_state,
      html_url: pr.html_url,
      node_id: pr.node_id,
    }));

  return NextResponse.json({ pulls, repo });
}

// POST: mergeia os PRs informados (marca ready se draft, depois squash merge)
export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const sb = createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    const prNumbers: number[] = Array.isArray(body.pr_numbers)
      ? body.pr_numbers
      : [];
    if (prNumbers.length === 0) {
      return NextResponse.json({ error: "pr_numbers vazio" }, { status: 400 });
    }

    const { repo } = await resolveRepo(params.id);
    const token = process.env.GITHUB_TOKEN;
    if (!repo || !token) {
      return NextResponse.json({ error: "repo/token ausente" }, { status: 400 });
    }

    const results: any[] = [];
    for (const num of prNumbers) {
      try {
        // 1. Busca o PR pra saber se é draft e pegar node_id
        const prRes = await fetch(`${GH}/repos/${repo}/pulls/${num}`, {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github+json",
          },
        });
        if (!prRes.ok) {
          results.push({ number: num, status: "error", error: `GET ${prRes.status}` });
          continue;
        }
        const pr = await prRes.json();

        // 2. Se for draft, marca como ready via GraphQL
        if (pr.draft && pr.node_id) {
          const gql = await fetch(`${GH}/graphql`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              query: `mutation($id:ID!){ markPullRequestReadyForReview(input:{pullRequestId:$id}){ pullRequest { number } } }`,
              variables: { id: pr.node_id },
            }),
          });
          const gqlData = await gql.json();
          if (gqlData.errors) {
            results.push({
              number: num,
              status: "error",
              error: "falha ao marcar ready: " + JSON.stringify(gqlData.errors).slice(0, 150),
            });
            continue;
          }
        }

        // 3. Merge squash
        const mergeRes = await fetch(`${GH}/repos/${repo}/pulls/${num}/merge`, {
          method: "PUT",
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github+json",
          },
          body: JSON.stringify({ merge_method: "squash" }),
        });
        if (mergeRes.ok) {
          results.push({ number: num, status: "merged" });
        } else {
          const errBody = await mergeRes.json().catch(() => ({}));
          results.push({
            number: num,
            status: "error",
            error: `merge ${mergeRes.status}: ${errBody.message ?? ""}`.slice(0, 200),
          });
        }
      } catch (e) {
        results.push({
          number: num,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const merged = results.filter((r) => r.status === "merged").length;
    return NextResponse.json({ results, merged, total: prNumbers.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
