/**
 * AgentOS Resource Allocation Types
 * AllocationState, ResourceAllocation (flat form), ResourceRequest, Quota types
 * From resource-model-v1.md + kernel-api-v1.md Section 3.8
 */

import type { ISO8601 } from './temporal.js';
import type { AgentID, AllocationID, OrgID, TaskID, UserID, WorkspaceID } from './primitives.js';
import type { Priority } from './common.js';

export enum AllocationState {
  PENDING = 'pending',
  GRANTED = 'granted',
  ACTIVE = 'active',
  THROTTLED = 'throttled',
  PREEMPTED = 'preempted',
  RELEASED = 'released',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

export const ALLOCATION_TERMINAL_STATES: AllocationState[] = [
  AllocationState.RELEASED,
  AllocationState.EXPIRED,
  AllocationState.REVOKED,
];

/** ResourceAllocation — flat form (canonical, from resource-model) */
export interface ResourceAllocation {
  id: AllocationID;
  agent_id: AgentID;
  task_id?: TaskID;
  workspace_id: WorkspaceID;
  state: AllocationState;
  ru_allocated: number;
  mu_allocated: number;
  eu_allocated: number;
  vu_allocated: number;
  ru_consumed: number;
  mu_consumed: number;
  eu_consumed: number;
  vu_consumed: number;
  priority: Priority;
  preemptible: boolean;
  granted_at?: ISO8601;
  expires_at?: ISO8601;
  released_at?: ISO8601;
  created_at: ISO8601;
  updated_at: ISO8601;
}

/** Resource request (from resource-model) */
export interface ResourceRequest {
  requester: AgentID;
  task_id?: TaskID;
  workspace_id: WorkspaceID;
  ru: number;
  mu: number;
  eu: number;
  vu: number;
  priority: Priority;
  duration_ms: number;
  deadline?: ISO8601;
  preemptible: boolean;
  reason: string;
  idempotency_key?: string;
}

// ─── Quota System (4 levels) ────────────────────────────────────────

export interface AgentQuota {
  agent_id: AgentID;
  ru_per_hour: number;
  mu_max: number;
  eu_per_hour: number;
  vu_per_hour: number;
  total_ru_budget: number; // -1 = unlimited
  total_eu_budget: number; // -1 = unlimited
  max_rpm: number;
  max_concurrent_tasks: number;
  burst_ru_per_minute: number;
  burst_eu_per_minute: number;
}

export interface WorkspaceQuota {
  workspace_id: WorkspaceID;
  max_agents: number;
  max_tasks: number;
  max_memory_entries: number;
  total_ru_per_hour: number;
  total_mu: number;
  total_eu_per_hour: number;
  total_vu_per_hour: number;
  max_priority: Priority;
  monthly_ru_budget: number; // -1 = unlimited
  monthly_eu_budget: number; // -1 = unlimited
}

export interface UserQuota {
  user_id: UserID;
  total_workspaces: number;
  total_agents_all_workspaces: number;
  total_ru_per_day: number;
  total_eu_per_day: number;
  billing_limit: number; // -1 = unlimited
  billing_alert_threshold: number; // default: 80
}

export interface EnterpriseQuota {
  org_id: OrgID;
  total_users: number;
  total_workspaces: number;
  total_ru_per_month: number;
  total_mu: number;
  total_eu_per_month: number;
  total_vu_per_month: number;
  sla_tier: 'standard' | 'premium' | 'enterprise';
  dedicated_resources: boolean;
  max_priority: Priority;
  support_response_sla: number; // hours
}

/** Efficiency score per agent */
export interface EfficiencyScore {
  agent_id: AgentID;
  period: '1h' | '24h' | '7d';
  ru_per_task_completed: number;
  eu_per_tool_call: number;
  task_completion_rate: number; // 0-1
  resource_utilization: number; // 0-1
  overall_score: number;
}