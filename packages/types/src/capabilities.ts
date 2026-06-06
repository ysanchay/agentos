/**
 * AgentOS Capability Types
 * RootCapability, CapabilityPath, Capability, CapabilityProvider, etc.
 * From capability-graph-v1.md Articles I-VII (unified with kernel-api Section 3.5)
 */

import type { ISO8601 } from './temporal.js';
import type { AgentID, CapabilityID, InvocationID, ProviderID, ServiceID, WorkspaceID, ProjectID, TaskID } from './primitives.js';
import type { Tags } from './common.js';
import type { ResourceBudget, ResourceConsumption } from './resource-types.js';

// ─── Root Capabilities ──────────────────────────────────────────────

/** The 12 root capabilities — every capability is a descendant of one */
export type RootCapability =
  | 'compute'
  | 'reason'
  | 'remember'
  | 'communicate'
  | 'perceive'
  | 'actuate'
  | 'navigate'
  | 'create'
  | 'validate'
  | 'coordinate'
  | 'secure'
  | 'learn';

export const ROOT_CAPABILITIES: RootCapability[] = [
  'compute', 'reason', 'remember', 'communicate', 'perceive',
  'actuate', 'navigate', 'create', 'validate', 'coordinate', 'secure', 'learn',
];

/** Branded capability path type (e.g., "create.code.typescript") */
export type CapabilityPath = string & { readonly __brand: 'CapabilityPath' };

/** Cast string to CapabilityPath (validate before using) */
export function asCapabilityPath(path: string): CapabilityPath {
  return path as CapabilityPath;
}

/** Validate capability path syntax */
const CAPABILITY_PATH_REGEX = /^[a-z]+(\.[a-z][a-z0-9-]*){0,5}$/;

export function isValidCapabilityPath(path: string): path is CapabilityPath {
  return CAPABILITY_PATH_REGEX.test(path) && path.length <= 128;
}

/** Extract the root from a capability path */
export function getCapabilityRoot(path: CapabilityPath): RootCapability {
  return path.split('.')[0] as RootCapability;
}

// ─── Capability Stability ───────────────────────────────────────────

export type CapabilityStability = 'stable' | 'beta' | 'alpha' | 'experimental';

export enum CapabilityState {
  REGISTERED = 'registered',
  ACTIVE = 'active',
  DEPRECATED = 'deprecated',
  DISABLED = 'disabled',
  REMOVED = 'removed',
}

// ─── Resource Profile & Rate Limit (undefined in constitution, defined here) ──

export interface ResourceProfile {
  typical: ResourceBudget;
  peak: ResourceBudget;
  timeout_ms: number;
}

export interface RateLimit {
  max_calls: number;
  window_ms: number;
  strategy: 'fixed_window' | 'token_bucket' | 'sliding_window';
}

// ─── Cost Model ─────────────────────────────────────────────────────

export type CostModel =
  | { type: 'free' }
  | { type: 'per_call'; cost: ResourceBudget }
  | { type: 'per_unit'; cost: ResourceBudget; unit: string }
  | { type: 'tiered'; tiers: { limit: number; cost: ResourceBudget }[] }
  | { type: 'subscription'; period: 'hourly' | 'daily' | 'monthly'; cost: ResourceBudget };

// ─── Capability Interface (unified from kernel-api + capability-graph) ──

export interface Capability {
  id: CapabilityID;
  path: CapabilityPath;
  version: string;
  display_name: string;
  description: string;
  root: RootCapability;
  parent?: CapabilityPath;
  children: CapabilityPath[];
  state: CapabilityState;
  input_schema: object; // JSON Schema
  output_schema: object; // JSON Schema
  error_schema?: object; // JSON Schema
  permissions_required: CapabilityID[];
  stability: CapabilityStability;
  resource_profile: ResourceProfile;
  timeout_ms: number;
  rate_limit?: RateLimit;
  provider_count: number;
  deprecated: boolean;
  deprecation_message?: string;
  replacement_id?: CapabilityID;
  tags: Tags;
  created_at: ISO8601;
  updated_at: ISO8601;
}

