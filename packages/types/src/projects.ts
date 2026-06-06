/**
 * AgentOS Project Types
 * ProjectState, Project interface — from kernel-api-v1.md Section 3.4
 */

import type { ISO8601 } from './temporal.js';
import type { OrgID, ProjectID, UserID, WorkspaceID, TaskID } from './primitives.js';
import type { Metadata, Tags } from './common.js';
import type { ResourceBudget, ResourceConsumption } from './resource-types.js';

export enum ProjectState {
  PLANNING = 'planning',
  ACTIVE = 'active',
  ON_HOLD = 'on_hold',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

export const PROJECT_TERMINAL_STATES: ProjectState[] = [ProjectState.COMPLETED, ProjectState.ARCHIVED];

export interface Project {
  id: ProjectID;
  name: string;
  description: string;
  state: ProjectState;
  owner_id: UserID;
  organization_id?: OrgID;
  workspace_ids: WorkspaceID[];
  goal_ids: TaskID[];
  deadline?: ISO8601;
  total_budget: ResourceBudget;
  budget_consumed: ResourceConsumption;
  metadata: Metadata;
  tags: Tags;
  created_at: ISO8601;
  updated_at: ISO8601;
  completed_at?: ISO8601;
}