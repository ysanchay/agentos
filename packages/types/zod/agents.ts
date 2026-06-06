import { z } from 'zod';
import { zAgentID, zTaskID, zWorkspaceID, zProjectID, zCapabilityID, zPermissionID, zUserID } from './primitives.js';
import { zResourceBudget, zResourceConsumption } from './resource-types.js';
import { zTags, zMetadata } from './common.js';

export const zAgentType = z.enum(['chief', 'manager', 'worker', 'validator', 'specialist', 'daemon', 'proxy']);
export const zAgentState = z.enum([
  'spawning', 'initializing', 'ready', 'running', 'paused',
  'suspended', 'errored', 'recovering', 'terminating', 'terminated',
]);

export const zAgent = z.object({
  id: zAgentID,
  name: z.string().min(1).max(256),
  type: zAgentType,
  state: zAgentState,
  workspace_id: zWorkspaceID,
  project_id: zProjectID,
  capabilities: z.array(zCapabilityID),
  permissions: z.array(zPermissionID),
  resources_allocated: zResourceBudget,
  resources_consumed: zResourceConsumption,
  resource_limits: zResourceBudget,
  parent_agent_id: zAgentID.optional(),
  child_agent_ids: z.array(zAgentID),
  active_task_ids: z.array(zTaskID),
  completed_task_count: z.number().int().nonnegative(),
  failed_task_count: z.number().int().nonnegative(),
  owner_user_id: zUserID,
  public_key: z.string().min(1),
  metadata: zMetadata,
  tags: zTags,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  terminated_at: z.string().datetime().optional(),
});