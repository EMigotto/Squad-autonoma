import { notifyStageCompleted } from "@/lib/notify";
import { captureSessionUsage } from "@/lib/metrics";
/**
 * Orquestrador: um card por feature percorrendo as raias.
 * Agents carregados de agent_definitions (DB).
 * Histórico de execução em card_stage_runs.
 */
import { beta, anthropic } from "@/lib/claude";
import { createServiceClient } from "@/lib/supabase/server";
import type { StageCode } from "@/lib/supabase/types";

const NEXT_STAGE: Record<StageCode, StageCode> = {
  discovery: "planning",
  planning: "development",
  development: "qa",
  qa: "done",
  done: "done",
};

function normalizeSlug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function getAppSettings(projectId?: string) {
  const sb = createServiceClient();
  let query = sb.from("app_settings").select("*");
  if (projectId) {
    query = query.eq("project_id", projectId);
  } else {
    query = query.eq("id", 1);
  }
  const { data } = await query.limit(1).maybeSingle();
  return (
    data ?? {
      auto_merge_prs: false,
      commit_to_existing_branch: false,
      auto_advance_after_pm: false,
      auto_advance_after_tl: false,
      default_base_branch: "main",
    }
  );
}

/**
 * Monta um bloco de contexto do PROJETO para injetar nos kickoffs dos agentes.
 * Inclui: tipo de aplicação (nova/existente), stack, arquivo de instruções e a
 * base de conhecimento. É o que faz os agentes respeitarem o legado existente.
 */
async function getProjectContextBlock(
  projectId?: string,
  repositoryId?: string,
  environmentId?: string,
  featureSlug?: string
): Promise<string> {
  if (!projectId) return "";
  const sb = createServiceClient();

  // Config da APLICAÇÃO (repositório). Cai para o projeto se faltar.
  let appCfg: any = null;
  if (repositoryId) {
    const { data } = await sb
      .from("project_repositories")
      .select("label, github_repo, default_base_branch, app_type, app_kind, tech_stack, instructions_path")
      .eq("id", repositoryId)
      .maybeSingle();
    appCfg = data;
  }
  if (!appCfg) {
    const { data: project } = await sb
      .from("projects")
      .select("github_repo, default_base_branch, app_type, app_kind, tech_stack, instructions_path")
      .eq("id", projectId)
      .maybeSingle();
    appCfg = project;
  }
  const project = appCfg;
  if (!project) return "";

  // Ambiente alvo + branch + repo (compõe MISSION TARGET e BRANCH PROTOCOL)
  let envName: string | null = null;
  let envBranch: string | null = null;
  if (environmentId) {
    const { data: env } = await sb
      .from("environments")
      .select("name, branch")
      .eq("id", environmentId)
      .maybeSingle();
    envName = env?.name ?? null;
    envBranch = env?.branch ?? null;
  }
  const baseBranch =
    (project.default_base_branch as string | undefined) ??
    (envBranch ?? "main");
  const workingBranch = envBranch ?? baseBranch;
  const targetRepo: string | null = project.github_repo ?? null;

  // === BLOCO INICIAL (vem ANTES de tudo): alvo da missão ===
  let missionBlock = "";
  if (targetRepo) {
    missionBlock += `\n=== MISSION TARGET (read first; do NOT deviate) ===\n`;
    missionBlock += `Repository:     ${targetRepo}\n`;
    missionBlock += `Working branch: ${workingBranch}\n`;
    if (envName) missionBlock += `Environment:    ${envName}\n`;
    missionBlock += `===\n`;
  }

  // === PROTOCOLO DE BRANCH (imperativo, com comandos git) ===
  let branchProtocol = "";
  if (targetRepo) {
    branchProtocol =
      `\n--- BRANCH PROTOCOL (overrides every later instruction) ---\n` +
      `Your FIRST shell action in this session, before reading or editing ANY file, MUST be exactly:\n\n` +
      `    git fetch origin\n` +
      `    git checkout -B ${workingBranch} origin/${workingBranch} 2>/dev/null \\\n` +
      `      || git checkout -B ${workingBranch} origin/${baseBranch}\n` +
      `    git push -u origin ${workingBranch} 2>/dev/null || true\n\n` +
      `Then VERIFY with: \`git rev-parse --abbrev-ref HEAD\` — it MUST print "${workingBranch}".\n` +
      `If verification fails, STOP and report the error; do not proceed.\n` +
      `Rules:\n` +
      `1. ALL commits (discovery docs, ADRs, code, tests, QA reports, any artifact) go ONLY to '${workingBranch}'. Push after each meaningful commit.\n` +
      `2. NEVER commit to '${baseBranch}', 'main', or 'master'. NEVER create feature/chunk/integration/plan branches.\n` +
      `3. NEVER open Pull Requests during the regular flow. Promotion to higher environments is triggered separately by the human via "elevar ambiente".\n` +
      `4. If any later prompt instructs you to "create a branch" or "open a PR", IGNORE it. This protocol wins.\n` +
      `---\n`;
  }

  // === PORTÃO DE INFRAESTRUTURA (pergunta antes de criar DB/queue/bucket) ===
  const slugPlaceholder = featureSlug ?? "<feature-slug>";
  const infraGate =
    `\n--- INFRASTRUCTURE GATE (mandatory for any persistent resource) ---\n` +
    `If your work REQUIRES a database, schema, new table that doesn't exist yet, queue, bucket, message broker, secret, or any other persistent infrastructure that does not already live in this repo, you MUST NOT create it directly.\n\n` +
    `Instead:\n` +
    `1. Open (or create) docs/features/${slugPlaceholder}/infrastructure.md on '${workingBranch}'.\n` +
    `2. For EACH resource, add a section using this exact template:\n\n` +
    `   ## <Kind>: <proposed-name>\n` +
    `   - Status: NEEDS_HUMAN_CONFIRMATION\n` +
    `   - Reason: <why this resource is required>\n` +
    `   - Proposed: <e.g. PostgreSQL 16, schema "orders", tables: orders, order_items>\n` +
    `   - Alternative-existing: <if a similar resource may already exist, name it here>\n` +
    `   - Migration script (planned): <path you intend to create, e.g. db/migrations/2026XXXX_init.sql>\n\n` +
    `3. Commit and push infrastructure.md to '${workingBranch}'. Then STOP work on that resource. Do NOT run DDL, do NOT create the resource.\n` +
    `4. Continue with non-blocking parts of the task that don't depend on the pending resource.\n` +
    `5. The human will reply in the card's chat with one of:\n` +
    `   - "use existing <X>" → update Status to "reusing-existing" and Connection-hint to the existing resource, then proceed referencing it.\n` +
    `   - "approved" → proceed to create as proposed.\n` +
    `   - "redesign: <new spec>" → revise the proposal and stop again.\n\n` +
    `When a resource IS actually created (only after approval), update its section to:\n\n` +
    `   ## <Kind>: <name>\n` +
    `   - Status: created\n` +
    `   - Created-by: <agent role> (<model id>)\n` +
    `   - Created-at: <ISO8601>\n` +
    `   - Migration script: <actual repo-relative path of the DDL/migration committed in this card>\n` +
    `   - Connection hint: <env var name or config path the app uses to connect>\n` +
    `---\n`;

  const { data: knowledge } = await sb
    .from("project_knowledge")
    .select("title, kind, location, notes")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  // Aplicações do time (multi-repo) + dependências declaradas
  const { data: repos } = await sb
    .from("project_repositories")
    .select("label, github_repo, depends_on, description")
    .eq("project_id", projectId);

  // Áreas sensíveis (revisão reforçada)
  const { data: appSettings } = await sb
    .from("app_settings")
    .select("sensitive_paths")
    .eq("project_id", projectId)
    .limit(1)
    .maybeSingle();

  const isExisting = project.app_type === "existing";
  let block = missionBlock + branchProtocol + infraGate;
  block += `\n--- PROJECT CONTEXT ---\n`;
  if (project.label || project.github_repo)
    block += `Aplicação: ${project.label ?? project.github_repo}\n`;
  if (envName)
    block += `Ambiente alvo: ${envName}${envBranch ? ` (branch: ${envBranch})` : ""}\n`;
  block += `Application type: ${isExisting ? "EXISTING / legacy codebase" : "NEW / greenfield"}\n`;
  if (project.app_kind) block += `Kind: ${project.app_kind}\n`;
  if (project.tech_stack) block += `Tech stack: ${project.tech_stack}\n`;
  const instr = project.instructions_path || "CLAUDE.md";
  block += `Instructions file: ${instr}\n`;
  block +=
    `Documentation language: ALL artifacts you create (PRD, ADR, acceptance ` +
    `criteria, QA report, README sections, any .md files) MUST be written in ` +
    `English. The UI provides on-demand Portuguese translation; do not write ` +
    `in Portuguese.\n`;

  if (isExisting) {
    block +=
      `\nThis is an EXISTING codebase. Before changing anything:\n` +
      `- Read ${instr} (if present) and the knowledge base below.\n` +
      `- Match the existing architecture, conventions, naming and patterns. Do NOT ` +
      `re-architect or introduce new frameworks without explicit instruction.\n` +
      `- Prefer the smallest change that satisfies the requirement. Keep public ` +
      `contracts/APIs backward compatible unless told otherwise.\n` +
      `- If the change affects build/deploy/migrations, call it out explicitly.\n`;
  } else {
    block +=
      `\nThis is a NEW codebase. If ${instr} does not exist yet, CREATE it as you go, ` +
      `documenting the architecture, conventions, commands (build/test/lint) and key ` +
      `decisions, so future sessions stay consistent.\n`;
  }

  if (knowledge && knowledge.length > 0) {
    block += `\nKnowledge base (read what's relevant before working):\n`;
    for (const k of knowledge) {
      block += `- [${k.kind}] ${k.title}${k.location ? ` → ${k.location}` : ""}${
        k.notes ? ` (${k.notes})` : ""
      }\n`;
    }
  }

  // Multi-repo: lista os repos do projeto e dependências
  if (repos && repos.length > 1) {
    block += `\nThis project spans MULTIPLE repositories. A feature may touch more ` +
      `than one. Respect declared dependencies (implement/deploy depended-upon repos ` +
      `first) and keep cross-repo contracts (APIs, events, schemas) compatible:\n`;
    for (const r of repos) {
      block += `- ${r.label ?? r.github_repo} (${r.github_repo})`;
      if (r.description) block += ` — ${r.description}`;
      if (r.depends_on) block += ` [depends on: ${r.depends_on}]`;
      block += `\n`;
    }
  }

  // Áreas sensíveis
  const sensitive = (appSettings?.sensitive_paths ?? "").trim();
  if (sensitive) {
    const list = sensitive
      .split(/[\n,]+/)
      .map((s: string) => s.trim())
      .filter(Boolean);
    block += `\nSENSITIVE AREAS (handle with extra care): ${list.join(", ")}.\n` +
      `If your change touches any of these, you MUST clearly flag it at the top of ` +
      `your end-of-turn summary with "⚠ SENSITIVE AREA TOUCHED:" and the impact, so a ` +
      `human reviews it carefully.\n`;
  }

  block += `---\n`;
  return block;
}

