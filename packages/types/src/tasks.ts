/**
 * AgentOS Task Types
 * TaskType, TaskState, TaskPriority, Task, TaskError, TaskResult
 * From kernel-api-v1.md Section 3.2 and blackboard-protocol-v1.md Article II
 */

import type { ISO8601 } from './temporal.js';
import type { AgentID, ProjectID, TaskID, WorkspaceID } from './primitives.js';
import type { TaskPriority as TaskPriorityType } from './common.js';
import type { Metadata, Tags } from './common.js';
import type { ResourceBudget, ResourceConsumption } from './resource-types.js';

/** Task type classification */
export enum TaskType {
  GOAL = 'goal',
  OBJECTIVE = 'objective',
  STEP = 'step',
  ACTION = 'action',
  VERIFICATION = 'verification',
  MAINTENANCE = 'maintenance',
}

/** Task lifecycle states (9 states, from kernel-api Section 3.2) */
export enum TaskState {
  DRAFT = 'draft',
  ANNOUNCED = 'announced',
  CLAIMED = 'claimed',
  IN_PROGRESS = 'in_progress',
  BLOCKED = 'blocked',
  REVIEW = 'review',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/** Terminal task states */
export const TASK_TERMINAL_STATES: TaskState[] = [TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED];

/** Valid task state transitions (kernel-api + blackboard combined) */
export const TASK_TRANSITIONS: Record<TaskState, TaskState[]> = {
  [TaskState.DRAFT]: [TaskState.ANNOUNCED, TaskState.CANCELLED],
  [TaskState.ANNOUNCED]: [TaskState.CLAIMED, TaskState.CANCELLED],
  [TaskState.CLAIMED]: [TaskState.IN_PROGRESS, TaskState.ANNOUNCED, TaskState.CANCELLED],
  [TaskState.IN_PROGRESS]: [TaskState.BLOCKED, TaskState.REVIEW, TaskState.COMPLETED, TaskState.FAILED],
  [TaskState.BLOCKED]: [TaskState.IN_PROGRESS, TaskState.FAILED, TaskState.ANNOUNCED],
  [TaskState.REVIEW]: [TaskState.COMPLETED, TaskState.FAILED],
  [TaskState.FAILED]: [TaskState.ANNOUNCED], // Retry (if retry_count < max_retries)
  [TaskState.COMPLETED]: [], // Terminal
  [TaskState.CANCELLED]: [], // Terminal
};

/** Task interface (kernel-api Section 3.2) */
export interface Task {
  id: TaskID;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriorityType;
  state: TaskState;
  workspace_id: WorkspaceID;
  project_id: ProjectID;
  assignee_id?: AgentID;
  claimed_by?: AgentID;
  claimed_at?: ISO8601;
  parent_task_id?: TaskID;
  child_task_ids: TaskID[];
  depends_on: TaskID[];
  blocks: TaskID[];
  resources_required: ResourceBudget;
  resources_allocated?: ResourceBudget;
  result?: unknown;
  error?: string;
  deadline?: ISO8601;
  retry_count: number;
  max_retries: number;
  previous_assignees: AgentID[];
  tags: Tags;
  metadata: Metadata;
  created_at: ISO8601;
  updated_at: ISO8601;
  completed_at?: ISO8601;
  failed_at?: ISO8601;
}

/** Task error information (referenced in blackboard, undefined in constitution) */
export interface TaskError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

/** Task result (from blackboard-protocol Article VI) */
export interface TaskResult {
  task_id: TaskID;
  agent_id: AgentID;
  output: unknown;
  confidence: number; // 0.0 - 1.0
  resources_consumed: ResourceConsumption;
  artifacts: ArtifactRef[];
  duration_ms: number;
  completed_at: ISO8601;
}

/** Artifact reference */
export interface ArtifactRef {
  type: 'memory' | 'file' | 'database' | 'api';
  uri: string;
  checksum: string; // SHA-256
}

/** Previous owner record (from blackboard BlackboardTask) */
export interface PreviousOwner {
  agent_id: AgentID;
  claimed_at: ISO8601;
  released_at: ISO8601;
  reason: string;
  partial_result?: unknown;
}