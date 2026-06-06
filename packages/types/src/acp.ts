/**
 * AgentOS ACP (Agent Communication Protocol) Types
 * ACPMessage, all 37 message type payloads, from acp-v1.md
 */

import type { ISO8601 } from './temporal.js';
import type { AgentID, AllocationID, ApprovalID, CapabilityID, ChannelID, MemoryID, TaskID, WorkspaceID, ProjectID } from './primitives.js';
import type { ACPPriority, Metadata } from './common.js';
import type { ResourceBudget, ResourceConsumption } from './resource-types.js';
import type { AgentState, AgentType } from './agents.js';
import type { ApprovalType } from './approvals.js';
import type { MemoryType, MemoryTier, MemoryRelation } from './memory.js';
import type { AllocationState, ResourceRequest } from './allocations.js';
import type { TaskType, TaskState } from './tasks.js';

// ─── ACP Message Types (37 types across 7 categories) ──────────────

export type MessageType =
  // System (5)
  | 'agent.spawn' | 'agent.terminate' | 'agent.heartbeat' | 'capability.advertise' | 'agent.status'
  // Task (8)
  | 'task.create' | 'task.assign' | 'task.claim' | 'task.release' | 'task.complete' | 'task.fail' | 'task.cancel' | 'task.progress'
  // Communication (4)
  | 'rpc.request' | 'rpc.response' | 'rpc.error' | 'broadcast'
  // Event (3)
  | 'event.publish' | 'event.subscribe' | 'event.unsubscribe'
  // Approval (4)
  | 'approval.request' | 'approval.grant' | 'approval.deny' | 'approval.expired'
  // Memory (4)
  | 'memory.store' | 'memory.retrieve' | 'memory.search' | 'memory.delete'
  // Resource (5)
  | 'resource.allocate' | 'resource.grant' | 'resource.deny' | 'resource.release' | 'resource.warning'
  // Error (4)
  | 'error.timeout' | 'error.rate_limit' | 'error.unauthorized' | 'error.invalid'
  // Dead Letter
  | 'dead.letter';

/** ACP Message — the universal communication envelope */
export interface ACPMessage {
  id: string; // UUID v7
  version: string; // "1.0"
  type: MessageType;
  channel: string;
  priority: ACPPriority;
  sender: AgentID;
  recipient: AgentID | '*' | ChannelID;
  correlation_id?: string;
  causation_id?: string;
  timestamp: string; // ISO 8601
  ttl?: number;
  payload: unknown;
  metadata?: Metadata;
  signature: string; // Base64 Ed25519 signature
  signature_algorithm: 'ed25519';
}

// ─── Payload Interfaces (all 37) ───────────────────────────────────

// System payloads
export interface AgentSpawnPayload {
  agent_name: string;
  agent_type: AgentType;
  workspace_id: WorkspaceID;
  capabilities: string[];
  public_key: string;
  resource_budget?: ResourceBudget;
  metadata?: Metadata;
}

export interface AgentTerminatePayload {
  agent_id: AgentID;
  reason: 'user_request' | 'admin' | 'parent' | 'budget_exhausted' | 'security' | 'error_max_retries';
  graceful: boolean;
}

export interface AgentHeartbeatPayload {
  agent_id: AgentID;
  state: AgentState;
  active_tasks: number;
  resources_consumed: ResourceConsumption;
  timestamp: ISO8601;
}

export interface CapabilityAdvertisePayload {
  agent_id: AgentID;
  capabilities: { capability_id: CapabilityID; version: string; quality_score?: number }[];
}

export interface AgentStatusPayload {
  agent_id: AgentID;
  previous_state: AgentState;
  new_state: AgentState;
  reason: string;
}

// Task payloads
export interface TaskCreatePayload {
  task_id: TaskID;
  title: string;
  description: string;
  type: TaskType;
  priority: number;
  workspace_id: WorkspaceID;
  project_id?: ProjectID;
  parent_task_id?: TaskID;
  depends_on?: TaskID[];
  resources_required?: ResourceBudget;
  deadline?: ISO8601;
  max_retries?: number;
  tags?: string[];
}

export interface TaskAssignPayload {
  task_id: TaskID;
  agent_id: AgentID;
  assigned_by: AgentID;
}

export interface TaskClaimPayload {
  task_id: TaskID;
  agent_id: AgentID;
  capabilities_matched: CapabilityID[];
  estimated_resources: ResourceBudget;
}

export interface TaskReleasePayload {
  task_id: TaskID;
  agent_id: AgentID;
  reason: 'voluntary' | 'timeout' | 'blocked' | 'preempted';
  partial_result?: unknown;
}

export interface TaskCompletePayload {
  task_id: TaskID;
  agent_id: AgentID;
  result: unknown;
  confidence: number;
  resources_consumed: ResourceConsumption;
  duration_ms: number;
  artifacts?: string[];
}