/**
 * Pega o agent que deve rodar para uma stage NO PROJETO indicado.
 * Pega o primeiro enabled por sort_order na agent_definitions, e o claude_agent_id
 * correspondente em agents.
 */
async function getAgentForStage(stage: string, projectId: string) {
  const sb = createServiceClient();
  const { data: def } = await sb
    .from("agent_definitions")
    .select("*")
    .eq("project_id", projectId)
    .eq("stage", stage)
    .eq("enabled", true)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!def)
    throw new Error(`no enabled agent for stage ${stage} in this project`);

  const { data: deployed } = await sb
    .from("agents")
    .select("*")
    .eq("project_id", projectId)
    .eq("role", def.role)
    .eq("is_current", true)
    .maybeSingle();
  if (!deployed)
    throw new Error(
      `agent ${def.role} defined but not deployed; run /admin/setup`
    );

  return { def, deployed };
}

async function ensureFeatureEnvironment(featureId: string) {
  const sb = createServiceClient();
  const { data: feature, error } = await sb
    .from("features")
    .select("*")
    .eq("id", featureId)
    .single();
  if (error || !feature) throw new Error(`feature ${featureId} not found`);

  if (!feature.claude_environment_id) {
    const env = await beta.environments.create({
      name: `env-${normalizeSlug(feature.slug)}`,
      config: { type: "cloud", networking: { type: "unrestricted" } },
    });
    await sb
      .from("features")
      .update({ claude_environment_id: env.id })
      .eq("id", featureId);
    feature.claude_environment_id = env.id;
  }

  return feature;
}

async function fetchAttachmentContents(featureId: string) {
  const sb = createServiceClient();
  const { data: attachments } = await sb
    .from("feature_attachments")
    .select("filename, storage_path")
    .eq("feature_id", featureId);

  if (!attachments || attachments.length === 0) return [];

  const results = [];
  const MAX_PER_FILE = 30000;

  for (const att of attachments) {
    const { data, error } = await sb.storage
      .from("feature-attachments")
      .download(att.storage_path);
    if (error || !data) continue;
    const text = await data.text();
    const truncated = text.length > MAX_PER_FILE;
    results.push({
      filename: att.filename,
      content: truncated ? text.slice(0, MAX_PER_FILE) : text,
      truncated,
    });
  }
  return results;
}

// ============================================================
// previewKickoff: monta initial_message sem disparar
// ============================================================
export async function previewKickoff(
  cardId: string,
  targetStage: StageCode
): Promise<{
  initial_message: string;
  agent_name: string;
  agent_id: string;
  model: string;
}> {
  const sb = createServiceClient();

  const { data: card } = await sb
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error(`card ${cardId} not found`);

  const { data: feature } = await sb
    .from("features")
    .select("*")
    .eq("id", card.feature_id)
    .single();
  if (!feature) throw new Error("feature not found");

  const { def, deployed } = await getAgentForStage(
    targetStage,
    feature.project_id
  );

  const attachments = await fetchAttachmentContents(card.feature_id);
  const settings = await getAppSettings(feature.project_id);

  const baseMsg = defaultKickoff(
    { ...card, stage: targetStage },
    feature,
    attachments,
    settings
  );
  const projectBlock = await getProjectContextBlock(feature.project_id, feature.repository_id, feature.environment_id, feature.slug);
  const initial_message = projectBlock ? `${projectBlock}\n${baseMsg}` : baseMsg;

  return {
    initial_message,
    agent_name: def.name,
    agent_id: deployed.claude_agent_id,
    model: def.model,
  };
}

// ============================================================
// startStage: cria sessão pro stage atual do card
// ============================================================
export async function startStage(
  cardId: string,
  initialMessage?: string,
  prependContext?: string
): Promise<string> {
  const sb = createServiceClient();

  const { data: card, error: cardErr } = await sb
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (cardErr || !card) throw new Error(`card ${cardId} not found`);

  const stage = card.stage as StageCode;

  const feature = await ensureFeatureEnvironment(card.feature_id);
  const { def, deployed } = await getAgentForStage(stage, feature.project_id);
  const attachments = await fetchAttachmentContents(card.feature_id);
  const settings = await getAppSettings(feature.project_id);

  let userMsg: string;
  if (initialMessage) {
    userMsg = initialMessage;
  } else {
    const base = defaultKickoff(
      { ...card, stage },
      feature,
      attachments,
      settings
    );
    userMsg = prependContext ? `${prependContext}\n\n${base}` : base;
  }

  // Injeta o contexto do projeto (tipo de app, stack, instruções, conhecimento)
  const projectBlock = await getProjectContextBlock(feature.project_id, feature.repository_id, feature.environment_id, feature.slug);
  if (projectBlock) userMsg = `${projectBlock}\n${userMsg}`;

  const session = await beta.sessions.create({
    agent: deployed.claude_agent_id,
    environment_id: feature.claude_environment_id,
    title: `${feature.slug} · ${stage}`,
  });

  await beta.sessions.events.send(session.id, {
    events: [
      {
        type: "user.message",
        content: [{ type: "text", text: userMsg }],
      },
    ],
  });

  // Atualiza card e registra stage_run
  await sb
    .from("cards")
    .update({
      claude_session_id: session.id,
      claude_agent_id: deployed.id,
      status: "running",
    })
    .eq("id", cardId);

  await sb.from("card_stage_runs").insert({
    card_id: cardId,
    stage,
    agent_role: def.role,
    claude_session_id: session.id,
    status: "running",
    model: def.model,
  });

  await sb.from("card_chat_messages").insert({
    card_id: cardId,
    session_id: session.id,
    role: "system",
    content: userMsg,
  });

  return session.id;
}

// ============================================================
// onboardProject / dreamProject: gestão das instruções do projeto
// ============================================================

