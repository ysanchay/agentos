import { z } from 'zod';
import { zWorkspaceID, zProjectID, zAgentID, zTaskID, zUserID } from './primitives.js';
import { zTaskPriorityValue, zTags, zMetadata } from './common.js';
import { zResourceBudget, zResourceConsumption } from './resource-types.js';

export const zWorkspaceState = z.enum([
  'creating', 'active', 'paused', 'locked', 'archiving', 'archived', 'deleting', 'deleted',
]);

export const zWorkspace = z.object({
  id: zWorkspaceID,
  name: z.string().min(1),
  description: z.string(),
  state: zWorkspaceState,
  project_id: zProjectID,
  owner_id: zUserID,
  agent_ids: z.array(zAgentID),
  task_ids: z.array(zTaskID),
  resource_quota: zResourceBudget,
  resource_consumed: zResourceConsumption,
  max_agents: z.number().int().positive(),
  memory_scope: z.enum(['workspace', 'project', 'shared']),
  default_priority: zTaskPriorityValue,
  auto_pause_on_budget_exhaustion: z.boolean(),
  metadata: zMetadata,
  tags: zTags,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  archived_at: z.string().datetime().optional(),
  deleted_at: z.string().datetime().optional(),
});