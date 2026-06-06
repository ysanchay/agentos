import { z } from 'zod';
import { zTaskID, zAgentID, zWorkspaceID, zProjectID } from './primitives.js';
import { zTaskPriorityValue, zTags, zMetadata } from './common.js';
import { zResourceBudget, zResourceConsumption } from './resource-types.js';

export const zTaskType = z.enum(['goal', 'objective', 'step', 'action', 'verification', 'maintenance']);
export const zTaskState = z.enum([
  'draft', 'announced', 'claimed', 'in_progress', 'blocked',
  'review', 'completed', 'failed', 'cancelled',
]);

export const zTask = z.object({
  id: zTaskID,
  title: z.string().min(1),
  description: z.string(),
  type: zTaskType,
  priority: zTaskPriorityValue,
  state: zTaskState,
  workspace_id: zWorkspaceID,
  project_id: zProjectID,
  assignee_id: zAgentID.optional(),
  claimed_by: zAgentID.optional(),
  claimed_at: z.string().datetime().optional(),
  parent_task_id: zTaskID.optional(),
  child_task_ids: z.array(zTaskID),
  depends_on: z.array(zTaskID),
  blocks: z.array(zTaskID),
  resources_required: zResourceBudget,
  resources_allocated: zResourceBudget.optional(),
  result: z.unknown().optional(),
  error: z.string().optional(),
  deadline: z.string().datetime().optional(),
  retry_count: z.number().int().nonnegative(),
  max_retries: z.number().int().nonnegative(),
  previous_assignees: z.array(zAgentID),
  tags: zTags,
  metadata: zMetadata,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  failed_at: z.string().datetime().optional(),
});

export const zTaskError = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
  details: z.unknown().optional(),
});

export const zArtifactRef = z.object({
  type: z.enum(['memory', 'file', 'database', 'api']),
  uri: z.string(),
  checksum: z.string(),
});

export const zTaskResult = z.object({
  task_id: zTaskID,
  agent_id: zAgentID,
  output: z.unknown(),
  confidence: z.number().min(0).max(1),
  resources_consumed: zResourceConsumption,
  artifacts: z.array(zArtifactRef),
  duration_ms: z.number().nonnegative(),
  completed_at: z.string().datetime(),
});