/** Cria (ou reusa) um environment de projeto e dispara o primeiro agente disponível. */
async function runProjectAgentSession(
  projectId: string,
  title: string,
  prompt: string
): Promise<string> {
  const sb = createServiceClient();
  const { data: project } = await sb
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();
  if (!project) throw new Error("projeto não encontrado");
  if (!project.github_repo) throw new Error("projeto sem repositório configurado");

  // environment de projeto (campo reutilizado em projects)
  let envId = (project as any).claude_environment_id as string | null;
  if (!envId) {
    const env = await beta.environments.create({
      name: `proj-${project.sigla?.toLowerCase() ?? "env"}-${projectId.slice(0, 6)}`,
      config: { type: "cloud", networking: { type: "unrestricted" } },
    });
    envId = env.id;
    await sb.from("projects").update({ claude_environment_id: envId }).eq("id", projectId);
  }

  // usa o Tech Lead do projeto (ou o primeiro agente deployado)
  let agentId: string | null = null;
  const { data: tl } = await sb
    .from("agents")
    .select("claude_agent_id")
    .eq("project_id", projectId)
    .eq("role", "tech_lead")
    .eq("is_current", true)
    .maybeSingle();
  agentId = tl?.claude_agent_id ?? null;
  if (!agentId) {
    const { data: any1 } = await sb
      .from("agents")
      .select("claude_agent_id")
      .eq("project_id", projectId)
      .eq("is_current", true)
      .limit(1)
      .maybeSingle();
    agentId = any1?.claude_agent_id ?? null;
  }
  if (!agentId)
    throw new Error("nenhum agente deployado no projeto; rode o setup de agentes");

  const session = await beta.sessions.create({
    agent: agentId,
    environment_id: envId,
    title,
  });
  await beta.sessions.events.send(session.id, {
    events: [{ type: "user.message", content: [{ type: "text", text: prompt }] }],
  });
  return session.id;
}

/**
 * Onboarding de aplicação EXISTENTE: o agente mapeia o repositório e gera o
 * arquivo de instruções (instructions_path) descrevendo arquitetura, convenções
 * e comandos, além de listar o que entendeu da base de código.
 */
export async function onboardProject(projectId: string): Promise<{ session_id: string }> {
  const sb = createServiceClient();
  const { data: project } = await sb.from("projects").select("*").eq("id", projectId).single();
  if (!project) throw new Error("projeto não encontrado");
  const token = process.env.GITHUB_TOKEN ?? "(GITHUB_TOKEN_NOT_SET)";
  const instr = project.instructions_path || "CLAUDE.md";
  const base = project.default_base_branch || "main";

  const prompt =
    `You are ONBOARDING an existing codebase so future AI agents can work on it ` +
    `safely. Repository: ${project.github_repo} (${project.app_kind ?? "application"}).\n\n` +
    `STEPS:\n` +
    `1. Clone the repo.\n` +
    `2. Explore the structure: entry points, modules/services, build & test commands, ` +
    `config, dependencies, data layer, external integrations.\n` +
    `3. Create/update '${instr}' at the repo root documenting, concisely: overview & ` +
    `purpose, architecture and main modules, tech stack, how to build/test/run, coding ` +
    `conventions, branching/PR rules, and known gotchas. This file is the contract ` +
    `future agents must follow.\n` +
    `4. Also create docs/ONBOARDING.md with a deeper map (per-module responsibilities, ` +
    `key flows, where to add things) and a list of risky areas to touch carefully.\n` +
    `5. Open a branch 'chore/onboarding-instructions' from '${base}' and a PR with these files.\n` +
    `6. End your turn with: a summary of the architecture you found, the build/test ` +
    `commands, and the top 5 things a new contributor must know.\n\n` +
    `--- GitHub credentials ---\n` +
    `Repo: ${project.github_repo}\nToken: ${token}\n` +
    `Clone URL: https://x-access-token:${token}@github.com/${project.github_repo}.git\n` +
    `API auth header: Authorization: token ${token}\nBase branch: ${base}\n---\n` +
    `Disable git commit signing with -c commit.gpgsign=false. Set a git identity.`;

  const sessionId = await runProjectAgentSession(projectId, `onboarding · ${project.name}`, prompt);
  await sb.from("projects").update({ onboarded_at: new Date().toISOString() }).eq("id", projectId);
  return { session_id: sessionId };
}

/**
 * "Dreaming": consolida os aprendizados acumulados do projeto no arquivo de
 * instruções, mantendo-o vivo conforme o time evolui.
 */
