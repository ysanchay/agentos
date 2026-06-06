import { z } from 'zod';
import { zApprovalID, zAgentID, zUserID } from './primitives.js';

export const zApprovalType = z.enum([
  'capability_invoke', 'resource_allocate', 'permission_grant',
  'workspace_create', 'agent_spawn', 'data_export', 'custom',
]);

export const zApprovalState = z.enum(['pending', 'approved', 'denied', 'expired', 'cancelled']);

export const zApproval = z.object({
  id: zApprovalID,
  type: zApprovalType,
  state: zApprovalState,
  requester_id: z.union([zAgentID, zUserID]),
  approver_id: z.union([zAgentID, zUserID]).optional(),
  resource_type: z.string(),
  resource_id: z.string().optional(),
  action: z.string(),
  action_params: z.unknown().optional(),
  reason: z.string().optional(),
  denial_reason: z.string().optional(),
  expires_at: z.string().datetime(),
  created_at: z.string().datetime(),
  resolved_at: z.string().datetime().optional(),
});