import { z } from 'zod';
import { zPermissionID } from './primitives.js';

export const zPermissionScope = z.enum(['global', 'organization', 'project', 'workspace', 'task']);

export const zPermission = z.object({
  id: zPermissionID,
  name: z.string(),
  scope: zPermissionScope,
  grantee_id: z.string(),
  grantee_type: z.enum(['agent', 'user', 'role']),
  resource_type: z.string(),
  resource_id: z.string().optional(),
  actions: z.array(z.string()),
  conditions: z.object({
    time_restriction: z.object({ start: z.string(), end: z.string() }).optional(),
    ip_restriction: z.array(z.string()).optional(),
    approval_required: z.boolean().optional(),
    max_uses: z.number().optional(),
  }).optional(),
  granted_by: z.string(),
  expires_at: z.string().datetime().optional(),
  created_at: z.string().datetime(),
  revocable: z.boolean(),
});