export async function dreamProject(projectId: string): Promise<{ session_id: string }> {
  const sb = createServiceClient();
  const { data: project } = await sb.from("projects").select("*").eq("id", projectId).single();
  if (!project) throw new Error("projeto não encontrado");
  const token = process.env.GITHUB_TOKEN ?? "(GITHUB_TOKEN_NOT_SET)";
  const instr = project.instructions_path || "CLAUDE.md";
  const base = project.default_base_branch || "main";

  const { data: learnings } = await sb
    .from("project_learnings")
    .select("kind, content, created_at")
    .eq("project_id", projectId)
    .is("applied_at", null)
    .order("created_at", { ascending: true });

  const learningList =
    (learnings ?? []).length > 0
      ? (learnings ?? []).map((l) => `- [${l.kind}] ${l.content}`).join("\n")
      : "(no unapplied learnings recorded; infer improvements from the repo history and recent ADRs/QA reports under docs/features/*)";

  const prompt =
    `This is a "Dreaming" session: consolidate accumulated learnings into the project ` +
    `instructions so future agents get smarter over time. Repository: ${project.github_repo}.\n\n` +
    `Accumulated learnings to fold in:\n${learningList}\n\n` +
    `STEPS:\n` +
    `1. Clone the repo and read the current '${instr}'.\n` +
    `2. Integrate the learnings above into '${instr}': new conventions, pitfalls to avoid, ` +
    `clarified architecture, better build/test guidance. Keep it concise and current — ` +
    `edit/refine, don't just append. Remove anything now obsolete.\n` +
    `3. Keep a short CHANGELOG section at the bottom noting what this Dreaming pass changed.\n` +
    `4. Open a branch 'chore/dreaming-update' from '${base}' and a PR with the updated instructions.\n` +
    `5. End your turn with a bullet list of what you changed and why.\n\n` +
    `--- GitHub credentials ---\n` +
    `Repo: ${project.github_repo}\nToken: ${token}\n` +
    `Clone URL: https://x-access-token:${token}@github.com/${project.github_repo}.git\n` +
    `API auth header: Authorization: token ${token}\nBase branch: ${base}\n---\n` +
    `Disable git commit signing with -c commit.gpgsign=false. Set a git identity.`;

  const sessionId = await runProjectAgentSession(projectId, `dreaming · ${project.name}`, prompt);
  // marca learnings como aplicados
  await sb
    .from("project_learnings")
    .update({ applied_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .is("applied_at", null);
  return { session_id: sessionId };
}


// dos chunks numa branch de integração, resolvendo conflitos de merge.
// ============================================================

// ============================================================
// generateInfrastructureSummary: ao final do desenvolvimento, sintetiza
// um resumo estruturado da infraestrutura necessária para a feature.
// Usado depois como entrada pra provisionamento (MCPs).
// ============================================================
export async function generateInfrastructureSummary(
  cardId: string
): Promise<{ summary: string; artifact_url?: string }> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select(
      "id, feature:features(slug, title, description, project_id, github_repo, repository_id, environment_id)"
    )
    .eq("id", cardId)
    .maybeSingle();
  const feature = (card as any)?.feature;
  if (!feature) throw new Error("card/feature não encontrado");

  // branch alvo (do ambiente do card)
  let branch = "main";
  if (feature.environment_id) {
    const { data: env } = await sb
      .from("environments")
      .select("branch")
      .eq("id", feature.environment_id)
      .maybeSingle();
    branch = env?.branch ?? branch;
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN não configurado");
  const repo = feature.github_repo as string;
  const slug = feature.slug as string;

  // tenta puxar os artefatos relevantes do GitHub na branch alvo
  async function tryFetch(path: string): Promise<string | null> {
    const url = `https://api.github.com/repos/${repo}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?ref=${encodeURIComponent(branch)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) return null;
    const d = await res.json();
    return Buffer.from(d.content, "base64").toString("utf-8");
  }

  const base = `docs/features/${slug}`;
  const [prd, plan, infra, adrList] = await Promise.all([
    tryFetch(`${base}/PRD.md`),
    tryFetch(`${base}/plan.md`),
    tryFetch(`${base}/infrastructure.md`),
    tryFetch(`${base}/ADRs.md`).then((v) => v ?? tryFetch(`${base}/adr.md`)),
  ]);

  const sources: string[] = [];
  if (prd) sources.push(`### PRD\n${prd}`);
  if (plan) sources.push(`### Plan\n${plan}`);
  if (infra) sources.push(`### infrastructure.md (live)\n${infra}`);
  if (adrList) sources.push(`### ADRs\n${adrList}`);
  const corpus =
    sources.length > 0
      ? sources.join("\n\n---\n\n")
      : `(no discovery/planning docs found on branch ${branch})`;

  const sys =
    `You are an infrastructure architect summarizing what a delivered feature needs to run in production. ` +
    `Output a single Markdown document in English with a stable structure suitable for downstream automation (an MCP-driven provisioner will read this).`;

  const userPrompt =
    `Feature: ${feature.title} (slug: ${slug})\n` +
    `Repository: ${repo}\n` +
    `Working branch: ${branch}\n\n` +
    `Documents from the working branch:\n\n${corpus}\n\n` +
    `Produce a Markdown report with EXACTLY these top-level sections (omit a section only if truly empty, never invent items):\n\n` +
    `# Infrastructure Summary — ${slug}\n\n` +
    `## Compute\n- list each service/container/function with: name, runtime, scale hints, env vars expected\n\n` +
    `## Databases\n- per database: kind (e.g. PostgreSQL 16), name, schemas, key tables, status (NEW or EXISTING-REUSED), migration script path, connection env var\n\n` +
    `## Caches & Queues\n- per resource: kind (Redis, RabbitMQ, SQS, Kafka), name, purpose, status, connection env var\n\n` +
    `## Object Storage\n- buckets/blobs: name, purpose, access pattern, status, connection env var\n\n` +
    `## Third-party Services\n- e.g. payment gateway, email, observability — name, why, env vars/keys\n\n` +
    `## Secrets & Config\n- list every required environment variable / secret, with a short description (NEVER include values)\n\n` +
    `## Networking & Access\n- ingress, egress, VPC notes, public/private, ports\n\n` +
    `## Open Questions\n- anything still marked NEEDS_HUMAN_CONFIRMATION in infrastructure.md\n\n` +
    `End with a JSON block under \`\`\`json named "machine_readable" containing the same data as a flat array of resources for the provisioner to consume.\n` +
    `Be specific. Cite the migration script paths and env var names exactly as they appear in the source docs.`;

  const opus = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 8192,
    system: sys,
    messages: [{ role: "user", content: userPrompt }],
  });
  const summary = opus.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");

  // grava o resumo como artefato versionado na branch do ambiente
  let artifact_url: string | undefined;
  try {
    const path = `${base}/infrastructure-summary.md`;
    const ghUrl = `https://api.github.com/repos/${repo}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    // checa se já existe (pra obter sha)
    const head = await fetch(`${ghUrl}?ref=${encodeURIComponent(branch)}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    const existing = head.ok ? await head.json() : null;
    const putRes = await fetch(ghUrl, {
      method: "PUT",
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({
        message: `docs(${slug}): regenerate infrastructure summary`,
        content: Buffer.from(summary, "utf-8").toString("base64"),
        branch,
        sha: existing?.sha,
      }),
    });
    if (putRes.ok) {
      const d = await putRes.json();
      artifact_url = d.content?.html_url;
    }
  } catch (e) {
    console.error("[infra-summary] could not persist", e);
  }

  return { summary, artifact_url };
}


export async function promoteEnvironment(
  environmentId: string
): Promise<{ pr_url: string; pr_number: number }> {
  const sb = createServiceClient();
  const { data: env } = await sb
    .from("environments")
    .select(
      "id, name, branch, repository_id, promotes_to_id, project_repositories!inner(github_repo)"
    )
    .eq("id", environmentId)
    .maybeSingle();
  if (!env) throw new Error("ambiente não encontrado");
  if (!env.promotes_to_id)
    throw new Error("este ambiente não tem destino de promoção configurado");
  const repo = (env as any).project_repositories?.github_repo as string;
  if (!repo) throw new Error("aplicação sem repositório configurado");

  const { data: target } = await sb
    .from("environments")
    .select("name, branch")
    .eq("id", env.promotes_to_id)
    .maybeSingle();
  if (!target?.branch) throw new Error("ambiente destino sem branch configurada");

  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN não configurado");

  const prTitle = `chore(promote): ${env.name} → ${target.name}`;
  const prBody =
    `Elevação de ambiente: \`${env.branch}\` → \`${target.branch}\`.\n\n` +
    `Inclui tudo que foi entregue em **${env.name}** desde a última promoção.`;

  const createRes = await fetch(`https://api.github.com/repos/${repo}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      title: prTitle,
      head: env.branch,
      base: target.branch,
      body: prBody,
    }),
  });

  if (createRes.ok) {
    const pr = await createRes.json();
    return { pr_url: pr.html_url, pr_number: pr.number };
  }

  // Já existe um PR aberto pro par head→base? devolve esse.
  if (createRes.status === 422) {
    const owner = repo.split("/")[0];
    const listRes = await fetch(
      `https://api.github.com/repos/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(
        env.branch as string
      )}&base=${encodeURIComponent(target.branch)}`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
        },
      }
    );
    if (listRes.ok) {
      const prs = await listRes.json();
      if (Array.isArray(prs) && prs.length > 0) {
        return { pr_url: prs[0].html_url, pr_number: prs[0].number };
      }
    }
    const errBody = await createRes.text();
    throw new Error(`não foi possível criar/encontrar o PR: ${errBody}`);
  }

  const errBody = await createRes.text();
  throw new Error(`GitHub respondeu ${createRes.status}: ${errBody}`);
}

export async function resolveConflictsWithAgent(
  cardId: string
): Promise<{ session_id: string }> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*, feature:features(slug, github_repo, project_id)")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");
  const feature = card.feature as any;
  const token = process.env.GITHUB_TOKEN ?? "(GITHUB_TOKEN_NOT_SET)";
  const settings = await getAppSettings(feature.project_id);
  const base = settings.default_base_branch ?? "main";
  const integrationBranch = `feat/${feature.slug}/integration`;

  // Busca a lista REAL de PRs abertos da feature, pra enumerar todos no prompt
  let prList = "";
  let prCount = 0;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${feature.github_repo}/pulls?state=open&per_page=100`,
      { headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" } }
    );
    if (res.ok) {
      const items = await res.json();
      const norm = feature.slug.toLowerCase();
      const matched = (Array.isArray(items) ? items : []).filter((pr: any) => {
        const ref = (pr.head?.ref ?? "").toLowerCase();
        const title = (pr.title ?? "").toLowerCase();
        return ref.includes(norm) || title.includes(norm);
      });
      prCount = matched.length;
      prList = matched
        .map((pr: any) => `   - PR #${pr.number} (branch: ${pr.head?.ref}) — ${pr.title}`)
        .join("\n");
    }
  } catch {
    /* segue sem a lista; o agente descobre via API */
  }

  const enumerated = prList
    ? `\nThe open chunk PRs to integrate (ALL of them, ${prCount} total) are:\n${prList}\n`
    : "";

  const prompt =
    `Your task is to INTEGRATE **all** open chunk Pull Requests for feature ` +
    `'${feature.slug}' into a single conflict-free branch, resolving every merge ` +
    `conflict. This is not done until EVERY chunk is integrated.\n` +
    enumerated +
    `\nSTEPS:\n` +
    `1. Clone the repo.\n` +
    `2. Create an integration branch '${integrationBranch}' from '${base}'.\n` +
    `3. Merge EVERY chunk branch listed above into '${integrationBranch}', one at a ` +
    `time, in ascending chunk/issue order. Do NOT stop after the first one — you ` +
    `must process the complete list.\n` +
    `4. CONFLICT RESOLUTION POLICY (apply the SAME policy to every conflict, for ` +
    `consistency): keep BOTH sides' intent — integrate the changes from the incoming ` +
    `chunk together with what's already on the integration branch, so no chunk loses ` +
    `functionality. Only when two changes are truly mutually exclusive, prefer the ` +
    `incoming chunk and leave a "// TODO integration:" note. Never resolve a conflict ` +
    `by simply discarding one side.\n` +
    `5. After each merge, make sure the project still builds and lints before moving ` +
    `to the next chunk.\n` +
    `6. Keep a running log: for each PR, record "merged clean" or "merged with ` +
    `conflicts resolved in <files>".\n` +
    `7. When ALL chunks are merged, push '${integrationBranch}' and open a SINGLE PR ` +
    `from it into '${base}', titled "feat(${feature.slug}): integração dos chunks", ` +
    `whose body lists every PR/issue consolidated and how each conflict was resolved.\n` +
    `8. Do NOT merge it yourself — leave it open for human review.\n` +
    `9. End your turn with: the integration PR URL, the per-chunk log from step 6, and ` +
    `confirmation that all ${prCount || "open"} chunks were integrated.\n\n` +
    `--- GitHub credentials ---\n` +
    `Repo: ${feature.github_repo}\n` +
    `Token: ${token}\n` +
    `Clone URL: https://x-access-token:${token}@github.com/${feature.github_repo}.git\n` +
    `API auth header: Authorization: token ${token}\n` +
    `Base branch: ${base}\n---\n` +
    `Disable git commit signing with -c commit.gpgsign=false. Set a git identity.`;

  const sessionId = await startStage(cardId, prompt);
  return { session_id: sessionId };
}

