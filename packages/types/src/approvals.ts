/**
 * AgentOS Approval Types
 * ApprovalType, ApprovalState, Approval interface — from kernel-api-v1.md Section 3.10
 */

import type { ISO8601 } from './temporal.js';
import type { AgentID, ApprovalID, UserID } from './primitives.js';

export enum ApprovalType {
  CAPABILITY_INVOKE = 'capability_invoke',
  RESOURCE_ALLOCATE = 'resource_allocate',
  PERMISSION_GRANT = 'permission_grant',
  WORKSPACE_CREATE = 'workspace_create',
  AGENT_SPAWN = 'agent_spawn',
  DATA_EXPORT = 'data_export',
  CUSTOM = 'custom',
}

export enum ApprovalState {
  PENDING = 'pending',
  APPROVED = 'approved',
  DENIED = 'denied',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

export interface Approval {
  id: ApprovalID;
  type: ApprovalType;
  state: ApprovalState;
  requester_id: AgentID | UserID;
  approver_id?: AgentID | UserID;
  resource_type: string;
  resource_id?: string;
  action: string;
  action_params?: unknown;
  reason?: string;
  denial_reason?: string;
  expires_at: ISO8601;
  created_at: ISO8601;
  resolved_at?: ISO8601;
}