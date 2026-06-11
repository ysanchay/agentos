/**
 * @agentos/capabilities — Capability Executor Tests
 * Tests the full 13-step invocation lifecycle with mocked providers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CapabilityExecutor, type InvocationOptions } from '../src/capability-executor.js';
import { CapabilityRegistry } from '../src/capability-registry.js';
import { CapabilityResolver } from '../src/capability-resolver.js';
import { SecurityHypervisor } from '../src/security-hypervisor.js';
import { SandboxManager } from '../src/sandbox.js';
import { ConsumptionTracker } from '../src/consumption-tracker.js';
import type { ICapabilityProvider, ProviderSandboxConfig, SecurityPolicy } from '../src/types.js';
import type {
  Capability,
  CapabilityProvider,
  CapabilityPath,
  CapabilityID,
  ProviderID,
  AgentID,
  TaskID,
  WorkspaceID,
  CapabilityState,
  CapabilityStability,
  RootCapability,
  CostModel,
  ResourceProfile,
  ResourceConsumption,
  ResolutionRequest,
} from '@agentos/types';
import { createUUID } from '@agentos/types';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function cpath(p: string): CapabilityPath { return p as CapabilityPath; }
function aid(): AgentID { return createUUID() as unknown as AgentID; }
function wid(): WorkspaceID { return createUUID() as unknown as WorkspaceID; }
function tid(): TaskID { return createUUID() as unknown as TaskID; }

function makeCapability(path: string): Capability {
  return {
    id: createUUID() as CapabilityID,
    path: cpath(path),
    version: '1.0.0',
    display_name: `Capability ${path}`,
    description: '',
    root: path.split('.')[0] as RootCapability,
    children: [],
    state: 'active' as CapabilityState,
    input_schema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
    output_schema: { type: 'object', properties: { content: { type: 'string' } } },
    permissions_required: [],
    stability: 'stable' as CapabilityStability,
    resource_profile: { typical: { ru: 10, mu: 5, eu: 1, vu: 0 }, peak: { ru: 50, mu: 25, eu: 5, vu: 0 }, timeout_ms: 30000 } as ResourceProfile,
    timeout_ms: 30000,
    provider_count: 1,
    deprecated: false,
    tags: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeProvider(path: string, executeOverride?: (ctx: any) => Promise<any>): ICapabilityProvider {
  const capability = makeCapability(path);
  const sandboxConfig: ProviderSandboxConfig = {
    filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
    network: { enabled: false, allowedHosts: [], allowOutbound: false, maxResponseSize: 0 },
    process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
    maxTimeoutMs: 30000,
  };

  return {
    providerRecord: {
      id: createUUID() as ProviderID,
      capability_path: cpath(path),
      reliability_score: 0.95,
      avg_latency_ms: 100,
      success_rate: 0.99,
      cost_model: { type: 'free' } as CostModel,
      max_concurrent: 10,
      current_load: 0,
      supported_versions: ['1.0.0'],
      status: 'available',
      last_health_check: new Date().toISOString(),
      registered_at: new Date().toISOString(),
    },
    capabilities: [capability],
    sandboxConfig,
    execute: executeOverride ?? vi.fn().mockResolvedValue({
      output: { content: 'file contents here' },
      durationMs: 150,
      resourcesConsumed: { ru: 2, mu: 1, eu: 1, vu: 0 } as ResourceConsumption,
    }),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 50 }),
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

function makePermissivePolicy(): SecurityPolicy {
  return {
    defaultAction: 'allow',
    capabilityRules: new Map(),
    globalRateLimit: { maxInvocationsPerHour: 1000, maxConcurrent: 50 },
    budgetLimits: { maxRuPerHour: 100000, maxMuPerHour: 50000 },
    approvalRequired: [],
    restricted: [],
    maxInputSizeBytes: 10_000_000,
    maxOutputSizeBytes: 100_000_000,
  };
}

function makeExecutorDeps() {
  const registry = new CapabilityRegistry();
  const resolver = new CapabilityResolver(registry);
  const hypervisor = new SecurityHypervisor(makePermissivePolicy());
  const sandboxManager = new SandboxManager();
  const consumptionTracker = new ConsumptionTracker();

  return { registry, resolver, hypervisor, sandboxManager, consumptionTracker };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('CapabilityExecutor', () => {
  it('should execute a capability invocation end to end', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);
    const provider = makeProvider('actuate.filesystem.read');
    await deps.registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.output).toBeDefined();
      expect(result.data.duration_ms).toBeGreaterThan(0);
      expect(result.data.resources_consumed).toBeDefined();
    }
  });

  it('should record consumption in the tracker', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);
    const provider = makeProvider('actuate.filesystem.read');
    await deps.registry.registerProvider(provider);

    const agentId = aid();
    const wsId = wid();

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: agentId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    await executor.invoke(request, { path: '/tmp/test.txt' }, { agentId, workspaceId: wsId });

    const agentConsumption = deps.consumptionTracker.getByAgent(agentId);
    expect(agentConsumption.ru).toBeGreaterThan(0);
  });

  it('should emit invocation events', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);
    const provider = makeProvider('actuate.filesystem.read');
    await deps.registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    await executor.invoke(request, { path: '/tmp/test.txt' }, { agentId: aid(), workspaceId: wid() });

    const events = executor.getEvents();
    expect(events.length).toBeGreaterThan(0);

    // Should have created, resolved, approved, executing, completed events
    const phases = events.map(e => e.phase);
    expect(phases).toContain('created');
    expect(phases).toContain('completed');
  });

  it('should fail when capability not found', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);

    const request: ResolutionRequest = {
      capability_path: cpath('nonexistent.capability'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = await executor.invoke(request, {}, { agentId: aid(), workspaceId: wid() });
    expect(result.ok).toBe(false);
  });

  it('should fail when security denies the invocation', async () => {
    const deps = makeExecutorDeps();
    // Use restrictive policy
    const restrictivePolicy: SecurityPolicy = {
      defaultAction: 'deny',
      capabilityRules: new Map(),
      globalRateLimit: { maxInvocationsPerHour: 1000, maxConcurrent: 50 },
      budgetLimits: { maxRuPerHour: 100000, maxMuPerHour: 50000 },
      approvalRequired: [],
      restricted: [],
      maxInputSizeBytes: 10_000_000,
      maxOutputSizeBytes: 100_000_000,
    };
    deps.hypervisor = new SecurityHypervisor(restrictivePolicy);
    deps.resolver = new CapabilityResolver(deps.registry);

    const executor = new CapabilityExecutor(deps);
    const provider = makeProvider('actuate.filesystem.read');
    await deps.registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = await executor.invoke(request, {}, { agentId: aid(), workspaceId: wid() });
    expect(result.ok).toBe(false);
  });

  it('should handle provider execution errors', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);
    const provider = makeProvider('actuate.filesystem.read', vi.fn().mockRejectedValue(new Error('Provider crashed')));
    await deps.registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
      { retryOnFailure: false }, // Disable retries for this test
    );

    expect(result.ok).toBe(false);

    // Should have a failed event
    const events = executor.getEvents();
    expect(events.some(e => e.phase === 'failed')).toBe(true);
  });

  it('should pass sandbox config to provider when filesystem is enabled', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);
    const provider = makeProvider('actuate.filesystem.read');
    // Enable filesystem sandbox
    provider.sandboxConfig = {
      ...provider.sandboxConfig,
      filesystem: { enabled: true, allowedPaths: ['**'], writable: true, maxFileSize: 10_000_000 },
    };
    await deps.registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
    );

    expect(result.ok).toBe(true);
  });

  it('should pass task ID through the invocation', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);
    const provider = makeProvider('actuate.filesystem.read');
    await deps.registry.registerProvider(provider);

    const taskId = tid();
    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid(), task_id: taskId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), taskId, workspaceId: wid() },
    );

    expect(result.ok).toBe(true);

    // Check that task ID appears in events
    const events = executor.getEvents();
    expect(events.some(e => e.taskId === taskId)).toBe(true);
  });

  it('should respect custom timeout options', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);
    const provider = makeProvider('actuate.filesystem.read');
    await deps.registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
      { timeoutMs: 5000 },
    );

    expect(result.ok).toBe(true);
  });

  it('should track multiple invocations', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);
    const provider = makeProvider('actuate.filesystem.read');
    await deps.registry.registerProvider(provider);

    const agentId = aid();
    const wsId = wid();
    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: agentId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    await executor.invoke(request, { path: '/tmp/1.txt' }, { agentId, workspaceId: wsId });
    await executor.invoke(request, { path: '/tmp/2.txt' }, { agentId, workspaceId: wsId });
    await executor.invoke(request, { path: '/tmp/3.txt' }, { agentId, workspaceId: wsId });

    expect(deps.consumptionTracker.count).toBe(3);
    expect(deps.consumptionTracker.getByAgent(agentId).ru).toBeGreaterThan(0);
  });
});