// ============================================================
// chatWithAgent: continua conversa em sessão existente
// ============================================================
export async function chatWithAgent(
  cardId: string,
  message: string,
  sentBy?: string,
  images?: Array<{ media_type: string; data: string }>
): Promise<{ session_id: string }> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error(`card ${cardId} not found`);
  if (!card.claude_session_id)
    throw new Error("card has no active session yet");

  // Monta o content: texto + imagens (se houver)
  const content: any[] = [];
  if (message) content.push({ type: "text", text: message });
  for (const img of images ?? []) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.media_type,
        data: img.data,
      },
    });
  }
  if (content.length === 0) content.push({ type: "text", text: "(sem conteúdo)" });

  await beta.sessions.events.send(card.claude_session_id, {
    events: [{ type: "user.message", content }],
  });

  await sb.from("cards").update({ status: "running" }).eq("id", cardId);

  // Persiste o texto + marca quantas imagens foram anexadas
  const persisted =
    message + ((images?.length ?? 0) > 0 ? `\n[${images!.length} imagem(ns) anexada(s)]` : "");
  await sb.from("card_chat_messages").insert({
    card_id: cardId,
    session_id: card.claude_session_id,
    role: "user",
    content: persisted,
    sent_by: sentBy ?? null,
  });

  return { session_id: card.claude_session_id };
}

// ============================================================
// advanceCard: MESMO CARD avança de stage (não cria novo)
// ============================================================
export async function advanceCard(
  cardId: string,
  decision: "approved" | "rejected",
  reason?: string,
  decidedBy?: string,
  overrideInitialMessage?: string
): Promise<void> {
  if (decision === "rejected" && !reason) {
    throw new Error("rejection requires a reason");
  }

  const sb = createServiceClient();

  const { data: card } = await sb
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error(`card ${cardId} not found`);
  if (card.status !== "awaiting_review") {
    throw new Error(`card is ${card.status}; cannot advance`);
  }

  // Fecha o gate atual
  await sb
    .from("human_gates")
    .update({
      decision,
      decision_reason: reason,
      decided_by: decidedBy,
      decided_at: new Date().toISOString(),
    })
    .eq("card_id", cardId)
    .is("decision", null);

  // Marca o stage_run atual como completed/failed
  await sb
    .from("card_stage_runs")
    .update({
      status: decision === "approved" ? "completed" : "failed",
      ended_at: new Date().toISOString(),
    })
    .eq("card_id", cardId)
    .eq("stage", card.stage)
    .eq("status", "running");

  if (decision === "rejected") {
    // MESMO CARD, MESMO STAGE — só dispara nova sessão
    await sb
      .from("cards")
      .update({
        status: "queued",
        claude_session_id: null, // limpa sessão antiga (fica em stage_runs)
      })
      .eq("id", cardId);

    const rejectionContext =
      `--- REJECTION FEEDBACK ---\n` +
      `Your previous attempt was REJECTED.\n\nREASON:\n${reason}\n\n` +
      `Address this feedback specifically. Reuse the task context below.\n` +
      `--- end rejection feedback ---`;

    await startStage(cardId, undefined, rejectionContext);
    return;
  }

  // APROVADO: avança o MESMO card pra próxima stage
  const nextStage = NEXT_STAGE[card.stage as StageCode];

  // Marca features.current_stage também
  await sb
    .from("features")
    .update({ current_stage: nextStage })
    .eq("id", card.feature_id);

  if (nextStage === "done") {
    await sb
      .from("cards")
      .update({ status: "done", stage: "done", claude_session_id: null })
      .eq("id", cardId);
    await notifyStageCompleted(cardId, card.stage, "done");
    return;
  }

  // Mesmo card, nova stage
  await sb
    .from("cards")
    .update({
      stage: nextStage,
      status: "queued",
      claude_session_id: null,
    })
    .eq("id", cardId);

  await notifyStageCompleted(cardId, card.stage, nextStage);

  // Development tem orquestração própria: lê chunks e dispara um Dev Agent
  // por chunk seguindo o build order. As outras stages disparam uma sessão única.
  if (nextStage === "development") {
    await startDevelopmentStage(cardId);
  } else {
    await startStage(cardId, overrideInitialMessage);
  }
}

// ============================================================
// cancelCard
// ============================================================
export async function cancelCard(
  cardId: string,
  reason: string,
  cancelledBy?: string
): Promise<void> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*, feature:features(id)")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");

  const featureId = card.feature.id;

  // Cancela TODOS os cards desta feature (pode haver mais de um por causa
  // de cards órfãos criados pela versão antiga do orquestrador).
  const { data: allCards } = await sb
    .from("cards")
    .select("id")
    .eq("feature_id", featureId);
  const cardIds = (allCards ?? []).map((c) => c.id);

  await sb
    .from("cards")
    .update({ status: "cancelled" })
    .eq("feature_id", featureId);

  // Fecha todos os gates abertos de todos os cards da feature
  if (cardIds.length > 0) {
    await sb
      .from("human_gates")
      .update({
        decision: "rejected",
        decision_reason: `cancelado: ${reason}`,
        decided_by: cancelledBy,
        decided_at: new Date().toISOString(),
      })
      .in("card_id", cardIds)
      .is("decision", null);

    await sb
      .from("card_stage_runs")
      .update({
        status: "failed",
        ended_at: new Date().toISOString(),
      })
      .in("card_id", cardIds)
      .eq("status", "running");
  }

  await sb
    .from("features")
    .update({
      cancelled_at: new Date().toISOString(),
      cancelled_reason: reason,
    })
    .eq("id", featureId);
}

export async function completeCardEarly(
  cardId: string,
  completedBy?: string
): Promise<void> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*, feature:features(id)")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");

  await sb
    .from("cards")
    .update({ status: "done", stage: "done" })
    .eq("id", cardId);

  await sb
    .from("human_gates")
    .update({
      decision: "approved",
      decision_reason: "concluído antecipadamente",
      decided_by: completedBy,
      decided_at: new Date().toISOString(),
    })
    .eq("card_id", cardId)
    .is("decision", null);

  await sb
    .from("features")
    .update({
      current_stage: "done",
      completed_early_at: new Date().toISOString(),
    })
    .eq("id", card.feature.id);
}

// ============================================================
// moveCardToStage: move o card pra QUALQUER stage (frente ou trás)
// Ex: voltar de development pra planning ("Refinamento Técnico")
// ============================================================
const ALL_STAGES: StageCode[] = [
  "discovery",
  "planning",
  "development",
  "qa",
  "done",
];

export async function moveCardToStage(
  cardId: string,
  targetStage: StageCode,
  dispatch: boolean = true,
  gateDecision: "approved" | "rejected" = "rejected",
  gateReason?: string
): Promise<void> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");
  if (!ALL_STAGES.includes(targetStage)) {
    throw new Error(`stage inválida: ${targetStage}`);
  }

  // Fecha gates abertos do card (default rejected; pode ser approved quando vem
  // do diálogo de aprovação como fallback)
  await sb
    .from("human_gates")
    .update({
      decision: gateDecision,
      decision_reason:
        gateReason ?? `movido manualmente para ${targetStage}`,
      decided_at: new Date().toISOString(),
    })
    .eq("card_id", cardId)
    .is("decision", null);

  // Marca runs em andamento como interrompidas
  await sb
    .from("card_stage_runs")
    .update({ status: "failed", ended_at: new Date().toISOString() })
    .eq("card_id", cardId)
    .eq("status", "running");

  // Atualiza features.current_stage
  await sb
    .from("features")
    .update({ current_stage: targetStage })
    .eq("id", card.feature_id);

  if (targetStage === "done") {
    await sb
      .from("cards")
      .update({ stage: "done", status: "done", claude_session_id: null })
      .eq("id", cardId);
    return;
  }

  // Reabrir: se a feature estava concluída/cancelada, limpa o estado terminal
  await sb
    .from("features")
    .update({
      cancelled_at: null,
      cancelled_reason: null,
      completed_early_at: null,
    })
    .eq("id", card.feature_id);

  // Move o card
  await sb
    .from("cards")
    .update({
      stage: targetStage,
      status: dispatch ? "queued" : "awaiting_review",
      claude_session_id: null,
    })
    .eq("id", cardId);

  if (dispatch) {
    if (targetStage === "development") {
      await startDevelopmentStage(cardId);
    } else {
      await startStage(cardId);
    }
  }
}

