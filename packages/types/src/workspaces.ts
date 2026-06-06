/**
 * AgentOS Workspace Types
 * WorkspaceState, Workspace interface — from kernel-api-v1.md Section 3.3
 */

import type { ISO8601 } from './temporal.js';
import type { AgentID, ProjectID, TaskID, UserID, WorkspaceID } from './primitives.js';
import type { Metadata, Tags, TaskPriority } from './common.js';
import type { ResourceBudget, ResourceConsumption } from './resource-types.js';

/** Workspace lifecycle states (8 states) */
export enum WorkspaceState {
  CREATING = 'creating',
  ACTIVE = 'active',
  PAUSED = 'paused',
  LOCKED = 'locked',
  ARCHIVING = 'archiving',
  ARCHIVED = 'archived',
  DELETING = 'deleting',
  DELETED = 'deleted',
}

export const WORKSPACE_TERMINAL_STATES: WorkspaceState[] = [WorkspaceState.DELETED];

export const WORKSPACE_TRANSITIONS: Record<WorkspaceState, WorkspaceState[]> = {
  [WorkspaceState.CREATING]: [WorkspaceState.ACTIVE],
  [WorkspaceState.ACTIVE]: [WorkspaceState.PAUSED, WorkspaceState.LOCKED, WorkspaceState.ARCHIVING],
  [WorkspaceState.PAUSED]: [WorkspaceState.ACTIVE, WorkspaceState.ARCHIVING],
  [WorkspaceState.LOCKED]: [WorkspaceState.ACTIVE, WorkspaceState.ARCHIVING],
  [WorkspaceState.ARCHIVING]: [WorkspaceState.ARCHIVED],
  [WorkspaceState.ARCHIVED]: [WorkspaceState.DELETING],
  [WorkspaceState.DELETING]: [WorkspaceState.DELETED],
  [WorkspaceState.DELETED]: [], // Terminal
};

/** Workspace interface (kernel-api Section 3.3) */
export interface Workspace {
  id: WorkspaceID;
  name: string;
  description: string;
  state: WorkspaceState;
  project_id: ProjectID;
  owner_id: UserID;
  agent_ids: AgentID[];
  task_ids: TaskID[];
  resource_quota: ResourceBudget;
  resource_consumed: ResourceConsumption;
  max_agents: number;
  memory_scope: 'workspace' | 'project' | 'shared';
  default_priority: TaskPriority;
  auto_pause_on_budget_exhaustion: boolean;
  metadata: Metadata;
  tags: Tags;
  created_at: ISO8601;
  updated_at: ISO8601;
  archived_at?: ISO8601;
  deleted_at?: ISO8601;
}