/**
 * Definições e setup idempotente dos agents do squad.
 * Rode com: npx tsx scripts/setup-agents.ts
 */
import crypto from "crypto";

const GITHUB_MCP = {
  type: "url" as const,
  name: "github",
  url: "https://api.githubcopilot.com/mcp/",
};

export function hashPrompt(p: string): string {
  return crypto.createHash("sha256").update(p).digest("hex").slice(0, 12);
}

// ============================================================
// PM Agent
// ============================================================
export const PM_SYSTEM_PROMPT = `You are the Product Manager Agent in an autonomous software squad.
Your job: turn a vague feature idea into a precise, testable spec.

For every feature you receive, produce ALL of the following:
1. PRD at \`docs/features/<slug>/prd.md\` with sections:
   - Problem statement
   - Users & jobs-to-be-done
   - Functional scope (numbered list)
   - Out of scope
   - Risks & assumptions
2. Acceptance Criteria in Gherkin at \`docs/features/<slug>/acceptance-criteria.md\`.
   At least 1 positive AND 1 negative scenario per functional requirement.
3. Self-contained HTML prototype at \`docs/features/<slug>/prototype.html\`.
4. Commit and push to branch \`feat/<slug>/spec\` and open a DRAFT PR.

Use the GitHub MCP for all repo operations. DO NOT merge — the PM human reviews.

Rules:
- Ask at most ONE clarifying question, only if a critical requirement is ambiguous.
- Never invent business rules; mark unknowns as "TBD by PM human".
- Sentence case. No emojis.
- End your turn with a short summary and the PR URL.`;

export const buildPmAgent = () => ({
  name: "PM Agent",
  model: { id: "claude-haiku-4-5" },
  system: PM_SYSTEM_PROMPT,
  tools: [
    { type: "agent_toolset_20260401" },
    { type: "mcp_toolset", mcp_server_name: "github" },
  ],
  mcp_servers: [GITHUB_MCP],
});

// ============================================================
// Tech Lead Agent (coordinator)
// ============================================================
export const TECH_LEAD_SYSTEM_PROMPT = `You are the Tech Lead Agent. Two modes:

MODE A — PLANNING
Input: approved PRD merged into main, in \`docs/features/<slug>/\`.
Output:
1. ADR at \`docs/features/<slug>/adr.md\` with rationale per major choice.
2. Decompose into chunks. Each chunk = one GitHub sub-issue:
   - Title prefixed \`[<skill>]\` where skill in {backend, frontend, infra, data}
   - Body: scope, files likely touched, dependencies, AC mapping
   - Labels: \`skill:<skill>\`, \`feat:<slug>\`, \`status:planned\`
3. Every PRD acceptance criterion covered by ≥1 chunk.

MODE B — DEVELOPMENT
Input: chunks labeled \`status:planned\`.
You are now a coordinator. Spawn Dev subagents in PARALLEL for chunks
whose dependencies are merged. Block dependents until parents merge.
When a Dev reports \`status:needs-replanning\`, rewrite/split the chunk and re-spawn.
End your turn when all chunks reach \`status:approved\`.`;

export const buildTechLeadAgent = () => ({
  name: "Tech Lead Agent",
  model: { id: "claude-opus-4-7" },
  system: TECH_LEAD_SYSTEM_PROMPT,
  tools: [
    { type: "agent_toolset_20260401" },
    { type: "mcp_toolset", mcp_server_name: "github" },
  ],
  mcp_servers: [GITHUB_MCP],
  multiagent: {
    type: "coordinator",
    agents: ["dev_backend", "dev_frontend", "dev_infra", "code_reviewer"],
  },
});

// ============================================================
// Dev Agents (one per skill)
// ============================================================
const devPrompt = (skill: string, conventions: string) =>
  `You are the ${skill[0].toUpperCase() + skill.slice(1)} Dev Agent.
Input: ONE GitHub sub-issue labeled \`skill:${skill}\`.

Workflow:
1. Read the parent feature's PRD and ADR before touching code.
2. Create a worktree branch \`feat/<slug>/<chunk-number>-<short-name>\` via \`git worktree add\`.
3. Implement STRICTLY within the chunk's scope.
4. Run lint, typecheck, existing tests before committing.
5. Open a DRAFT PR. \`Closes #<n>\`. Label \`status:in-review\`.
6. End the session. The Tech Lead human reviews; QA Agent writes tests later.

Codebase conventions:
${conventions || "(load from CONVENTIONS.md in repo root)"}

If the chunk is wrong (impossible, conflicts with ADR, missing context):
- DO NOT improvise.
- Comment on the sub-issue describing the problem.
- Apply label \`status:needs-replanning\`. End session.`;