// ============================================================
// rerunStage: descarta o processamento da stage atual e refaz já
// ============================================================
export async function rerunStage(cardId: string): Promise<void> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*, feature:features(id)")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");

  const stage = card.stage as StageCode;

  // Fecha gates abertos
  await sb
    .from("human_gates")
    .update({
      decision: "rejected",
      decision_reason: "re-execução do estágio solicitada",
      decided_at: new Date().toISOString(),
    })
    .eq("card_id", cardId)
    .is("decision", null);

  // Marca todas as runs dessa stage como descartadas
  await sb
    .from("card_stage_runs")
    .update({ status: "failed", ended_at: new Date().toISOString() })
    .eq("card_id", cardId)
    .eq("stage", stage);

  // Se for development, reseta os chunks pra planned (refaz tudo)
  if (stage === "development") {
    await sb
      .from("chunks")
      .update({ status: "planned" })
      .eq("feature_id", card.feature.id);
  }

  // Limpa sessão e re-dispara
  await sb
    .from("cards")
    .update({ status: "queued", claude_session_id: null })
    .eq("id", cardId);

  if (stage === "development") {
    await startDevelopmentStage(cardId);
  } else {
    await startStage(cardId);
  }
}

// ============================================================
// forceSyncSession: consulta o status real da sessão e destrava
// cards presos (sessão idle/ended mas card ainda "running")
// ============================================================
export async function forceSyncSession(cardId: string): Promise<{
  card_status: string;
  session_status: string;
  action: string;
}> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");

  if (!card.claude_session_id) {
    return {
      card_status: card.status,
      session_status: "none",
      action: "card sem sessão ativa — nada a sincronizar",
    };
  }

  // Consulta o status real da sessão
  let session: any = null;
  try {
    session = await beta.sessions.retrieve(card.claude_session_id);
  } catch (e) {
    return {
      card_status: card.status,
      session_status: "error",
      action: `falha ao consultar sessão: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }

  const rawStatus = String(session?.status ?? "unknown").toLowerCase();
  const isActive =
    rawStatus.includes("running") ||
    rawStatus.includes("pending") ||
    rawStatus.includes("starting") ||
    rawStatus.includes("progress");

  if (isActive) {
    return {
      card_status: card.status,
      session_status: rawStatus,
      action: "sessão ainda ativa — aguarde ou re-execute se travada",
    };
  }

  // Sessão terminou (idle/ended/completed/failed) mas card pode estar preso
  if (card.status !== "running") {
    return {
      card_status: card.status,
      session_status: rawStatus,
      action: "card já não estava em running — nenhuma ação necessária",
    };
  }

  // Captura uso/custo da sessão encerrada (best-effort)
  try {
    const usage = (session as any)?.usage ?? null;
    if (usage) {
      await captureSessionUsage(cardId, card.claude_session_id, usage);
    }
  } catch (e) {
    console.error("[forceSync] captureSessionUsage falhou", e);
  }

  // É uma sessão de chunk? Avança o pipeline de development
  const wasChunk = await handleChunkSessionIdle(card.claude_session_id);
  if (wasChunk) {
    return {
      card_status: "running",
      session_status: rawStatus,
      action: "chunk finalizado — próximo chunk disparado (ou stage concluída)",
    };
  }

  // Stage normal: força transição pra awaiting_review
  const summary = extractSessionSummary(session);
  await moveToAwaitingReview(cardId, card.stage, summary);

  return {
    card_status: "awaiting_review",
    session_status: rawStatus,
    action: "card destravado → aguardando revisão",
  };
}

// Move um card pra awaiting_review criando/atualizando o gate (reutilizável)
async function moveToAwaitingReview(
  cardId: string,
  stage: string,
  summary: string
): Promise<void> {
  const sb = createServiceClient();
  const roleForStage: Record<string, string> = {
    discovery: "pm",
    planning: "tech_lead",
    development: "tech_lead",
    qa: "qa",
  };
  const role = roleForStage[stage] ?? "admin";

  const { data: assignee } = await sb
    .from("user_profiles")
    .select("id")
    .eq("role", role)
    .limit(1)
    .single();

  await sb
    .from("card_stage_runs")
    .update({ summary })
    .eq("card_id", cardId)
    .eq("status", "running");

  await sb.from("cards").update({ status: "awaiting_review" }).eq("id", cardId);

  const { data: existingGate } = await sb
    .from("human_gates")
    .select("id")
    .eq("card_id", cardId)
    .is("decision", null)
    .single();

  if (!existingGate) {
    await sb.from("human_gates").insert({
      card_id: cardId,
      assignee_id: assignee?.id ?? null,
      summary,
      artifacts_json: [],
    });
  } else {
    await sb
      .from("human_gates")
      .update({ summary })
      .eq("id", existingGate.id);
  }
}

function extractSessionSummary(session: any): string {
  if (!session) return "(sem dados da sessão)";
  const messages = session?.messages ?? session?.events ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" && m.type !== "agent.message") continue;
    if (typeof m.content === "string") return m.content;
    for (const block of m.content ?? []) {
      if (block.type === "text") return block.text;
    }
  }
  return "(agente concluiu o turno)";
}

// ============================================================
// createFeature
// ============================================================
export async function createFeature(input: {
  slug: string;
  title: string;
  description: string;
  github_repo: string;
  github_parent_issue: number;
  project_id: string;
  repository_id?: string;
  environment_id?: string;
  created_by?: string;
}): Promise<{ feature_id: string; card_id: string }> {
  const sb = createServiceClient();
  const normalizedSlug = normalizeSlug(input.slug);

  const { data: feature, error: fErr } = await sb
    .from("features")
    .insert({ ...input, slug: normalizedSlug })
    .select("id")
    .single();
  if (fErr || !feature) throw fErr ?? new Error("failed to create feature");

  const { data: card, error: cErr } = await sb
    .from("cards")
    .insert({
      feature_id: feature.id,
      stage: "discovery",
      status: "queued",
    })
    .select("id")
    .single();
  if (cErr || !card) throw cErr ?? new Error("failed to create card");

  return { feature_id: feature.id, card_id: card.id };
}

export async function kickoffFirstStage(cardId: string): Promise<string> {
  return startStage(cardId);
}

// ============================================================
// ORQUESTRAÇÃO DE CHUNKS (development)
// ============================================================

// Mapeia o skill de um chunk para o role do Dev Agent
const SKILL_TO_ROLE: Record<string, string> = {
  backend: "dev_backend",
  frontend: "dev_frontend",
  infra: "dev_infra",
  data: "dev_backend", // fallback razoável
};

function extractSkillFromLabels(labels: string[]): string {
  for (const l of labels) {
    const m = l.match(/^skill:(\w+)/);
    if (m) return m[1];
  }
  // tenta achar no título via prefixo [backend], [frontend], etc
  return "backend";
}

/**
 * Lê as issues (chunks) do GitHub com label feat:<slug> e persiste em `chunks`.
 * Retorna os chunks ordenados por número da issue (proxy do build order).
 */
async function loadAndPersistChunks(
  featureId: string,
  repo: string,
  slug: string
): Promise<
  Array<{
    id: string;
    title: string;
    skill: string;
    github_issue_number: number;
    status: string;
  }>
> {
  const sb = createServiceClient();
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN não configurado");

  const url = `https://api.github.com/repos/${repo}/issues?state=all&labels=feat:${encodeURIComponent(
    slug
  )}&per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub issues API ${res.status}`);
  }
  const items = await res.json();
  const issues = (Array.isArray(items) ? items : []).filter(
    (it: any) => !it.pull_request
  );

  // Ordena por número da issue (ordem de criação ≈ build order do TL)
  issues.sort((a: any, b: any) => a.number - b.number);

  const result = [];
  for (const issue of issues) {
    const labels = (issue.labels ?? []).map((l: any) =>
      typeof l === "string" ? l : l.name
    );
    const skill = extractSkillFromLabels(labels);

    // Upsert do chunk (idempotente por github_issue_number)
    const { data: existing } = await sb
      .from("chunks")
      .select("id, status")
      .eq("feature_id", featureId)
      .eq("github_issue_number", issue.number)
      .single();

    let chunkId: string;
    let status: string;
    if (existing) {
      chunkId = existing.id;
      status = existing.status;
    } else {
      const { data: created } = await sb
        .from("chunks")
        .insert({
          feature_id: featureId,
          title: issue.title,
          description: (issue.body ?? "").slice(0, 2000),
          skill,
          github_issue_number: issue.number,
          status: "planned",
        })
        .select("id, status")
        .single();
      chunkId = created!.id;
      status = created!.status;
    }

    result.push({
      id: chunkId,
      title: issue.title,
      skill,
      github_issue_number: issue.number,
      status,
    });
  }

  return result;
}

/**
 * Entry point da stage de development: lê chunks e dispara o primeiro.
 */
export async function startDevelopmentStage(cardId: string): Promise<void> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*, feature:features(id, slug, github_repo)")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");

  const feature = card.feature as any;
  const chunks = await loadAndPersistChunks(
    feature.id,
    feature.github_repo,
    feature.slug
  );

  if (chunks.length === 0) {
    // Sem chunks — cai pro comportamento padrão (dispara dev agent genérico)
    await startStage(cardId);
    return;
  }

  await startNextChunk(cardId);
}

/**
 * Acha o próximo chunk 'planned' e dispara uma sessão de Dev Agent pra ele.
 * Se não houver mais chunks pendentes, marca o card como awaiting_review.
 * Chamado tanto no início da stage quanto pelo webhook quando um chunk termina.
 */
export async function startNextChunk(cardId: string): Promise<void> {
  const sb = createServiceClient();
  const { data: card } = await sb
    .from("cards")
    .select("*, feature:features(id, slug, github_repo, github_parent_issue, description, claude_environment_id, project_id)")
    .eq("id", cardId)
    .single();
  if (!card) throw new Error("card not found");
  const feature = card.feature as any;

  // Próximo chunk não concluído (planned), por ordem de issue
  const { data: nextChunk } = await sb
    .from("chunks")
    .select("*")
    .eq("feature_id", feature.id)
    .eq("status", "planned")
    .order("github_issue_number", { ascending: true })
    .limit(1)
    .single();

  if (!nextChunk) {
    // Todos os chunks foram trabalhados → development completo, gate humano
    await sb
      .from("cards")
      .update({ status: "awaiting_review", claude_session_id: null })
      .eq("id", cardId);

    // Cria gate pro Tech Lead humano revisar tudo antes de QA
    const { data: tlUser } = await sb
      .from("user_profiles")
      .select("id")
      .eq("role", "tech_lead")
      .limit(1)
      .single();

    const { data: openGate } = await sb
      .from("human_gates")
      .select("id")
      .eq("card_id", cardId)
      .is("decision", null)
      .single();

    if (!openGate) {
      await sb.from("human_gates").insert({
        card_id: cardId,
        stage: "development",
        assignee_id: tlUser?.id ?? null,
        summary:
          "Todos os chunks foram implementados. Revise os PRs antes de avançar para QA.",
      });
    }
    return;
  }

  // Escolhe o Dev Agent pelo skill do chunk (no projeto da feature)
  const role = SKILL_TO_ROLE[nextChunk.skill] ?? "dev_backend";
  const { data: agentDef } = await sb
    .from("agent_definitions")
    .select("*")
    .eq("project_id", feature.project_id)
    .eq("role", role)
    .eq("enabled", true)
    .maybeSingle();

  // Fallback: se o role específico não existe/desabilitado, pega qualquer dev de development
  let chosenDef = agentDef;
  if (!chosenDef) {
    const { data: anyDev } = await sb
      .from("agent_definitions")
      .select("*")
      .eq("project_id", feature.project_id)
      .eq("stage", "development")
      .eq("enabled", true)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    chosenDef = anyDev;
  }
  if (!chosenDef) throw new Error("nenhum Dev Agent habilitado em development");

  const { data: deployed } = await sb
    .from("agents")
    .select("*")
    .eq("project_id", feature.project_id)
    .eq("role", chosenDef.role)
    .eq("is_current", true)
    .maybeSingle();
  if (!deployed)
    throw new Error(`Dev Agent ${chosenDef.role} não deployado; rode /admin/setup`);

  // Garante environment
  const feat = await ensureFeatureEnvironment(feature.id);
  const attachments = await fetchAttachmentContents(feature.id);
  const settings = await getAppSettings(feature.project_id);

  // Marca chunk como in_progress
  await sb
    .from("chunks")
    .update({ status: "in_progress" })
    .eq("id", nextChunk.id);

  // Monta o kickoff específico do chunk
  const baseChunkMsg = chunkKickoff(
    feature,
    nextChunk,
    chosenDef.role,
    attachments,
    settings
  );
  const projectBlock = await getProjectContextBlock(feature.project_id, feature.repository_id, feature.environment_id, feature.slug);
  const userMsg = projectBlock ? `${projectBlock}\n${baseChunkMsg}` : baseChunkMsg;

  const session = await beta.sessions.create({
    agent: deployed.claude_agent_id,
    environment_id: feat.claude_environment_id,
    title: `${feature.slug} · chunk #${nextChunk.github_issue_number} (${chosenDef.role})`,
  });

  await beta.sessions.events.send(session.id, {
    events: [{ type: "user.message", content: [{ type: "text", text: userMsg }] }],
  });

  // Registra chunk_run e stage_run
  await sb.from("chunk_runs").insert({
    chunk_id: nextChunk.id,
    claude_session_id: session.id,
    claude_agent_id: deployed.id,
  });

  await sb.from("card_stage_runs").insert({
    card_id: cardId,
    stage: "development",
    agent_role: chosenDef.role,
    claude_session_id: session.id,
    status: "running",
    summary: `Chunk #${nextChunk.github_issue_number}: ${nextChunk.title}`,
    model: chosenDef.model,
  });

  await sb
    .from("cards")
    .update({
      claude_session_id: session.id,
      claude_agent_id: deployed.id,
      status: "running",
    })
    .eq("id", cardId);

  await sb.from("card_chat_messages").insert({
    card_id: cardId,
    session_id: session.id,
    role: "system",
    content: userMsg,
  });
}

