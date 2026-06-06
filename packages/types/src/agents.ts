/**
 * AgentOS Agent Types
 * AgentType, AgentState, Agent interface — from kernel-api-v1.md Section 3.1
 */

import type { ISO8601 } from './temporal.js';
import type { AgentID, CapabilityID, MemoryID, PermissionID, ProjectID, TaskID, UserID, WorkspaceID } from './primitives.js';
import type { Metadata, Tags } from './common.js';
import type { ResourceBudget, ResourceConsumption } from './resource-types.js';

/** Agent role types */
export enum AgentType {
  CHIEF = 'chief',
  MANAGER = 'manager',
  WORKER = 'worker',
  VALIDATOR = 'validator',
  SPECIALIST = 'specialist',
  DAEMON = 'daemon',
  PROXY = 'proxy',
}

/** Agent lifecycle states (10 states, from kernel-api Section 3.1) */
export enum AgentState {
  SPAWNING = 'spawning',
  INITIALIZING = 'initializing',
  READY = 'ready',
  RUNNING = 'running',
  PAUSED = 'paused',
  SUSPENDED = 'suspended',
  ERRORED = 'errored',
  RECOVERING = 'recovering',
  TERMINATING = 'terminating',
  TERMINATED = 'terminated',
}

/** Terminal states — once entered, cannot transition out */
export const AGENT_TERMINAL_STATES: AgentState[] = [AgentState.TERMINATED];

/** Agent interface — the core object (kernel-api Section 3.1) */
export interface Agent {
  id: AgentID;
  name: string;
  type: AgentType;
  state: AgentState;
  workspace_id: WorkspaceID;
  project_id: ProjectID;
  capabilities: CapabilityID[];
  permissions: PermissionID[];
  resources_allocated: ResourceBudget;
  resources_consumed: ResourceConsumption;
  resource_limits: ResourceBudget;
  parent_agent_id?: AgentID;
  child_agent_ids: AgentID[];
  active_task_ids: TaskID[];
  completed_task_count: number;
  failed_task_count: number;
  owner_user_id: UserID;
  public_key: string; // Ed25519 public key (Base64)
  metadata: Metadata;
  tags: Tags;
  created_at: ISO8601;
  updated_at: ISO8601;
  terminated_at?: ISO8601;
}

/** Valid agent state transitions (from kernel-api Section 3.1.2) */
export const AGENT_TRANSITIONS: Record<AgentState, AgentState[]> = {
  [AgentState.SPAWNING]: [AgentState.INITIALIZING],
  [AgentState.INITIALIZING]: [AgentState.READY, AgentState.ERRORED],
  [AgentState.READY]: [AgentState.RUNNING, AgentState.PAUSED, AgentState.TERMINATING],
  [AgentState.RUNNING]: [AgentState.PAUSED, AgentState.SUSPENDED, AgentState.ERRORED, AgentState.TERMINATING],
  [AgentState.PAUSED]: [AgentState.RUNNING, AgentState.TERMINATING],
  [AgentState.SUSPENDED]: [AgentState.RUNNING, AgentState.TERMINATING],
  [AgentState.ERRORED]: [AgentState.RECOVERING, AgentState.TERMINATING],
  [AgentState.RECOVERING]: [AgentState.READY, AgentState.ERRORED, AgentState.TERMINATING],
  [AgentState.TERMINATING]: [AgentState.TERMINATED],
  [AgentState.TERMINATED]: [], // Terminal
};