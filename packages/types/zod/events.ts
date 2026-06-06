import { z } from 'zod';
import { zEventID, zWorkspaceID } from './primitives.js';

export const zEventDomain = z.enum([
  'agent', 'task', 'workspace', 'project', 'capability',
  'permission', 'memory', 'resource', 'approval', 'system', 'security',
]);

export const zEvent = z.object({
  id: zEventID,
  domain: zEventDomain,
  type: z.string(),
  source: z.string(),
  target: z.string().optional(),
  data: z.unknown(),
  timestamp: z.string().datetime(),
  correlation_id: z.string().optional(),
  causation_id: z.string().optional(),
  workspace_id: zWorkspaceID.optional(),
});