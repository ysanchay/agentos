import { z } from 'zod';
import { zProjectID, zUserID, zOrgID, zWorkspaceID, zTaskID } from './primitives.js';
import { zTags, zMetadata } from './common.js';
import { zResourceBudget, zResourceConsumption } from './resource-types.js';

export const zProjectState = z.enum(['planning', 'active', 'on_hold', 'completed', 'archived']);

export const zProject = z.object({
  id: zProjectID,
  name: z.string().min(1),
  description: z.string(),
  state: zProjectState,
  owner_id: zUserID,
  organization_id: zOrgID.optional(),
  workspace_ids: z.array(zWorkspaceID),
  goal_ids: z.array(zTaskID),
  deadline: z.string().datetime().optional(),
  total_budget: zResourceBudget,
  budget_consumed: zResourceConsumption,
  metadata: zMetadata,
  tags: zTags,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
});