/**
 * @agentos/capabilities — Package-local types
 * Defines the provider interface, execution context, sandbox config,
 * security policy, and invocation events.
 *
 * NOTE: All types from @agentos/types (Capability, CapabilityProvider,
 * CapabilityInvocation, InvocationResult, etc.) are REUSED, not redefined.
 */

import type {
  CapabilityPath,
  CapabilityID,
  ProviderID,
  InvocationID,
  Capability,
  CapabilityProvider,
  CapabilityInvocation,
  InvocationResult,
  InvocationError,
  ResourceConsumption,
  ResourceBudget,
  AgentID,
  TaskID,
  WorkspaceID,
} from '@agentos/types';

// ─── Provider Interface ────────────────────────────────────────────────────

/**
 * The narrow execution context a provider receives.
 * Deliberately restricted: no agent context, no blackboard, no other providers.
 * The SecurityHypervisor populates this AFTER all checks pass.
 */
export interface ProviderExecuteContext {
  /** The invocation record (read-only) */
  invocation: CapabilityInvocation;
  /** The resolved capability definition (for schema reference) */
  capability: Capability;
  /** Sandbox root path — all file ops must stay within */
  sandboxRoot?: string;
  /** Allowed network hosts (if network policy applied) */
  allowedHosts?: string[];
  /** Environment variables visible to this provider */
  env: Record<string, string>;
  /** Maximum wall-clock time this invocation may take */
  deadlineMs: number;
  /** Structured logging sink — providers MUST NOT emit to stdout/stderr directly */
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: unknown) => void;
  /** Abort signal — set when timeout or cancellation occurs */
  signal: AbortSignal;
}

/**
 * What a provider returns from execute().
 * Extends InvocationResult with provider-specific metadata for auditing.
 */
export interface ProviderExecuteResult {
  /** The output data (must conform to capability.output_schema) */
  output: unknown;
  /** Actual wall-clock duration */
  durationMs: number;
  /** Resources actually consumed (measured, not estimated) */
  resourcesConsumed: ResourceConsumption;
  /** Provider-specific metadata (not passed to callers, used for auditing) */
  providerMetadata?: Record<string, unknown>;
}

/**
 * The contract every capability provider must implement.
 * Providers are stateless executors — they do NOT hold references
 * to the agent, blackboard, or other subsystems.
 */
export interface ICapabilityProvider {
  /** The CapabilityProvider record from @agentos/types */
  readonly providerRecord: CapabilityProvider;
  /** The Capability records this provider serves */
  readonly capabilities: Capability[];
  /** Sandbox requirements for this provider */
  readonly sandboxConfig: ProviderSandboxConfig;

  /**
   * Execute a capability invocation.
   * This is the ONLY method that produces side effects.
   * Called by CapabilityExecutor AFTER SecurityHypervisor approval.
   */
  execute(context: ProviderExecuteContext): Promise<ProviderExecuteResult>;

  /**
   * Health check — called periodically by CapabilityRegistry.
   * Must return within 10 seconds.
   */
  healthCheck(): Promise<{ healthy: boolean; latencyMs: number; details?: unknown }>;

  /**
   * Initialize the provider (called once at registration).
   */
  initialize(): Promise<void>;

  /**
   * Shut down the provider (called on deregistration).
   */
  shutdown(): Promise<void>;
}

// ─── Sandbox Configuration ─────────────────────────────────────────────────

export interface ProviderSandboxConfig {
  filesystem: {
    enabled: boolean;
    /** Allowed paths (relative to workspace root or sandbox root) */
    allowedPaths: string[];
    /** Whether write access is allowed */
    writable: boolean;
    /** Maximum file size in bytes */
    maxFileSize: number;
  };
  network: {
    enabled: boolean;
    /** Allowed host patterns (glob) */
    allowedHosts: string[];
    /** Whether outbound connections are allowed */
    allowOutbound: boolean;
    /** Maximum response body size in bytes */
    maxResponseSize: number;
  };
  process: {
    enabled: boolean;
    /** Allowed executables (if process enabled) */
    allowedCommands: string[];
    /** Maximum subprocess count */
    maxProcesses: number;
    /** Maximum process memory in bytes */
    maxMemoryBytes: number;
  };
  /** Maximum invocation time (overrides capability timeout if lower) */
  maxTimeoutMs: number;
}

// ─── Security Policy ────────────────────────────────────────────────────────

export interface CapabilityRule {
  path: CapabilityPath;
  allowed: boolean;
  maxInvocationsPerHour?: number;
  maxCostPerDay?: number;
  requireApproval?: boolean;
  inputRestrictions?: object;
}

export interface SecurityPolicy {
  /** Default allow/deny for unlisted capabilities */
  defaultAction: 'allow' | 'deny';
  /** Capability-specific rules */
  capabilityRules: Map<CapabilityPath, CapabilityRule>;
  /** Global rate limits (per agent) */
  globalRateLimit: { maxInvocationsPerHour: number; maxConcurrent: number };
  /** Budget limits (per agent, per workspace) */
  budgetLimits: { maxRuPerHour: number; maxMuPerHour: number };
  /** Capabilities that always require approval */
  approvalRequired: CapabilityPath[] | '*';
  /** Restricted capabilities (always require approval regardless) */
  restricted: CapabilityPath[];
  /** Input size limits */
  maxInputSizeBytes: number;
  /** Output size limits */
  maxOutputSizeBytes: number;
}

// ─── Invocation Events ──────────────────────────────────────────────────────

export interface InvocationEvent {
  invocationId: InvocationID;
  capabilityPath: CapabilityPath;
  providerId: ProviderID;
  callerAgentId: AgentID;
  taskId?: TaskID;
  workspaceId: WorkspaceID;
  phase: 'created' | 'resolved' | 'approved' | 'executing' | 'completed' | 'failed' | 'timeout';
  timestamp: number;
  durationMs?: number;
  resourcesConsumed?: ResourceConsumption;
  error?: InvocationError;
}

// ─── Executor Config ────────────────────────────────────────────────────────

export interface CapabilityExecutorConfig {
  /** Maximum retries per invocation (default: 2) */
  maxRetries: number;
  /** Retry backoff base in ms (default: 1000) */
  retryBackoffMs: number;
  /** Whether to generate memory artifacts (default: true) */
  generateMemoryArtifacts: boolean;
  /** Whether to emit events to EventBus (default: true) */
  emitEvents: boolean;
  /** Default invocation timeout (default: 30000) */
  defaultTimeoutMs: number;
}

export const DEFAULT_EXECUTOR_CONFIG: CapabilityExecutorConfig = {
  maxRetries: 2,
  retryBackoffMs: 1000,
  generateMemoryArtifacts: true,
  emitEvents: true,
  defaultTimeoutMs: 30_000,
};

// ─── Security Anomaly ───────────────────────────────────────────────────────

export interface SecurityAnomaly {
  type: 'output_size' | 'duration' | 'consumption' | 'output_schema' | 'policy_violation';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  details?: unknown;
}