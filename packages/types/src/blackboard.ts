/**
 * AgentOS Blackboard Types
 * Blackboard, BlackboardTask, sections, LockType, ConflictStrategy, etc.
 * From blackboard-protocol-v1.md Articles I-IX
 */

import type { ISO8601 } from './temporal.js';
import type { AgentID, ConsensusID, TaskID, WorkspaceID } from './primitives.js';
import type { TaskType, TaskState, TaskResult, ArtifactRef, PreviousOwner } from './tasks.js';
import type { TaskPriority } from './common.js';
import type { ResourceBudget } from './resource-types.js';
import type { ResourceAllocation } from './allocations.js';

// ─── Blackboard Structure ──────────────────────────────────────────

export interface Blackboard {
  id: string;
  workspace_id: WorkspaceID;
  sections: {
    goals: GoalSection;
    tasks: TaskSection;
    claims: ClaimSection;
    results: ResultSection;
    context: ContextSection;
    consensus: ConsensusSection;
    errors: ErrorSection;
  };
  created_at: ISO8601;
  updated_at: ISO8601;
}

/** Section types — typed arrays/maps of their entries */
export interface GoalSection {
  entries: GoalEntry[];
}

export interface TaskSection {
  entries: BlackboardTask[];
}

export interface ClaimSection {
  active_claims: Map<TaskID, AgentID>;
}

export interface ResultSection {
  entries: TaskResult[];
}

export interface ContextSection {
  entries: SharedContext[];
}

export interface ConsensusSection {
  records: ConsensusRecord[];
}

export interface ErrorSection {
  entries: BlackboardError[];
}

export interface GoalEntry {
  id: string;
  title: string;
  description: string;
  proposer: AgentID;
  created_at: ISO8601;
}

export interface BlackboardError {
  id: string;
  task_id?: TaskID;
  agent_id: AgentID;
  error_code: string;
  error_message: string;
  timestamp: ISO8601;
}

// ─── BlackboardTask (extends Task with ownership tracking) ──────────

export interface BlackboardTask {
  id: TaskID;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  state: TaskState;
  owner?: AgentID;
  owner_since?: ISO8601;
  previous_owners: PreviousOwner[];
  depends_on: TaskID[];
  blocks: TaskID[];
  resources_required: ResourceBudget;
  resources_allocated?: ResourceAllocation;
  result?: TaskResult;
  error?: { code: string; message: string; retryable: boolean; details?: unknown };
  retry_count: number;
  max_retries: number;
  deadline?: ISO8601;
  created_at: ISO8601;
  updated_at: ISO8601;
  completed_at?: ISO8601;
  tags: string[];
}

// ─── Lock Types ─────────────────────────────────────────────────────

export type LockType = 'read' | 'write' | 'upgrade';

// ─── Conflict Resolution ───────────────────────────────────────────

export type ConflictStrategy = 'first-wins' | 'vote' | 'chief-decides' | 'merge';

// ─── Shared Context ────────────────────────────────────────────────

export interface SharedContext {
  key: string;
  value: unknown;
  source_agent: AgentID;
  confidence: number; // 0.0 - 1.0
  scope: 'task' | 'workspace' | 'project';
  expires_at?: ISO8601;
  tags: string[];
  updated_at: ISO8601;
  version: number;
}

// ─── Consensus ──────────────────────────────────────────────────────

export type ConsensusStrategy = 'unanimous' | 'majority' | 'supermajority' | 'chief-decides' | 'weighted';

export interface ConsensusRecord {
  id: ConsensusID;
  topic: string;
  proposer: AgentID;
  options: { label: string; description: string }[];
  votes: { agent_id: AgentID; option: string; timestamp: ISO8601 }[];
  strategy: ConsensusStrategy;
  status: 'voting' | 'resolved' | 'expired';
  result?: string;
  deadline: ISO8601;
  created_at: ISO8601;
}

// ─── Retry Policy ───────────────────────────────────────────────────

export interface RetryPolicy {
  max_retries: number;
  backoff: 'fixed' | 'linear' | 'exponential';
  initial_delay_ms: number;
  max_delay_ms: number;
  jitter: boolean;
  retry_on: string[];
}