import { z } from 'zod';
import { zMemoryID, zAgentID, zWorkspaceID } from './primitives.js';
import { zTags } from './common.js';

export const zMemoryTier = z.enum(['l0_hot', 'l1_working', 'l2_persistent', 'l3_archival']);
export const zMemoryType = z.enum(['fact', 'context', 'decision', 'observation', 'instruction', 'relationship', 'result', 'feedback']);

export const zMemoryRelation = z.object({
  target_id: zMemoryID,
  relation_type: z.enum(['causes', 'relates_to', 'contradicts', 'depends_on', 'extends', 'supersedes']),
  confidence: z.number().min(0).max(1),
});

export const zMemoryEntry = z.object({
  id: zMemoryID,
  type: zMemoryType,
  tier: zMemoryTier,
  content: z.unknown(),
  summary: z.string().optional(),
  workspace_id: zWorkspaceID,
  source_agent_id: zAgentID,
  source_type: z.enum(['user', 'agent', 'external', 'system']),
  confidence: z.number().min(0).max(1),
  tags: zTags,
  embeddings: z.array(z.number()).optional(),
  relations: z.array(zMemoryRelation),
  access_count: z.number().nonnegative(),
  last_accessed_at: z.string().datetime(),
  expires_at: z.string().datetime().optional(),
  version: z.number().nonnegative(),
  previous_version_id: zMemoryID.optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});