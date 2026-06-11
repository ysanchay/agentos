/**
 * @agentos/capabilities — Provider Base
 * Abstract base class for all ICapabilityProvider implementations.
 * Handles common health check, initialization, shutdown, and
 * capability routing (path → handler dispatch).
 */

import type {
  Capability,
  CapabilityProvider,
  CapabilityPath,
  ProviderID,
  CapabilityID,
  CapabilityState,
  CapabilityStability,
  RootCapability,
  CostModel,
  ResourceProfile,
  ResourceConsumption,
} from '@agentos/types';
import { createUUID } from '@agentos/types';
import type {
  ICapabilityProvider,
  ProviderExecuteContext,
  ProviderExecuteResult,
  ProviderSandboxConfig,
} from '../types.js';

/** Handler for a single capability path within a provider. */
export type CapabilityHandler = (
  input: unknown,
  context: ProviderExecuteContext,
) => Promise<ProviderExecuteResult>;

/** Definition for a capability that a provider supports. */
export interface ProviderCapabilityDef {
  path: string;
  displayName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  handler: CapabilityHandler;
  stability?: CapabilityStability;
  resourceProfile?: Partial<ResourceProfile>;
  permissionsRequired?: string[];
}

/** Configuration for a provider. */
export interface ProviderBaseConfig {
  providerId?: ProviderID;
  root: RootCapability;
  reliabilityScore?: number;
  avgLatencyMs?: number;
  successRate?: number;
  costModel?: CostModel;
  maxConcurrent?: number;
  sandboxConfig?: Partial<ProviderSandboxConfig>;
}

const DEFAULT_RESOURCE_PROFILE: ResourceProfile = {
  typical: { ru: 10, mu: 5, eu: 1, vu: 0 },
  peak: { ru: 50, mu: 25, eu: 5, vu: 0 },
  timeout_ms: 30_000,
};

/**
 * Abstract base class for capability providers.
 * Subclasses register capability handlers and the base class
 * handles dispatch, health checking, and lifecycle.
 */
export abstract class ProviderBase implements ICapabilityProvider {
  readonly providerRecord: CapabilityProvider;
  readonly capabilities: Capability[];
  readonly sandboxConfig: ProviderSandboxConfig;

  private handlers = new Map<string, CapabilityHandler>();
  private healthy = true;
  private avgLatencyMs: number;
  private lastHealthCheckMs = 0;

  constructor(
    protected readonly config: ProviderBaseConfig,
    protected readonly capabilityDefs: ProviderCapabilityDef[],
  ) {
    const providerId = config.providerId ?? createUUID() as unknown as ProviderID;
    this.avgLatencyMs = config.avgLatencyMs ?? 100;

    // Build capabilities from defs
    this.capabilities = capabilityDefs.map(def => this.buildCapability(def));

    // Register handlers
    for (const def of capabilityDefs) {
      this.handlers.set(def.path, def.handler);
    }

    // Build provider record
    this.providerRecord = {
      id: providerId,
      capability_path: this.capabilities[0]!.path, // Primary path = first capability
      reliability_score: config.reliabilityScore ?? 0.9,
      avg_latency_ms: this.avgLatencyMs,
      success_rate: config.successRate ?? 0.95,
      cost_model: config.costModel ?? { type: 'free' },
      max_concurrent: config.maxConcurrent ?? 10,
      current_load: 0,
      supported_versions: ['1.0.0'],
      status: 'available',
      last_health_check: new Date().toISOString(),
      registered_at: new Date().toISOString(),
    };

    // Build sandbox config
    this.sandboxConfig = this.buildSandboxConfig(config.sandboxConfig);
  }

  /**
   * Main entry point — dispatches to the correct handler based on capability path.
   */
  async execute(context: ProviderExecuteContext): Promise<ProviderExecuteResult> {
    const path = context.invocation.capability_path as string;
    const handler = this.handlers.get(path);

    if (!handler) {
      // Try parent fallback — walk up the path
      const parts = path.split('.');
      for (let depth = parts.length - 1; depth >= 1; depth--) {
        const parentPath = parts.slice(0, depth).join('.');
        const parentHandler = this.handlers.get(parentPath);
        if (parentHandler) {
          return parentHandler(context.invocation.input, context);
        }
      }

      throw new Error(`No handler for capability path: ${path}`);
    }

    return handler(context.invocation.input, context);
  }

  /**
   * Health check — subclasses can override for custom checks.
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; details?: unknown }> {
    const start = Date.now();
    try {
      const result = await this.performHealthCheck();
      this.healthy = result.healthy;
      this.lastHealthCheckMs = Date.now() - start;
      return { ...result, latencyMs: this.lastHealthCheckMs };
    } catch {
      this.healthy = false;
      this.lastHealthCheckMs = Date.now() - start;
      return { healthy: false, latencyMs: this.lastHealthCheckMs };
    }
  }

  /**
   * Initialize — subclasses can override.
   */
  async initialize(): Promise<void> {
    // Default: no-op
  }

  /**
   * Shutdown — subclasses can override.
   */
  async shutdown(): Promise<void> {
    // Default: no-op
  }

  // ─── Protected Methods ────────────────────────────────────────────────

  /**
   * Override for provider-specific health check logic.
   */
  protected async performHealthCheck(): Promise<{ healthy: boolean; details?: unknown }> {
    return { healthy: true };
  }

  /**
   * Build a Capability record from a definition.
   */
  protected buildCapability(def: ProviderCapabilityDef): Capability {
    return {
      id: createUUID() as unknown as CapabilityID,
      path: def.path as CapabilityPath,
      version: '1.0.0',
      display_name: def.displayName,
      description: def.description,
      root: def.path.split('.')[0] as RootCapability,
      children: [],
      state: 'active' as CapabilityState,
      input_schema: def.inputSchema,
      output_schema: def.outputSchema,
      permissions_required: (def.permissionsRequired ?? []) as CapabilityID[],
      stability: def.stability ?? 'stable',
      resource_profile: { ...DEFAULT_RESOURCE_PROFILE, ...def.resourceProfile },
      timeout_ms: def.resourceProfile?.timeout_ms ?? 30_000,
      provider_count: 1,
      deprecated: false,
      tags: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Build sandbox config from partial overrides.
   */
  protected buildSandboxConfig(partial?: Partial<ProviderSandboxConfig>): ProviderSandboxConfig {
    return {
      filesystem: partial?.filesystem ?? {
        enabled: false,
        allowedPaths: [],
        writable: false,
        maxFileSize: 0,
      },
      network: partial?.network ?? {
        enabled: false,
        allowedHosts: [],
        allowOutbound: false,
        maxResponseSize: 0,
      },
      process: partial?.process ?? {
        enabled: false,
        allowedCommands: [],
        maxProcesses: 0,
        maxMemoryBytes: 0,
      },
      maxTimeoutMs: partial?.maxTimeoutMs ?? 30_000,
    };
  }

  /**
   * Helper: create a standard success result.
   */
  protected success(
    output: unknown,
    durationMs: number,
    resourcesConsumed?: Partial<ResourceConsumption>,
  ): ProviderExecuteResult {
    return {
      output,
      durationMs,
      resourcesConsumed: {
        ru: resourcesConsumed?.ru ?? 1,
        mu: resourcesConsumed?.mu ?? 1,
        eu: resourcesConsumed?.eu ?? 1,
        vu: resourcesConsumed?.vu ?? 0,
      },
    };
  }

  /**
   * Helper: create a standard error result (throws, which the executor catches).
   */
  protected fail(message: string): never {
    throw new Error(message);
  }
}