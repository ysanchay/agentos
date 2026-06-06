import { z } from 'zod';
import { zAgentID, zTaskID, zConsensusID } from './primitives.js';
import { zTaskPriorityValue } from './common.js';
import { zResourceBudget } from './resource-types.js';

export const zLockType = z.enum(['read', 'write', 'upgrade']);
export const zConflictStrategy = z.enum(['first-wins', 'vote', 'chief-decides', 'merge']);
export const zConsensusStrategy = z.enum(['unanimous', 'majority', 'supermajority', 'chief-decides', 'weighted']);

export const zRetryPolicy = z.object({
  max_retries: z.number().int().nonnegative(),
  backoff: z.enum(['fixed', 'linear', 'exponential']),
  initial_delay_ms: z.number().nonnegative(),
  max_delay_ms: z.number().nonnegative(),
  jitter: z.boolean(),
  retry_on: z.array(z.string()),
});

export const zSharedContext = z.object({
  key: z.string(),
  value: z.unknown(),
  source_agent: zAgentID,
  confidence: z.number().min(0).max(1),
  scope: z.enum(['task', 'workspace', 'project']),
  expires_at: z.string().datetime().optional(),
  tags: z.array(z.string()),
  updated_at: z.string().datetime(),
  version: z.number().nonnegative(),
});

export const zBlackboardTask = z.object({
  id: zTaskID,
  title: z.string(),
  description: z.string(),
  type: z.enum(['goal', 'objective', 'step', 'action', 'verification', 'maintenance']),
  priority: zTaskPriorityValue,
  state: z.enum(['draft', 'announced', 'claimed', 'in_progress', 'blocked', 'review', 'completed', 'failed', 'cancelled']),
  owner: zAgentID.optional(),
  owner_since: z.string().datetime().optional(),
  previous_owners: z.array(z.object({
    agent_id: zAgentID,
    claimed_at: z.string().datetime(),
    released_at: z.string().datetime(),
    reason: z.string(),
    partial_result: z.unknown().optional(),
  })),
  depends_on: z.array(zTaskID),
  blocks: z.array(zTaskID),
  resources_required: zResourceBudget,
  retry_count: z.number().nonnegative(),
  max_retries: z.number().nonnegative(),
  deadline: z.string().datetime().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  tags: z.array(z.string()),
});