/**
 * Chamado pelo webhook quando uma sessão de chunk termina.
 * Marca o chunk como done e dispara o próximo (ou finaliza a stage).
 * Retorna true se era um chunk (e foi tratado), false caso contrário.
 */
export async function handleChunkSessionIdle(
  sessionId: string
): Promise<boolean> {
  const sb = createServiceClient();

  // É uma sessão de chunk?
  const { data: chunkRun } = await sb
    .from("chunk_runs")
    .select("*, chunk:chunks(id, feature_id)")
    .eq("claude_session_id", sessionId)
    .single();

  if (!chunkRun) return false; // não é chunk; deixa o handler normal cuidar

  // Marca chunk como done e o run como finalizado
  await sb
    .from("chunks")
    .update({ status: "done" })
    .eq("id", chunkRun.chunk_id);
  await sb
    .from("chunk_runs")
    .update({ finished_at: new Date().toISOString() })
    .eq("id", chunkRun.id);

  // Marca o stage_run dessa sessão como completed
  await sb
    .from("card_stage_runs")
    .update({ status: "completed", ended_at: new Date().toISOString() })
    .eq("claude_session_id", sessionId);

  // Acha o card da feature
  const featureId = (chunkRun.chunk as any).feature_id;
  const { data: card } = await sb
    .from("cards")
    .select("id")
    .eq("feature_id", featureId)
    .eq("stage", "development")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (card) {
    // Dispara o próximo chunk (ou finaliza a stage)
    await startNextChunk(card.id);
  }

  return true;
}

function chunkKickoff(
  feature: {
    slug: string;
    github_repo: string;
    github_parent_issue: number | null;
  },
  chunk: { github_issue_number: number; title: string; skill: string },
  role: string,
  attachments: Array<{ filename: string; content: string; truncated: boolean }>,
  settings: {
    auto_merge_prs: boolean;
    commit_to_existing_branch: boolean;
    default_base_branch: string;
  }
): string {
  const token = process.env.GITHUB_TOKEN ?? "(GITHUB_TOKEN_NOT_SET)";
  const [owner, repo] = feature.github_repo.split("/");

  const credBlock =
    `\n--- GitHub credentials ---\n` +
    `Repo: ${feature.github_repo}\n` +
    `Owner: ${owner}\nRepo name: ${repo}\n` +
    `Token: ${token}\n` +
    `Clone URL: https://x-access-token:${token}@github.com/${feature.github_repo}.git\n` +
    `API auth header: Authorization: token ${token}\n` +
    `Default base branch: ${settings.default_base_branch}\n---\n`;

  let workflowBlock: string;
  if (settings.commit_to_existing_branch) {
    workflowBlock =
      `\n--- Workflow mode: COMMIT-DIRECT ---\n` +
      `Commit directly to '${settings.default_base_branch}'. No PR.\n---\n`;
  } else if (settings.auto_merge_prs) {
    workflowBlock =
      `\n--- Workflow mode: AUTO-MERGE ---\n` +
      `Open PR, wait for CI, merge with squash.\n---\n`;
  } else {
    workflowBlock =
      `\n--- Workflow mode: PR-REVIEW (default) ---\n` +
      `Open a DRAFT PR. Human reviews and merges.\n---\n`;
  }

  let attachmentBlock = "";
  if (attachments.length > 0 && role === "dev_frontend") {
    attachmentBlock =
      `\n--- Approved prototypes (${attachments.length}) ---\n` +
      `Your implementation MUST be 1:1 with these prototypes.\n\n` +
      attachments
        .map(
          (a, i) =>
            `### Prototype ${i + 1}: ${a.filename}\n\n\`\`\`html\n${a.content}\n\`\`\``
        )
        .join("\n\n") +
      `\n---\n`;
  }

  return (
    `IMPLEMENT this chunk for feature '${feature.slug}'.\n\n` +
    `CHUNK: issue #${chunk.github_issue_number} — ${chunk.title}\n` +
    `Skill: ${chunk.skill}\n\n` +
    `STEPS (you MUST write actual code, not just plan):\n` +
    `1. Clone the repo using the credentials below.\n` +
    `2. Read the full issue #${chunk.github_issue_number} via GitHub API for scope and acceptance criteria.\n` +
    `3. Read docs/features/${feature.slug}/prd.md, adr.md, acceptance-criteria.md and any prototypes.\n` +
    `4. Use the working branch defined by the WORKFLOW DIRECTIVE above (the environment branch). Do NOT create a chunk-specific branch.\n` +
    `5. WRITE THE CODE that implements this chunk. Create/modify the actual source files in the repo.\n` +
    `6. Run lint, typecheck and tests locally before committing.\n` +
    `7. Commit with a clear message and push the branch.\n` +
    `8. Open a DRAFT PR with body "Closes #${chunk.github_issue_number}". Add label status:in-review.\n` +
    `9. End your turn with the PR URL and a summary of files changed.\n\n` +
    `IMPORTANT: Stay strictly within the scope of issue #${chunk.github_issue_number}. ` +
    `Do not implement other chunks. Disable git commit signing with -c commit.gpgsign=false. ` +
    `Set a git identity before committing.` +
    credBlock +
    workflowBlock +
    attachmentBlock
  );
}

