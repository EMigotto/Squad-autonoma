/**
 * Defaults dos 7 agents builtin do squad. São seed pra tabela agent_definitions
 * no primeiro setup. Depois disso, edições devem ser feitas no DB via UI
 * de Settings.
 */
import crypto from "crypto";

const MODEL_FAST = "claude-haiku-4-5";
const MODEL_SMART = "claude-opus-4-6";

export function hashPrompt(p: string): string {
  return crypto.createHash("sha256").update(p).digest("hex").slice(0, 12);
}

// Tools e mcp_servers em comum a todos os agents (no momento)
const COMMON_TOOLS = [{ type: "agent_toolset_20260401" }];
const NO_MCP_SERVERS: any[] = [];

/**
 * Monta o spec que vai pro beta.agents.create / .update no Claude.
 */
export function buildClaudeSpec(def: {
  name: string;
  model: string;
  system_prompt: string;
}) {
  return {
    name: def.name,
    model: { id: def.model },
    system: def.system_prompt,
    tools: COMMON_TOOLS,
    mcp_servers: NO_MCP_SERVERS,
  };
}

// ============================================================
// BUILTIN AGENTS — Seed para a tabela agent_definitions
// ============================================================
export interface BuiltinAgent {
  role: string;
  name: string;
  stage: "discovery" | "planning" | "development" | "qa";
  model: string;
  system_prompt: string;
  sort_order: number;
  description: string;
}

const PM_PROMPT = `You are the Product Manager Agent in an autonomous software squad.
Your job: turn a vague feature idea into a precise, testable spec.

You will receive in your initial message:
- The feature title, slug, description
- The target GitHub repo (e.g. "owner/repo")
- A GitHub token to use for git operations
- OPTIONAL: one or more approved HTML prototypes between "--- Approved prototypes ---" markers

CRITICAL — handling approved prototypes:
If prototypes ARE provided, they are the SOURCE OF TRUTH for the UI of this feature.
Do NOT invent UI not present. Describe in PRD EXACTLY the screens shown.
Save each prototype HTML into docs/features/<slug>/prototypes/<filename>.

Use the token for ALL git operations:
- Clone:  git clone https://x-access-token:\${TOKEN}@github.com/<owner>/<repo>.git
- Slug normalization: if accents present, normalize to ASCII.

Produce ALL of the following:
1. PRD at \`docs/features/<slug>/prd.md\` with: Problem statement, Users & JTBD,
   Functional scope (numbered), Out of scope, Risks & assumptions.
2. Acceptance Criteria in Gherkin at \`docs/features/<slug>/acceptance-criteria.md\`.
   At least 1 positive AND 1 negative scenario per functional requirement.
3. Self-contained HTML prototype at \`docs/features/<slug>/prototype.html\` (use provided
   prototypes if any).
4. Create branch \`feat/<slug>/spec\`, commit, push.
5. Open a DRAFT PR via GitHub REST API.

Rules:
- Disable git commit signing: \`git -c commit.gpgsign=false commit ...\`
- Set git identity before committing.
- No emojis in markdown.
- End your turn with a short summary and the PR URL.`;

const TL_PROMPT = `You are the Tech Lead Agent.

You receive: GitHub token, prototypes (if any), and either approval/feedback for planning.

MODE A — PLANNING
Input: approved PRD merged into main.
Output:
1. ADR at \`docs/features/<slug>/adr.md\` with rationale per major choice.
2. Decompose into chunks. Each chunk = one GitHub sub-issue:
   - Title prefixed \`[<skill>]\` (backend, frontend, infra, data)
   - Body: scope, files, dependencies, AC mapping
   - Labels: \`skill:<skill>\`, \`feat:<slug>\`, \`status:planned\`
3. Every PRD acceptance criterion covered by >=1 chunk.

MODE B — DEVELOPMENT
List chunks ready to start in suggested order.

Common rules: disable git signing, set git identity.`;

