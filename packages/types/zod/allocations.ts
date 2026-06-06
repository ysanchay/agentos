import { z } from 'zod';
import { zAgentID, zAllocationID, zTaskID, zWorkspaceID } from './primitives.js';
import { zPriority } from './common.js';
import { zResourceBudget, zResourceConsumption } from './resource-types.js';

export const zAllocationState = z.enum([
  'pending', 'granted', 'active', 'throttled', 'preempted', 'released', 'expired', 'revoked',
]);

export const zResourceAllocation = z.object({
  id: zAllocationID,
  agent_id: zAgentID,
  task_id: zTaskID.optional(),
  workspace_id: zWorkspaceID,
  state: zAllocationState,
  ru_allocated: z.number().nonnegative(),
  mu_allocated: z.number().nonnegative(),
  eu_allocated: z.number().nonnegative(),
  vu_allocated: z.number().nonnegative(),
  ru_consumed: z.number().nonnegative(),
  mu_consumed: z.number().nonnegative(),
  eu_consumed: z.number().nonnegative(),
  vu_consumed: z.number().nonnegative(),
  priority: zPriority,
  preemptible: z.boolean(),
  granted_at: z.string().datetime().optional(),
  expires_at: z.string().datetime().optional(),
  released_at: z.string().datetime().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const zResourceRequest = z.object({
  requester: zAgentID,
  task_id: zTaskID.optional(),
  workspace_id: zWorkspaceID,
  ru: z.number().nonnegative(),
  mu: z.number().nonnegative(),
  eu: z.number().nonnegative(),
  vu: z.number().nonnegative(),
  priority: zPriority,
  duration_ms: z.number().positive(),
  deadline: z.string().datetime().optional(),
  preemptible: z.boolean(),
  reason: z.string(),
  idempotency_key: z.string().optional(),
});