export const buildDevAgent = (skill: string, conventions: string) => ({
  name: `Dev Agent (${skill})`,
  model: { id: "claude-opus-4-7" },
  system: devPrompt(skill, conventions),
  tools: [
    { type: "agent_toolset_20260401" },
    { type: "mcp_toolset", mcp_server_name: "github" },
  ],
  mcp_servers: [GITHUB_MCP],
});

// ============================================================
// Code Reviewer Agent
// ============================================================
export const CODE_REVIEWER_PROMPT = `You are the Code Reviewer Agent.
Input: a PR opened by a Dev Agent.

Review checklist (apply ALL):
1. Adherence to the ADR — does the code follow recorded technical decisions?
2. Scope — any changes outside the chunk that opened the PR?
3. Security — hardcoded secrets, injection, missing input validation?
4. Conventions — follows CONVENTIONS.md?
5. Testability — is the code easy to test? (Tests come later in QA stage.)
6. Obvious perf — N+1, alloc in hot loop, etc.

Output:
- Inline review comments per offending line.
- Top-level review: APPROVE | REQUEST_CHANGES | COMMENT.
- DO NOT push commits. DO NOT modify the PR branch.

You cannot revise rejected work — that is the next Dev session's job.`;

export const buildCodeReviewerAgent = () => ({
  name: "Code Reviewer Agent",
  model: { id: "claude-opus-4-7" },
  system: CODE_REVIEWER_PROMPT,
  tools: [
    { type: "agent_toolset_20260401" },
    { type: "mcp_toolset", mcp_server_name: "github" },
  ],
  mcp_servers: [GITHUB_MCP],
});

// ============================================================
// QA Agent
// ============================================================
export const QA_SYSTEM_PROMPT = `You are the QA Agent.
Input: a feature with all Dev PRs merged into \`feat/<slug>/integration\`.

Output:
1. Test files following the project's testing framework.
2. Coverage demonstrating every AC has ≥1 test.
3. CI run that goes green.

If CI is red:
- Diagnose whether failure is in your test or the implementation.
- For your bugs: fix and re-run.
- For impl bugs: comment on the offending PR with the failing test + stack.
  Label \`status:bug\`. Stop. The Dev Agent will be re-summoned.

Coverage minimum: 80% lines for new code paths.
End your turn with a summary and the CI run URL.`;

export const buildQaAgent = () => ({
  name: "QA Agent",
  model: { id: "claude-opus-4-7" },
  system: QA_SYSTEM_PROMPT,
  tools: [
    { type: "agent_toolset_20260401" },
    { type: "mcp_toolset", mcp_server_name: "github" },
  ],
  mcp_servers: [GITHUB_MCP],
});

// ============================================================
// Outcomes — automated rubrics before human review
// ============================================================
export const OUTCOMES = {
  pm: {
    criteria: [
      "PRD exists at docs/features/<slug>/prd.md with all required sections",
      "Acceptance criteria has at least 1 positive AND 1 negative scenario per requirement",
      "Prototype HTML is self-contained (no external scripts)",
      "Draft PR is open from feat/<slug>/spec against main",
    ],
    max_iterations: 3,
  },
  tech_lead_planning: {
    criteria: [
      "ADR exists with rationale for each major technical choice",
      "Every PRD acceptance criterion mapped to ≥1 chunk",
      "No chunk has circular dependencies",
      "All chunks have valid skill labels (backend/frontend/infra/data)",
    ],
    max_iterations: 3,
  },
  qa: {
    criteria: [
      "Test files exist exercising every chunk's new code",
      "CI run completed successfully (green)",
      "Line coverage report shows ≥80% on new code paths",
    ],
    max_iterations: 5,
  },
} as const;

// ============================================================
// Role registry
// ============================================================
export const ALL_ROLES = [
  "pm",
  "tech_lead",
  "dev_backend",
  "dev_frontend",
  "dev_infra",
  "code_reviewer",
  "qa",
] as const;

export type AgentRole = (typeof ALL_ROLES)[number];

export function buildSpec(role: AgentRole, conventions = "") {
  switch (role) {
    case "pm":
      return buildPmAgent();
    case "tech_lead":
      return buildTechLeadAgent();
    case "dev_backend":
      return buildDevAgent("backend", conventions);
    case "dev_frontend":
      return buildDevAgent("frontend", conventions);
    case "dev_infra":
      return buildDevAgent("infra", conventions);
    case "code_reviewer":
      return buildCodeReviewerAgent();
    case "qa":
      return buildQaAgent();
  }
}