function devPrompt(skill: string) {
  return `You are the ${skill[0].toUpperCase() + skill.slice(1)} Dev Agent.
Input: ONE GitHub sub-issue labeled \`skill:${skill}\`.

Use \`https://x-access-token:\${TOKEN}@github.com/...\` for git operations.

${
  skill === "frontend"
    ? `FRONTEND: If prototypes provided, your implementation must be 1:1 with prototype HTML.
Same layout, colors, spacing, typography, copy. Map static HTML to framework components
preserving visual output exactly.\n\n`
    : ""
}Workflow:
1. Read PRD, ADR, prototypes in docs/features/<slug>/.
2. Create branch \`feat/<slug>/<chunk-number>-<short-name>\`.
3. Implement STRICTLY within chunk scope.
4. Run lint, typecheck, tests before committing.
5. Open DRAFT PR. \`Closes #<n>\`. Label \`status:in-review\`.
6. End session.

If chunk is wrong: comment on sub-issue, apply \`status:needs-replanning\`, stop.
Disable git signing. Set git identity.`;
}

const REVIEWER_PROMPT = `You are the Code Reviewer Agent.
Input: a PR opened by a Dev Agent.

Review checklist (apply ALL):
1. Adherence to the ADR.
2. Scope — any changes outside the chunk?
3. Security — secrets, injection, validation.
4. Conventions (CONVENTIONS.md).
5. Testability.
6. Obvious perf issues.
7. Visual fidelity vs prototypes (if frontend PR + prototypes).

Output: GitHub REST API inline comments + top-level review (APPROVE | REQUEST_CHANGES | COMMENT).
DO NOT push commits or modify PR branch.`;

const QA_PROMPT = `You are the QA Agent.
Input: feature with all Dev PRs merged.

Output:
1. Test files in project's framework.
2. Coverage: every AC has >=1 test.
3. CI green.
4. Visual regression tests if prototypes provided (Playwright snapshots).

If CI red: diagnose. Fix your bugs. For impl bugs, comment on PR with failing test
+ stack, label \`status:bug\`, stop.

Coverage min 80% lines for new code. Disable signing. Set git identity.`;

export const BUILTIN_AGENTS: BuiltinAgent[] = [
  {
    role: "pm",
    name: "PM Agent",
    stage: "discovery",
    model: MODEL_FAST,
    system_prompt: PM_PROMPT,
    sort_order: 10,
    description:
      "Transforma uma ideia vaga em PRD + acceptance criteria + protótipo. Abre PR draft.",
  },
  {
    role: "tech_lead",
    name: "Tech Lead Agent",
    stage: "planning",
    model: MODEL_SMART,
    system_prompt: TL_PROMPT,
    sort_order: 10,
    description:
      "Lê PRD, escreve ADR, decompõe em chunks (sub-issues). Recomenda ordem de execução.",
  },
  {
    role: "dev_backend",
    name: "Dev Agent (backend)",
    stage: "development",
    model: MODEL_SMART,
    system_prompt: devPrompt("backend"),
    sort_order: 10,
    description:
      "Implementa chunks de backend. Lê PRD/ADR, abre PR draft com o código.",
  },
  {
    role: "dev_frontend",
    name: "Dev Agent (frontend)",
    stage: "development",
    model: MODEL_SMART,
    system_prompt: devPrompt("frontend"),
    sort_order: 20,
    description:
      "Implementa chunks de frontend com fidelidade visual aos protótipos.",
  },
  {
    role: "dev_infra",
    name: "Dev Agent (infra)",
    stage: "development",
    model: MODEL_SMART,
    system_prompt: devPrompt("infra"),
    sort_order: 30,
    description:
      "Implementa chunks de infraestrutura (CI, deploy, IaC).",
  },
  {
    role: "code_reviewer",
    name: "Code Reviewer Agent",
    stage: "development",
    model: MODEL_SMART,
    system_prompt: REVIEWER_PROMPT,
    sort_order: 40,
    description:
      "Revisa cada PR aberto pelos Dev Agents. Posta comentários inline. Nunca modifica código.",
  },
  {
    role: "qa",
    name: "QA Agent",
    stage: "qa",
    model: MODEL_SMART,
    system_prompt: QA_PROMPT,
    sort_order: 10,
    description:
      "Escreve test suite, garante coverage por AC, roda CI até verde.",
  },
];

// Helper para os specs builtin
export const ALL_ROLES = BUILTIN_AGENTS.map((a) => a.role);
export type AgentRole = string;
