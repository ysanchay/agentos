import { z } from 'zod';

export const zPriority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export const zACPPriority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export const zTaskPriorityValue = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export const zTags = z.array(z.string());
export const zMetadata = z.record(z.string(), z.string());

export const zProvenance = z.object({
  source_type: z.enum(['user', 'agent', 'external', 'system', 'memory']),
  source_id: z.string(),
  confidence: z.number().min(0).max(1),
  timestamp: z.string().datetime(),
});

export const zResult = z.object({
  ok: z.literal(true),
  data: z.unknown(),
});

export const zAgentError = z.object({
  ok: z.literal(false),
  error_code: z.string(),
  error_message: z.string(),
  retryable: z.boolean(),
  retry_after: z.number().optional(),
  details: z.unknown().optional(),
});

export const zOutcome = z.union([zResult, zAgentError]);