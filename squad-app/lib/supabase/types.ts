export type StageCode =
  | "backlog"
  | "discovery"
  | "planning"
  | "development"
  | "qa"
  | "done";

export type CardStatus =
  | "queued"
  | "running"
  | "awaiting_review"
  | "approved"
  | "rejected"
  | "done";

export type ChunkStatus =
  | "planned"
  | "claimed"
  | "in_progress"
  | "in_review"
  | "approved"
  | "rejected"
  | "done";

export type UserRole = "pm" | "tech_lead" | "qa" | "admin";

export interface Feature {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  current_stage: StageCode;
  claude_memory_store_id: string | null;
  claude_environment_id: string | null;
  github_repo: string;
  github_parent_issue: number | null;
  github_vault_credential: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Card {
  id: string;
  feature_id: string;
  stage: StageCode;
  claude_session_id: string | null;
  claude_agent_id: string | null;
  status: CardStatus;
  created_at: string;
  updated_at: string;
}

export interface HumanGate {
  id: string;
  card_id: string;
  assignee_id: string | null;
  summary: string | null;
  artifacts_json: unknown;
  decision: "approved" | "rejected" | null;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface UserProfile {
  id: string;
  name: string;
  role: UserRole;
  slack_id: string | null;
  created_at: string;
}

export interface BoardCard extends Card {
  feature: Pick<Feature, "id" | "slug" | "title">;
  gate?: {
    id: string;
    summary: string | null;
    assignee_name: string | null;
  } | null;
}
