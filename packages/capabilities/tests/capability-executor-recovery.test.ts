/**
 * @agentos/capabilities — Capability Executor Recovery Tests
 * Tests failure recovery scenarios: timeout, crash, retry, fallback,
 * security deny, consumption tracking, memory artifacts, concurrency, and events.
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
    budgetLimits: { maxRuPerHour: 100_000, maxMuPerHour: 50_000 },
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

describe('CapabilityExecutor — Timeout', () => {
  it('should fail when invocation exceeds timeoutMs', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);

    // Provider that blocks until the abort signal fires
    const slowExecute = vi.fn().mockImplementation((ctx: any) => {
      return new Promise((_: any, reject: any) => {
        ctx.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    });
    const slowProvider = makeProvider('actuate.filesystem.read', slowExecute);
    await deps.registry.registerProvider(slowProvider);

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
      { timeoutMs: 200, retryOnFailure: false },
    );

    expect(result.ok).toBe(false);
  }, 10000);

  it('should emit timeout event when invocation times out', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);

    const slowExecute = vi.fn().mockImplementation((ctx: any) => {
      return new Promise((_: any, reject: any) => {
        ctx.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        });
      });
    });
    const slowProvider = makeProvider('actuate.filesystem.read', slowExecute);
    await deps.registry.registerProvider(slowProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
      { timeoutMs: 200, retryOnFailure: false },
    );

    const events = executor.getEvents();
    // Should have a failed or timeout event
    expect(events.some(e => e.phase === 'failed' || e.phase === 'timeout')).toBe(true);
  }, 10000);
});

describe('CapabilityExecutor — Provider Crash', () => {
  it('should handle provider execute() throwing an error', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);

    const crashProvider = makeProvider('actuate.filesystem.read', vi.fn().mockRejectedValue(
      new Error('Provider process crashed'),
    ));
    await deps.registry.registerProvider(crashProvider);

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
      { retryOnFailure: false },
    );

    expect(result.ok).toBe(false);
  });

  it('should emit failed event when provider crashes', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);

    const crashProvider = makeProvider('actuate.filesystem.read', vi.fn().mockRejectedValue(
      new Error('Provider process crashed'),
    ));
    await deps.registry.registerProvider(crashProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
      { retryOnFailure: false },
    );

    const events = executor.getEvents();
    expect(events.some(e => e.phase === 'failed')).toBe(true);
  });
});

describe('CapabilityExecutor — Retry on Failure', () => {
  it('should retry when retryOnFailure is true and error is retryable', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);

    let callCount = 0;
    const retryProvider = makeProvider('actuate.filesystem.read', vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount <= 1) {
        throw new Error('Transient failure');
      }
      return {
        output: { content: 'success after retry' },
        durationMs: 200,
        resourcesConsumed: { ru: 2, mu: 1, eu: 1, vu: 0 } as ResourceConsumption,
      };
    }));
    await deps.registry.registerProvider(retryProvider);

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
      { retryOnFailure: true },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.output).toEqual({ content: 'success after retry' });
    }
  });

  it('should fail after max retries are exhausted', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);

    const alwaysFailProvider = makeProvider('actuate.filesystem.read', vi.fn().mockRejectedValue(
      new Error('Persistent failure'),
    ));
    await deps.registry.registerProvider(alwaysFailProvider);

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
      { retryOnFailure: true },
    );

    expect(result.ok).toBe(false);
  });

  it('should not retry when retryOnFailure is false', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);

    let callCount = 0;
    const failProvider = makeProvider('actuate.filesystem.read', vi.fn().mockImplementation(async () => {
      callCount++;
      throw new Error('No retry allowed');
    }));
    await deps.registry.registerProvider(failProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
      { retryOnFailure: false },
    );

    // Should only have called execute once
    expect(callCount).toBe(1);
  });
});

describe('CapabilityExecutor — Fallback Provider', () => {
  it('should use fallback provider when primary resolution fails', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);

    // Register primary provider that will fail resolution
    const primaryProvider = makeProvider('actuate.filesystem.read');
    const fallbackProvider = makeProvider('actuate.filesystem.read');
    await deps.registry.registerProvider(primaryProvider);
    await deps.registry.registerProvider(fallbackProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid() },
      constraints: { exclude_providers: [primaryProvider.providerRecord.id] },
      preferences: { optimize_for: 'balanced' },
    };

    const result = await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
    );

    expect(result.ok).toBe(true);
    // Should have used the non-excluded provider
    if (result.ok) {
      expect(result.data.output).toBeDefined();
    }
  });

  it('should try fallbackProviderId when primary fails', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);

    const fallbackProvider = makeProvider('actuate.filesystem.read');
    await deps.registry.registerProvider(fallbackProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('nonexistent.capability'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
      { fallbackProviderId: fallbackProvider.providerRecord.id },
    );

    // Should succeed via fallback
    expect(result.ok).toBe(true);
  });

  it('should fail when fallback provider is not found', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);

    const request: ResolutionRequest = {
      capability_path: cpath('nonexistent.capability'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
      { fallbackProviderId: 'nonexistent-provider-id' as ProviderID },
    );

    expect(result.ok).toBe(false);
  });
});

describe('CapabilityExecutor — Security Deny at Pre-invoke', () => {
  it('should block provider call when security denies invocation', async () => {
    const deps = makeExecutorDeps();
    const restrictivePolicy: SecurityPolicy = {
      defaultAction: 'deny',
      capabilityRules: new Map(),
      globalRateLimit: { maxInvocationsPerHour: 1000, maxConcurrent: 50 },
      budgetLimits: { maxRuPerHour: 100_000, maxMuPerHour: 50_000 },
      approvalRequired: [],
      restricted: [],
      maxInputSizeBytes: 10_000_000,
      maxOutputSizeBytes: 100_000_000,
    };
    deps.hypervisor = new SecurityHypervisor(restrictivePolicy);
    deps.resolver = new CapabilityResolver(deps.registry);

    const executor = new CapabilityExecutor(deps);
    const provider = makeProvider('actuate.filesystem.read');
    const executeSpy = vi.fn();
    provider.execute = executeSpy;
    await deps.registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = await executor.invoke(
      request,
      {},
      { agentId: aid(), workspaceId: wid() },
    );

    expect(result.ok).toBe(false);
    // Provider.execute should never have been called
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('should emit failed event when security denies', async () => {
    const deps = makeExecutorDeps();
    const restrictivePolicy: SecurityPolicy = {
      defaultAction: 'deny',
      capabilityRules: new Map(),
      globalRateLimit: { maxInvocationsPerHour: 1000, maxConcurrent: 50 },
      budgetLimits: { maxRuPerHour: 100_000, maxMuPerHour: 50_000 },
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

    await executor.invoke(request, {}, { agentId: aid(), workspaceId: wid() });

    const events = executor.getEvents();
    expect(events.some(e => e.phase === 'failed')).toBe(true);
  });
});

describe('CapabilityExecutor — Consumption Tracking', () => {
  it('should record consumption in the tracker after successful invocation', async () => {
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

  it('should track consumption from multiple invocations', async () => {
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

    expect(deps.consumptionTracker.count).toBe(2);
    const total = deps.consumptionTracker.getByAgent(agentId);
    expect(total.ru).toBeGreaterThan(0);
  });

  it('should expose consumption tracker via getConsumptionTracker', () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);

    expect(executor.getConsumptionTracker()).toBe(deps.consumptionTracker);
  });
});

describe('CapabilityExecutor — Memory Artifact Generation', () => {
  it('should generate memory artifact on successful invocation when configured', async () => {
    const deps = makeExecutorDeps();
    const mockMemory = {
      generateArtifact: vi.fn(),
    };
    const executor = new CapabilityExecutor({ ...deps, memory: mockMemory as any });
    const provider = makeProvider('actuate.filesystem.read');
    await deps.registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const taskId = tid();
    const agentId = aid();
    await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId, taskId, workspaceId: wid() },
    );

    expect(mockMemory.generateArtifact).toHaveBeenCalled();
  });

  it('should not fail invocation if memory artifact generation throws', async () => {
    const deps = makeExecutorDeps();
    const mockMemory = {
      generateArtifact: vi.fn().mockImplementation(() => {
        throw new Error('Memory service unavailable');
      }),
    };
    const executor = new CapabilityExecutor({ ...deps, memory: mockMemory as any });
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

    // Should still succeed despite memory failure
    expect(result.ok).toBe(true);
  });

  it('should not generate memory artifact when generateMemoryArtifacts is false', async () => {
    const deps = makeExecutorDeps();
    const mockMemory = {
      generateArtifact: vi.fn(),
    };
    const executor = new CapabilityExecutor({
      ...deps,
      memory: mockMemory as any,
      config: { generateMemoryArtifacts: false },
    });
    const provider = makeProvider('actuate.filesystem.read');
    await deps.registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
    );

    expect(mockMemory.generateArtifact).not.toHaveBeenCalled();
  });
});

describe('CapabilityExecutor — Concurrent Invocations', () => {
  it('should handle multiple concurrent invocations', async () => {
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

    // Fire 3 concurrent invocations
    const results = await Promise.all([
      executor.invoke(request, { path: '/tmp/1.txt' }, { agentId, workspaceId: wsId }),
      executor.invoke(request, { path: '/tmp/2.txt' }, { agentId, workspaceId: wsId }),
      executor.invoke(request, { path: '/tmp/3.txt' }, { agentId, workspaceId: wsId }),
    ]);

    for (const result of results) {
      expect(result.ok).toBe(true);
    }

    expect(deps.consumptionTracker.count).toBe(3);
  });
});

describe('CapabilityExecutor — Lifecycle Event Logging', () => {
  it('should emit created event at start of invocation', async () => {
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

    await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
    );

    const events = executor.getEvents();
    expect(events.some(e => e.phase === 'created')).toBe(true);
  });

  it('should emit resolved event after resolution succeeds', async () => {
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

    await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
    );

    const events = executor.getEvents();
    expect(events.some(e => e.phase === 'resolved')).toBe(true);
  });

  it('should emit approved event after security check passes', async () => {
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

    await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
    );

    const events = executor.getEvents();
    expect(events.some(e => e.phase === 'approved')).toBe(true);
  });

  it('should emit executing event during provider execution', async () => {
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

    await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
    );

    const events = executor.getEvents();
    expect(events.some(e => e.phase === 'executing')).toBe(true);
  });

  it('should emit completed event after successful execution', async () => {
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

    await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
    );

    const events = executor.getEvents();
    expect(events.some(e => e.phase === 'completed')).toBe(true);
  });

  it('should record duration and resources in completed event', async () => {
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

    await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
    );

    const events = executor.getEvents();
    const completedEvent = events.find(e => e.phase === 'completed');
    expect(completedEvent).toBeDefined();
    expect(completedEvent!.durationMs).toBeDefined();
    expect(completedEvent!.resourcesConsumed).toBeDefined();
  });

  it('should include invocation metadata in events', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor(deps);
    const provider = makeProvider('actuate.filesystem.read');
    await deps.registry.registerProvider(provider);

    const agentId = aid();
    const taskId = tid();
    const wsId = wid();
    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: agentId, task_id: taskId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId, taskId, workspaceId: wsId },
    );

    const events = executor.getEvents();
    for (const event of events) {
      expect(event.capabilityPath).toBe(cpath('actuate.filesystem.read'));
      expect(event.callerAgentId).toBe(agentId);
      expect(event.workspaceId).toBe(wsId);
    }
  });

  it('should not emit events when emitEvents config is false', async () => {
    const deps = makeExecutorDeps();
    const executor = new CapabilityExecutor({
      ...deps,
      config: { emitEvents: false },
    });
    const provider = makeProvider('actuate.filesystem.read');
    await deps.registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: aid() },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    await executor.invoke(
      request,
      { path: '/tmp/test.txt' },
      { agentId: aid(), workspaceId: wid() },
    );

    const events = executor.getEvents();
    expect(events.length).toBe(0);
  });
});