// ─── Capability Provider ────────────────────────────────────────────

export type ProviderStatus = 'available' | 'busy' | 'degraded' | 'offline';

export interface CapabilityProvider {
  id: ProviderID;
  capability_path: CapabilityPath;
  agent_id?: AgentID;
  service_id?: ServiceID;
  reliability_score: number; // 0.0 - 1.0
  avg_latency_ms: number;
  success_rate: number; // 0.0 - 1.0
  cost_model: CostModel;
  max_concurrent: number;
  current_load: number;
  supported_versions: string[];
  status: ProviderStatus;
  last_health_check: ISO8601;
  registered_at: ISO8601;
}

// ─── Invocation ──────────────────────────────────────────────────────

export type InvocationStatus = 'pending' | 'accepted' | 'completed' | 'failed' | 'timeout' | 'cancelled';

export interface CapabilityInvocation {
  id: InvocationID;
  capability_path: CapabilityPath;
  provider_id: ProviderID;
  caller: {
    agent_id: AgentID;
    task_id?: TaskID;
    workspace_id: WorkspaceID;
  };
  input: unknown;
  options: {
    timeout_ms: number;
    priority: number;
    retry_on_failure: boolean;
    fallback_provider?: ProviderID;
  };
  status: InvocationStatus;
  result?: InvocationResult;
  error?: InvocationError;
  created_at: ISO8601;
  completed_at?: ISO8601;
}

export interface InvocationResult {
  output: unknown;
  duration_ms: number;
  resources_consumed: ResourceConsumption;
}

export interface InvocationError {
  error_code: string;
  error_message: string;
  retryable: boolean;
  retry_after_ms?: number;
}

// ─── Capability Permission ──────────────────────────────────────────

export interface CapabilityPermission {
  agent_id: AgentID;
  capability_path: CapabilityPath;
  scope: 'invoke' | 'provide' | 'admin';
  constraints?: {
    max_invocations_per_hour?: number;
    max_cost_per_day?: ResourceBudget;
    require_approval?: boolean;
    input_restrictions?: object; // JSON Schema
  };
  granted_by: AgentID;
  granted_at: ISO8601;
  expires_at?: ISO8601;
}

// ─── Capability Deprecation ─────────────────────────────────────────

export interface CapabilityDeprecation {
  capability_path: CapabilityPath;
  deprecated_since: string;
  replacement?: CapabilityPath;
  sunset_date: ISO8601;
  migration_guide?: string;
}

// ─── Capability Health ──────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'offline';

export interface CapabilityHealth {
  capability_path: CapabilityPath;
  providers: {
    provider_id: ProviderID;
    status: HealthStatus;
    last_check: ISO8601;
    latency_ms: number;
    success_rate: number;
    error_rate: number;
  }[];
  overall_status: 'available' | 'degraded' | 'unavailable';
  last_updated: ISO8601;
}

// ─── Resolution ─────────────────────────────────────────────────────

export type MatchType = 'exact' | 'parent_fallback' | 'semantic' | 'composite';
export type OptimizationTarget = 'latency' | 'cost' | 'reliability' | 'quality' | 'balanced';

export interface ResolutionRequest {
  capability_path: CapabilityPath;
  version?: string;
  context: {
    workspace_id?: WorkspaceID;
    project_id?: ProjectID;
    agent_id?: AgentID;
    task_id?: TaskID;
  };
  constraints: {
    max_latency_ms?: number;
    max_cost?: ResourceBudget;
    min_reliability?: number;
    require_local?: boolean;
    require_agent?: boolean;
    exclude_providers?: ProviderID[];
  };
  preferences: {
    optimize_for: OptimizationTarget;
  };
}

export interface ResolutionResult {
  request: ResolutionRequest;
  provider: CapabilityProvider;
  capability: Capability;
  match_type: MatchType;
  confidence: number;
  estimated_latency_ms: number;
  estimated_cost: ResourceBudget;
  alternatives: { provider: CapabilityProvider; score: number }[];
  resolved_at: ISO8601;
}