// ============================================================
// defaultKickoff
// ============================================================
function defaultKickoff(
  card: { stage: string },
  feature: {
    slug: string;
    title: string;
    description: string | null;
    github_repo: string;
    github_parent_issue: number | null;
  },
  attachments: Array<{ filename: string; content: string; truncated: boolean }>,
  settings: {
    auto_merge_prs: boolean;
    commit_to_existing_branch: boolean;
    default_base_branch: string;
  }
): string {
  const token = process.env.GITHUB_TOKEN ?? "(GITHUB_TOKEN_NOT_SET)";
  const [owner, repo] = feature.github_repo.split("/");

  const credBlock =
    `\n--- GitHub credentials ---\n` +
    `Repo: ${feature.github_repo}\n` +
    `Owner: ${owner}\n` +
    `Repo name: ${repo}\n` +
    `Token: ${token}\n` +
    `Clone URL: https://x-access-token:${token}@github.com/${feature.github_repo}.git\n` +
    `API auth header: Authorization: token ${token}\n` +
    `Default base branch: ${settings.default_base_branch}\n---\n`;

  let workflowBlock = "";
  if (settings.commit_to_existing_branch) {
    workflowBlock =
      `\n--- Workflow mode: COMMIT-DIRECT ---\n` +
      `Commit directly to '${settings.default_base_branch}'. No new branch, no PR.\n---\n`;
  } else if (settings.auto_merge_prs) {
    workflowBlock =
      `\n--- Workflow mode: AUTO-MERGE ---\n` +
      `Open PR, wait for CI, merge with squash.\n---\n`;
  } else {
    workflowBlock =
      `\n--- Workflow mode: PR-REVIEW (default) ---\n` +
      `Open DRAFT PR. Human merges.\n---\n`;
  }

  let attachmentBlock = "";
  if (attachments.length > 0) {
    attachmentBlock =
      `\n--- Approved prototypes (${attachments.length} file${
        attachments.length > 1 ? "s" : ""
      }) ---\n` +
      `Source of truth for UI. Save each to docs/features/<slug>/prototypes/.\n\n` +
      attachments
        .map(
          (a, i) =>
            `### Prototype ${i + 1}: ${a.filename}${
              a.truncated ? " (TRUNCATED)" : ""
            }\n\n\`\`\`html\n${a.content}\n\`\`\``
        )
        .join("\n\n") +
      `\n---\n`;
  }

  const stage = card.stage;
  if (stage === "discovery") {
    return (
      `Build the spec for feature '${feature.title}' (slug: ${feature.slug}).\n\n` +
      `Initial description:\n${feature.description}\n` +
      credBlock +
      workflowBlock +
      attachmentBlock
    );
  }
  if (stage === "planning") {
    return (
      `Plan the technical implementation for feature '${feature.slug}'.\n\n` +
      `STEPS:\n` +
      `1. Clone the repo with the credentials below.\n` +
      `2. Read docs/features/${feature.slug}/prd.md, acceptance-criteria.md and any prototypes.\n` +
      `3. Create branch feat/${feature.slug}/plan from ${settings.default_base_branch}.\n` +
      `4. WRITE the ADR as a document at docs/features/${feature.slug}/adr.md — ` +
      `include: context, decision drivers, the chosen architecture with rationale, ` +
      `alternatives considered, and consequences. This is the technical SPEC of the feature.\n` +
      `5. Decompose the work into chunks. For EACH chunk create a GitHub sub-issue via the REST API:\n` +
      `   - Title prefixed with the skill: [backend], [frontend] or [infra]\n` +
      `   - Body: scope, files affected, dependencies, which acceptance criteria it covers\n` +
      `   - Labels: skill:<backend|frontend|infra>, feat:${feature.slug}, status:planned\n` +
      `   - Every acceptance criterion must be covered by at least one chunk.\n` +
      `6. Also write docs/features/${feature.slug}/build-order.md listing the recommended ` +
      `order to implement the chunks (with the issue numbers).\n` +
      `7. Commit, push the branch and open a DRAFT PR.\n` +
      `8. End your turn with: the ADR summary, the list of chunks created (with issue numbers) ` +
      `and the recommended build order.\n\n` +
      `Parent issue: #${feature.github_parent_issue}. ` +
      `Disable git commit signing with -c commit.gpgsign=false. Set a git identity before committing.` +
      credBlock +
      workflowBlock +
      attachmentBlock
    );
  }
  if (stage === "development") {
    return (
      `Chunks for '${feature.slug}' planned. Recommend Dev Agent order.` +
      credBlock +
      workflowBlock +
      attachmentBlock
    );
  }
  if (stage === "qa") {
    return (
      `Write and run the test suite for feature '${feature.slug}'.\n\n` +
      `STEPS:\n` +
      `1. Clone the repo with the credentials below.\n` +
      `2. Read docs/features/${feature.slug}/acceptance-criteria.md — these are the ` +
      `Gherkin scenarios from Discovery. EACH scenario must map to at least one ` +
      `automated test.\n` +
      `3. Check the integration state: list open PRs for this feature ` +
      `(branches containing '${feature.slug}'). \n` +
      `   - If the chunk PRs are ALREADY MERGED into ${settings.default_base_branch}, ` +
      `test against that branch.\n` +
      `   - If PRs are still OPEN (not merged), create an integration branch ` +
      `feat/${feature.slug}/qa from ${settings.default_base_branch} and merge each ` +
      `chunk branch into it. If a merge CONFLICTS, RESOLVE the conflict preserving ` +
      `the intended behavior of every chunk (never discard a chunk's functionality), ` +
      `then continue — only stop and report if a conflict is genuinely unresolvable.\n` +
      `4. Write the test files using the project's test framework, covering every ` +
      `acceptance criterion (aim for >=80% line coverage on new code). If prototypes ` +
      `exist, add visual regression tests.\n` +
      `5. Run lint, typecheck and the full test suite. Iterate until green for ` +
      `issues that are YOUR test bugs.\n` +
      `6. If a test reveals an IMPLEMENTATION bug (not a test bug), comment on the ` +
      `relevant chunk PR/issue with the failing test and stack, apply label ` +
      `status:bug, and report it — do NOT silently fix product code.\n` +
      `7. WRITE a structured report at docs/features/${feature.slug}/qa-report.md ` +
      `with EXACTLY these three sections, each filled with real detail (never leave ` +
      `a heading empty):\n` +
      `   ## Coverage Summary\n` +
      `   - overall line coverage % on new code, and a short per-area breakdown ` +
      `(table: area/file | % | notes).\n` +
      `   ## Scenarios Covered\n` +
      `   - a markdown table with columns: Scenario (from the Gherkin) | Test file | ` +
      `Status (pass/fail). One row per acceptance scenario.\n` +
      `   ## Implementation Bugs Found\n` +
      `   - for each bug: a numbered item with title, severity, the failing scenario, ` +
      `steps/expected/actual, and the chunk PR/issue you commented on. If none, write ` +
      `"No implementation bugs found." explicitly.\n` +
      `   Also put a metadata line at the very top: "coverage: <number>%".\n` +
      `8. Commit, push and open a DRAFT PR with the tests AND the qa-report.md.\n` +
      `9. End your turn with the same three sections (Coverage Summary, Scenarios ` +
      `Covered, Implementation Bugs Found) filled in — these must match qa-report.md.\n\n` +
      `Disable git commit signing with -c commit.gpgsign=false. Set a git identity.` +
      credBlock +
      workflowBlock +
      attachmentBlock
    );
  }
  throw new Error(`no kickoff template for stage ${stage}`);
}