export interface TaskFailPayload {
  task_id: TaskID;
  agent_id: AgentID;
  error_code: string;
  error_message: string;
  retryable: boolean;
  partial_result?: unknown;
}

export interface TaskCancelPayload {
  task_id: TaskID;
  cancelled_by: AgentID | string;
  reason: string;
  cascade: boolean;
}

export interface TaskProgressPayload {
  task_id: TaskID;
  agent_id: AgentID;
  percent_complete: number;
  status_message: string;
  estimated_remaining_ms?: number;
}

// Communication payloads
export interface RPCRequestPayload {
  method: string;
  params: unknown;
  idempotency_key?: string;
  timeout_ms?: number;
}

export interface RPCResponsePayload {
  result: unknown;
  duration_ms: number;
}

export interface RPCErrorPayload {
  error_code: string;
  error_message: string;
  retryable: boolean;
  retry_after_ms?: number;
}

export interface BroadcastPayload {
  topic: string;
  message: string;
  data?: unknown;
  expires_at?: ISO8601;
}

// Event payloads
export interface EventPublishPayload {
  event_type: string;
  event_data: unknown;
  scope: 'workspace' | 'project' | 'global';
}

export interface EventSubscribePayload {
  event_types: string[];
  filter?: Record<string, unknown>;
}

export interface EventUnsubscribePayload {
  subscription_id: string;
}

// Approval payloads
export interface ApprovalRequestPayload {
  approval_type: ApprovalType;
  resource_type: string;
  resource_id?: string;
  action: string;
  action_params?: unknown;
  reason: string;
  urgency: 'low' | 'normal' | 'high' | 'critical';
  timeout_ms: number;
}

export interface ApprovalGrantPayload {
  approval_id: ApprovalID;
  approved_by: AgentID | string;
  conditions?: string[];
}

export interface ApprovalDenyPayload {
  approval_id: ApprovalID;
  denied_by: AgentID | string;
  reason: string;
  alternative?: string;
}

export interface ApprovalExpiredPayload {
  approval_id: ApprovalID;
  expired_at: ISO8601;
  auto_denied: true;
}

// Memory payloads
export interface MemoryStorePayload {
  memory_id: MemoryID;
  type: MemoryType;
  content: unknown;
  summary?: string;
  tags?: string[];
  confidence?: number;
  relations?: MemoryRelation[];
  expires_at?: ISO8601;
  tier?: MemoryTier;
}

export interface MemoryRetrievePayload {
  memory_id: MemoryID;
  include_relations?: boolean;
  include_history?: boolean;
}

export interface MemorySearchPayload {
  query: string;
  workspace_id: WorkspaceID;
  types?: MemoryType[];
  tags?: string[];
  semantic?: boolean;
  limit?: number;
  offset?: number;
}

export interface MemoryDeletePayload {
  memory_id: MemoryID;
  reason: string;
  soft_delete: boolean; // MUST be true
}

// Resource payloads
export interface ResourceAllocatePayload {
  agent_id: AgentID;
  task_id?: TaskID;
  ru: number;
  mu: number;
  eu: number;
  vu: number;
  priority: number;
  preemptible: boolean;
  duration_ms?: number;
}

export interface ResourceGrantPayload {
  allocation_id: AllocationID;
  granted: ResourceBudget;
  expires_at?: ISO8601;
}

export interface ResourceDenyPayload {
  reason: 'quota_exceeded' | 'unavailable' | 'permission_denied';
  requested: ResourceBudget;
  available: ResourceBudget;
  retry_after_ms?: number;
}

export interface ResourceReleasePayload {
  allocation_id: AllocationID;
  consumed: ResourceConsumption;
  released: ResourceBudget;
}

export interface ResourceWarningPayload {
  agent_id: AgentID;
  resource_type: string;
  percent_consumed: number;
  budget_remaining: number;
  estimated_exhaustion_at?: ISO8601;
}

// Error payloads
export interface ErrorTimeoutPayload {
  operation: string;
  timeout_ms: number;
  correlation_id?: string;
  retryable: true;
}

export interface ErrorRateLimitPayload {
  limit: number;
  window_ms: number;
  current_count: number;
  retry_after_ms: number;
}

export interface ErrorUnauthorizedPayload {
  agent_id: AgentID;
  permission_required: string;
  resource_type: string;
  resource_id?: string;
}

export interface ErrorInvalidPayload {
  field: string;
  constraint: string;
  value: unknown;
  schema_ref?: string;
}

// Dead Letter
export interface DeadLetterPayload {
  original_message_id: string;
  original_message_type: MessageType;
  failure_reason: string;
  retry_attempts: number;
  max_retries: number;
  original_sender: AgentID;
  timestamp: ISO8601;
  can_replay: boolean;
}

/** ACP Error structure */
export interface ACPError {
  error_code: string;
  error_message: string;
  retryable: boolean;
  retry_after_ms?: number;
  details?: unknown;
}

/** Liveness states from heartbeat tracking */
export type LivenessState = 'healthy' | 'suspect' | 'degraded' | 'failed';