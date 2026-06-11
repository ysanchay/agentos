/**
 * @agentos/capabilities — MCP Provider
 * Implements ICapabilityProvider by delegating execute() calls
 * to an MCP server via MCPRuntime.
 *
 * Tool calls → runtime.callTool()
 * Resource reads → runtime.readResource()
 * Prompt gets → runtime.getPrompt()
 */

import type {
  Capability,
  CapabilityProvider,
  CapabilityID,
  ProviderID,
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
import type { MCPRuntime } from './mcp-runtime.js';

// ─── MCP Capability Definition ────────────────────────────────────────────────

export interface MCPCapabilityDef {
  path: string;
  displayName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  root: RootCapability;
}

// ─── MCP Provider Config ──────────────────────────────────────────────────────

export interface MCPProviderConfig {
  runtime: MCPRuntime;
  serverName: string;
  type: 'tool' | 'resource' | 'prompt';
  capabilities: MCPCapabilityDef[];
  sandboxConfig: ProviderSandboxConfig;
}

// ─── MCP Provider ────────────────────────────────────────────────────────────

export class MCPProvider implements ICapabilityProvider {
  readonly providerRecord: CapabilityProvider;
  readonly capabilities: Capability[];
  readonly sandboxConfig: ProviderSandboxConfig;

  private runtime: MCPRuntime;
  private type: 'tool' | 'resource' | 'prompt';
  private serverName: string;
  private pathIndex = new Map<string, MCPCapabilityDef>();

  constructor(config: MCPProviderConfig) {
    this.runtime = config.runtime;
    this.type = config.type;
    this.serverName = config.serverName;
    this.sandboxConfig = config.sandboxConfig;

    // Build capabilities from defs
    this.capabilities = config.capabilities.map(def => this.buildCapability(def));

    // Index paths for quick lookup
    for (const def of config.capabilities) {
      this.pathIndex.set(def.path, def);
    }

    // Build provider record
    const firstPath = config.capabilities[0]?.path ?? `mcp.${config.serverName}`;
    this.providerRecord = {
      id: createUUID() as unknown as ProviderID,
      capability_path: firstPath as any,
      reliability_score: 0.85,
      avg_latency_ms: 500,
      success_rate: 0.90,
      cost_model: { type: 'free' } as CostModel,
      max_concurrent: 10,
      current_load: 0,
      supported_versions: ['1.0.0'],
      status: 'available',
      last_health_check: new Date().toISOString(),
      registered_at: new Date().toISOString(),
    };
  }

  /**
   * Execute a capability invocation by delegating to the MCP runtime.
   */
  async execute(context: ProviderExecuteContext): Promise<ProviderExecuteResult> {
    const path = context.invocation.capability_path as string;
    const start = Date.now();

    // Find the capability definition
    const def = this.pathIndex.get(path);
    if (!def) {
      throw new Error(`MCP provider has no handler for path: ${path}`);
    }

    try {
      let output: unknown;

      switch (this.type) {
        case 'tool': {
          // Extract tool name from path: compute.mcp.{server}.{tool}
          const toolName = this.extractName(path);
          const result = await this.runtime.callTool(toolName, context.invocation.input as Record<string, unknown> ?? {});
          output = {
            content: result.content,
            isError: result.isError,
            toolName,
          };
          break;
        }

        case 'resource': {
          // Extract resource URI from input or derive from path
          const input = context.invocation.input as Record<string, unknown> ?? {};
          const uri = input['uri'] as string;
          if (!uri) {
            throw new Error('Resource invocation requires a "uri" input');
          }
          const result = await this.runtime.readResource(uri);
          output = {
            contents: result.contents,
            uri,
          };
          break;
        }

        case 'prompt': {
          const promptName = this.extractName(path);
          const input = context.invocation.input as Record<string, string> ?? {};
          const result = await this.runtime.getPrompt(promptName, input);
          output = {
            messages: result.messages,
            description: result.description,
            promptName,
          };
          break;
        }
      }

      const durationMs = Date.now() - start;

      return {
        output,
        durationMs,
        resourcesConsumed: { ru: 5, mu: 3, eu: 2, vu: 0 },
      };
    } catch (e) {
      throw new Error(`MCP ${this.type} call failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Health check — verify runtime is still connected.
   */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number; details?: unknown }> {
    const start = Date.now();
    const state = this.runtime.getState();
    const healthy = state === 'connected';
    const latencyMs = Date.now() - start;

    return {
      healthy,
      latencyMs,
      details: {
        state,
        server: this.serverName,
        type: this.type,
      },
    };
  }

  /**
   * Initialize — no-op (runtime should already be started).
   */
  async initialize(): Promise<void> {
    // No-op: MCPRuntime.start() is called before adapter creation
  }

  /**
   * Shutdown — stop the runtime.
   */
  async shutdown(): Promise<void> {
    await this.runtime.stop();
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private buildCapability(def: MCPCapabilityDef): Capability {
    return {
      id: createUUID() as unknown as CapabilityID,
      path: def.path as any,
      version: '1.0.0',
      display_name: def.displayName,
      description: def.description,
      root: def.root,
      children: [],
      state: 'active' as CapabilityState,
      input_schema: def.inputSchema,
      output_schema: { type: 'object' },
      permissions_required: [],
      stability: 'beta' as CapabilityStability,
      resource_profile: {
        typical: { ru: 5, mu: 3, eu: 2, vu: 0 },
        peak: { ru: 25, mu: 15, eu: 10, vu: 0 },
        timeout_ms: 60_000,
      },
      timeout_ms: 60_000,
      provider_count: 1,
      deprecated: false,
      tags: ['mcp', this.type, this.serverName],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Extract the capability name from a path like compute.mcp.server.tool-name
   * Returns the last segment.
   */
  private extractName(path: string): string {
    const parts = path.split('.');
    return parts[parts.length - 1] ?? '';
  }
}