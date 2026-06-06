import { z } from 'zod';
import { zCapabilityID, zProviderID, zServiceID, zAgentID, zInvocationID, zWorkspaceID, zProjectID, zTaskID } from './primitives.js';
import { zTags } from './common.js';
import { zResourceBudget, zResourceConsumption } from './resource-types.js';

export const zRootCapability = z.enum([
  'compute', 'reason', 'remember', 'communicate', 'perceive',
  'actuate', 'navigate', 'create', 'validate', 'coordinate', 'secure', 'learn',
]);

export const zCapabilityPath = z.string().regex(/^[a-z]+(\.[a-z][a-z0-9-]*){0,5}$/).max(128);
export const zCapabilityStability = z.enum(['stable', 'beta', 'alpha', 'experimental']);
export const zCapabilityState = z.enum(['registered', 'active', 'deprecated', 'disabled', 'removed']);

export const zResourceProfile = z.object({
  typical: zResourceBudget,
  peak: zResourceBudget,
  timeout_ms: z.number().positive(),
});

export const zRateLimit = z.object({
  max_calls: z.number().positive(),
  window_ms: z.number().positive(),
  strategy: z.enum(['fixed_window', 'token_bucket', 'sliding_window']),
});

export const zCostModel = z.discriminatedUnion('type', [
  z.object({ type: z.literal('free') }),
  z.object({ type: z.literal('per_call'), cost: zResourceBudget }),
  z.object({ type: z.literal('per_unit'), cost: zResourceBudget, unit: z.string() }),
  z.object({ type: z.literal('tiered'), tiers: z.array(z.object({ limit: z.number(), cost: zResourceBudget })) }),
  z.object({ type: z.literal('subscription'), period: z.enum(['hourly', 'daily', 'monthly']), cost: zResourceBudget }),
]);

export const zCapability = z.object({
  id: zCapabilityID,
  path: zCapabilityPath,
  version: z.string(),
  display_name: z.string(),
  description: z.string(),
  root: zRootCapability,
  parent: zCapabilityPath.optional(),
  children: z.array(zCapabilityPath),
  state: zCapabilityState,
  input_schema: z.record(z.string(), z.unknown()),
  output_schema: z.record(z.string(), z.unknown()),
  error_schema: z.record(z.string(), z.unknown()).optional(),
  permissions_required: z.array(zCapabilityID),
  stability: zCapabilityStability,
  resource_profile: zResourceProfile,
  timeout_ms: z.number().positive(),
  rate_limit: zRateLimit.optional(),
  provider_count: z.number().nonnegative(),
  deprecated: z.boolean(),
  deprecation_message: z.string().optional(),
  replacement_id: zCapabilityID.optional(),
  tags: zTags,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export const zCapabilityProvider = z.object({
  id: zProviderID,
  capability_path: zCapabilityPath,
  agent_id: zAgentID.optional(),
  service_id: zServiceID.optional(),
  reliability_score: z.number().min(0).max(1),
  avg_latency_ms: z.number().nonnegative(),
  success_rate: z.number().min(0).max(1),
  cost_model: zCostModel,
  max_concurrent: z.number().positive(),
  current_load: z.number().nonnegative(),
  supported_versions: z.array(z.string()),
  status: z.enum(['available', 'busy', 'degraded', 'offline']),
  last_health_check: z.string().datetime(),
  registered_at: z.string().datetime(),
});

export const zInvocationStatus = z.enum(['pending', 'accepted', 'completed', 'failed', 'timeout', 'cancelled']);

export const zCapabilityInvocation = z.object({
  id: zInvocationID,
  capability_path: zCapabilityPath,
  provider_id: zProviderID,
  caller: z.object({
    agent_id: zAgentID,
    task_id: zTaskID.optional(),
    workspace_id: zWorkspaceID,
  }),
  input: z.unknown(),
  options: z.object({
    timeout_ms: z.number().positive(),
    priority: z.number(),
    retry_on_failure: z.boolean(),
    fallback_provider: zProviderID.optional(),
  }),
  status: zInvocationStatus,
  result: z.object({
    output: z.unknown(),
    duration_ms: z.number().nonnegative(),
    resources_consumed: zResourceConsumption,
  }).optional(),
  error: z.object({
    error_code: z.string(),
    error_message: z.string(),
    retryable: z.boolean(),
    retry_after_ms: z.number().optional(),
  }).optional(),
  created_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
});