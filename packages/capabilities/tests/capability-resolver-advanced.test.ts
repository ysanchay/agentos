/**
 * @agentos/capabilities — Capability Resolver Advanced Tests
 * Tests the 7-phase resolution algorithm beyond basic tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CapabilityResolver } from '../src/capability-resolver.js';
import { CapabilityRegistry } from '../src/capability-registry.js';
import type { ICapabilityProvider, ProviderSandboxConfig } from '../src/types.js';
import type {
  Capability,
  CapabilityProvider,
  CapabilityPath,
  CapabilityID,
  ProviderID,
  CapabilityState,
  CapabilityStability,
  RootCapability,
  CostModel,
  ResourceProfile,
  ResolutionRequest,
} from '@agentos/types';
import { createUUID } from '@agentos/types';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function cpath(p: string): CapabilityPath { return p as CapabilityPath; }

function makeCapability(path: string, overrides?: Partial<Capability>): Capability {
  return {
    id: createUUID() as CapabilityID,
    path: cpath(path),
    version: '1.0.0',
    display_name: `Capability ${path}`,
    description: '',
    root: path.split('.')[0] as RootCapability,
    parent: undefined,
    children: [],
    state: 'active' as CapabilityState,
    input_schema: {},
    output_schema: {},
    permissions_required: [],
    stability: 'stable' as CapabilityStability,
    resource_profile: { typical: { ru: 10, mu: 5, eu: 1, vu: 0 }, peak: { ru: 50, mu: 25, eu: 5, vu: 0 }, timeout_ms: 30000 } as ResourceProfile,
    timeout_ms: 30000,
    provider_count: 1,
    deprecated: false,
    tags: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeProvider(path: string, overrides?: Partial<CapabilityProvider>): ICapabilityProvider {
  const capability = makeCapability(path);
  const record: CapabilityProvider = {
    id: createUUID() as ProviderID,
    capability_path: cpath(path),
    reliability_score: 0.9,
    avg_latency_ms: 100,
    success_rate: 0.95,
    cost_model: { type: 'free' } as CostModel,
    max_concurrent: 10,
    current_load: 0,
    supported_versions: ['1.0.0'],
    status: 'available',
    last_health_check: new Date().toISOString(),
    registered_at: new Date().toISOString(),
    ...overrides,
  };
  const sandboxConfig: ProviderSandboxConfig = {
    filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
    network: { enabled: false, allowedHosts: [], allowOutbound: false, maxResponseSize: 0 },
    process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
    maxTimeoutMs: 30000,
  };

  return {
    providerRecord: record,
    capabilities: [capability],
    sandboxConfig,
    execute: async () => ({ output: {}, durationMs: 100, resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 } }),
    healthCheck: async () => ({ healthy: true, latencyMs: 50 }),
    initialize: async () => {},
    shutdown: async () => {},
  };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('CapabilityResolver — Phase 1: Capability Lookup', () => {
  let registry: CapabilityRegistry;
  let resolver: CapabilityResolver;

  beforeEach(async () => {
    registry = new CapabilityRegistry();
    resolver = new CapabilityResolver(registry);
  });

  it('should resolve exact match when capability path exists', async () => {
    const provider = makeProvider('reason.infer.text');
    await registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('reason.infer.text'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.match_type).toBe('exact');
    }
  });

  it('should fall back to parent when exact path not found', async () => {
    // Register provider at 'reason.infer.text' but request 'reason.infer.text.custom'
    const provider = makeProvider('reason.infer.text');
    await registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('reason.infer.text.custom'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.match_type).toBe('parent_fallback');
      // Should use the parent capability
      expect(result.data.capability.path).toBe(cpath('reason.infer.text'));
    }
  });

  it('should fall back to grandparent when parent not found', async () => {
    // Register provider at 'reason.infer' but request 'reason.infer.text.custom'
    const provider = makeProvider('reason.infer');
    await registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('reason.infer.text.custom'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.match_type).toBe('parent_fallback');
      expect(result.data.capability.path).toBe(cpath('reason.infer'));
    }
  });

  it('should fall back to root when no deeper match exists', async () => {
    const provider = makeProvider('reason');
    await registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('reason.infer.text.custom.deep'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.match_type).toBe('parent_fallback');
      expect(result.data.capability.path).toBe(cpath('reason'));
    }
  });

  it('should return error when no path segment matches', async () => {
    // No capabilities registered at all
    const request: ResolutionRequest = {
      capability_path: cpath('unknown.capability.path'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(false);
  });
});

describe('CapabilityResolver — Phase 2: Provider Filtering', () => {
  let registry: CapabilityRegistry;
  let resolver: CapabilityResolver;

  beforeEach(async () => {
    registry = new CapabilityRegistry();
    resolver = new CapabilityResolver(registry);
  });

  it('should exclude providers listed in exclude_providers', async () => {
    const provider1 = makeProvider('actuate.filesystem.read');
    const provider2 = makeProvider('actuate.filesystem.read');
    const provider3 = makeProvider('actuate.filesystem.read');
    await registry.registerProvider(provider1);
    await registry.registerProvider(provider2);
    await registry.registerProvider(provider3);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {
        exclude_providers: [provider1.providerRecord.id, provider2.providerRecord.id],
      },
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.provider.id).toBe(provider3.providerRecord.id);
    }
  });

  it('should filter by require_local', async () => {
    const localProvider = makeProvider('actuate.filesystem.read', {
      agent_id: createUUID() as any,
    });
    const remoteProvider = makeProvider('actuate.filesystem.read');
    await registry.registerProvider(localProvider);
    await registry.registerProvider(remoteProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: { require_local: true },
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.provider.id).toBe(localProvider.providerRecord.id);
    }
  });

  it('should filter over-capacity providers (current_load >= max_concurrent)', async () => {
    const availableProvider = makeProvider('actuate.filesystem.read', {
      max_concurrent: 10,
      current_load: 3,
    });
    const overCapacityProvider = makeProvider('actuate.filesystem.read', {
      max_concurrent: 5,
      current_load: 5, // At capacity
    });
    await registry.registerProvider(availableProvider);
    await registry.registerProvider(overCapacityProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.provider.id).toBe(availableProvider.providerRecord.id);
    }
  });

  it('should return error when all providers are filtered out', async () => {
    const provider1 = makeProvider('actuate.filesystem.read');
    const provider2 = makeProvider('actuate.filesystem.read');
    await registry.registerProvider(provider1);
    await registry.registerProvider(provider2);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {
        exclude_providers: [provider1.providerRecord.id, provider2.providerRecord.id],
      },
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(false);
  });

  it('should return error when no providers meet require_local', async () => {
    const remoteProvider = makeProvider('actuate.filesystem.read');
    await registry.registerProvider(remoteProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: { require_local: true },
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(false);
  });
});

describe('CapabilityResolver — Phase 3: Constraint Filtering', () => {
  let registry: CapabilityRegistry;
  let resolver: CapabilityResolver;

  beforeEach(async () => {
    registry = new CapabilityRegistry();
    resolver = new CapabilityResolver(registry);
  });

  it('should filter by max_latency_ms', async () => {
    const fastProvider = makeProvider('actuate.filesystem.read', { avg_latency_ms: 20 });
    const slowProvider = makeProvider('actuate.filesystem.read', { avg_latency_ms: 5000 });
    await registry.registerProvider(fastProvider);
    await registry.registerProvider(slowProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: { max_latency_ms: 100 },
      preferences: { optimize_for: 'latency' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.provider.avg_latency_ms).toBe(20);
    }
  });

  it('should filter by min_reliability', async () => {
    const reliableProvider = makeProvider('actuate.filesystem.read', { reliability_score: 0.99 });
    const unreliableProvider = makeProvider('actuate.filesystem.read', { reliability_score: 0.5 });
    await registry.registerProvider(reliableProvider);
    await registry.registerProvider(unreliableProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: { min_reliability: 0.8 },
      preferences: { optimize_for: 'reliability' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.provider.reliability_score).toBe(0.99);
    }
  });

  it('should filter by max_cost', async () => {
    const freeProvider = makeProvider('actuate.filesystem.read', {
      cost_model: { type: 'free' } as CostModel,
    });
    const expensiveProvider = makeProvider('actuate.filesystem.read', {
      cost_model: { type: 'per_call', cost: { ru: 1000, mu: 500, eu: 100, vu: 50 } } as CostModel,
    });
    await registry.registerProvider(freeProvider);
    await registry.registerProvider(expensiveProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: { max_cost: { ru: 10, mu: 10, eu: 10, vu: 10 } },
      preferences: { optimize_for: 'cost' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The free provider should be chosen since the expensive one exceeds max_cost
      expect(result.data.provider.cost_model.type).toBe('free');
    }
  });

  it('should return error when no providers meet latency constraint', async () => {
    const slowProvider = makeProvider('actuate.filesystem.read', { avg_latency_ms: 5000 });
    await registry.registerProvider(slowProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: { max_latency_ms: 10 },
      preferences: { optimize_for: 'latency' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(false);
  });

  it('should return error when no providers meet reliability constraint', async () => {
    const unreliableProvider = makeProvider('actuate.filesystem.read', { reliability_score: 0.3 });
    await registry.registerProvider(unreliableProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: { min_reliability: 0.9 },
      preferences: { optimize_for: 'reliability' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(false);
  });
});

describe('CapabilityResolver — Phase 4-5: Scoring and Ranking', () => {
  it('should optimize for latency — pick fastest provider', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    const fastProvider = makeProvider('actuate.filesystem.read', {
      avg_latency_ms: 10,
      reliability_score: 0.7,
    });
    const slowProvider = makeProvider('actuate.filesystem.read', {
      avg_latency_ms: 500,
      reliability_score: 0.99,
    });
    await registry.registerProvider(fastProvider);
    await registry.registerProvider(slowProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'latency' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.provider.avg_latency_ms).toBe(10);
    }
  });

  it('should optimize for cost — pick cheapest provider', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    const freeProvider = makeProvider('actuate.filesystem.read', {
      cost_model: { type: 'free' } as CostModel,
    });
    const paidProvider = makeProvider('actuate.filesystem.read', {
      cost_model: { type: 'per_call', cost: { ru: 50, mu: 20, eu: 5, vu: 0 } } as CostModel,
    });
    await registry.registerProvider(freeProvider);
    await registry.registerProvider(paidProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'cost' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.provider.cost_model.type).toBe('free');
    }
  });

  it('should optimize for reliability — pick most reliable provider', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    const reliableProvider = makeProvider('actuate.filesystem.read', {
      reliability_score: 0.99,
      avg_latency_ms: 500,
    });
    const unreliableProvider = makeProvider('actuate.filesystem.read', {
      reliability_score: 0.6,
      avg_latency_ms: 10,
    });
    await registry.registerProvider(reliableProvider);
    await registry.registerProvider(unreliableProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'reliability' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.provider.reliability_score).toBe(0.99);
    }
  });

  it('should optimize for quality — balance reliability and load', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    const highQualityProvider = makeProvider('actuate.filesystem.read', {
      reliability_score: 0.95,
      max_concurrent: 10,
      current_load: 2,
    });
    const lowQualityProvider = makeProvider('actuate.filesystem.read', {
      reliability_score: 0.5,
      max_concurrent: 10,
      current_load: 9,
    });
    await registry.registerProvider(highQualityProvider);
    await registry.registerProvider(lowQualityProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'quality' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.provider.id).toBe(highQualityProvider.providerRecord.id);
    }
  });

  it('should optimize for balanced — weigh all factors equally', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    // Provider with overall best balance
    const balancedProvider = makeProvider('actuate.filesystem.read', {
      avg_latency_ms: 80,
      reliability_score: 0.92,
      max_concurrent: 10,
      current_load: 1,
    });
    // Provider that is extreme in one dimension
    const extremeProvider = makeProvider('actuate.filesystem.read', {
      avg_latency_ms: 5,
      reliability_score: 0.4,
      max_concurrent: 10,
      current_load: 9,
    });
    await registry.registerProvider(balancedProvider);
    await registry.registerProvider(extremeProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.provider.id).toBe(balancedProvider.providerRecord.id);
    }
  });

  it('should fall back to balanced weights for unknown optimization target', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    const provider = makeProvider('actuate.filesystem.read', {
      avg_latency_ms: 100,
      reliability_score: 0.9,
    });
    await registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'unknown_target' as any },
    };

    const result = resolver.resolve(request);
    // Should still resolve (using balanced weights as fallback)
    expect(result.ok).toBe(true);
  });
});

describe('CapabilityResolver — Phase 6: Result Construction', () => {
  it('should include alternatives array with up to 5 entries', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    const providers: ICapabilityProvider[] = [];
    for (let i = 0; i < 7; i++) {
      const p = makeProvider('actuate.filesystem.read', {
        reliability_score: 0.9 - i * 0.05,
      });
      providers.push(p);
      await registry.registerProvider(p);
    }

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Top 1 is the main provider, next up to 5 are alternatives (capped at 5)
      expect(result.data.alternatives.length).toBeLessThanOrEqual(5);
      // 7 total - 1 top = 6, but alternatives array is capped at 5 (slice(1, 6))
      expect(result.data.alternatives.length).toBe(5);
    }
  });

  it('should set confidence score from top provider score', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    const provider = makeProvider('actuate.filesystem.read', { reliability_score: 0.95 });
    await registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.confidence).toBeGreaterThan(0);
      expect(result.data.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('should include estimated_latency_ms from provider', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    const provider = makeProvider('actuate.filesystem.read', { avg_latency_ms: 42 });
    await registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.estimated_latency_ms).toBe(42);
    }
  });

  it('should include estimated_cost from cost model', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    const provider = makeProvider('actuate.filesystem.read', {
      cost_model: { type: 'per_call', cost: { ru: 5, mu: 3, eu: 1, vu: 0 } } as CostModel,
    });
    await registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.estimated_cost).toEqual({ ru: 5, mu: 3, eu: 1, vu: 0 });
    }
  });

  it('should include resolved_at timestamp', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    const provider = makeProvider('actuate.filesystem.read');
    await registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const before = new Date().toISOString();
    const result = resolver.resolve(request);
    const after = new Date().toISOString();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.resolved_at).toBeDefined();
      // Timestamp should be between before and after
      expect(result.data.resolved_at >= before).toBe(true);
      expect(result.data.resolved_at <= after).toBe(true);
    }
  });

  it('should include the original request in the result', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    const provider = makeProvider('actuate.filesystem.read');
    await registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.request).toBe(request);
    }
  });

  it('should estimate zero cost for free providers', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    const provider = makeProvider('actuate.filesystem.read', {
      cost_model: { type: 'free' } as CostModel,
    });
    await registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.estimated_cost).toEqual({ ru: 0, mu: 0, eu: 0, vu: 0 });
    }
  });

  it('should estimate cost for subscription providers as zero', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    const provider = makeProvider('actuate.filesystem.read', {
      cost_model: { type: 'subscription' } as CostModel,
    });
    await registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.estimated_cost).toEqual({ ru: 0, mu: 0, eu: 0, vu: 0 });
    }
  });

  it('should estimate first-tier cost for tiered providers', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    const provider = makeProvider('actuate.filesystem.read', {
      cost_model: {
        type: 'tiered',
        tiers: [
          { limit: 100, cost: { ru: 5, mu: 2, eu: 1, vu: 0 } },
          { limit: 1000, cost: { ru: 3, mu: 1, eu: 0, vu: 0 } },
        ],
      } as CostModel,
    });
    await registry.registerProvider(provider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.estimated_cost).toEqual({ ru: 5, mu: 2, eu: 1, vu: 0 });
    }
  });

  it('should sort alternatives by descending score', async () => {
    const registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);

    // Register 3 providers with clear score differences
    const bestProvider = makeProvider('actuate.filesystem.read', {
      reliability_score: 0.99,
      avg_latency_ms: 10,
    });
    const midProvider = makeProvider('actuate.filesystem.read', {
      reliability_score: 0.85,
      avg_latency_ms: 100,
    });
    const worstProvider = makeProvider('actuate.filesystem.read', {
      reliability_score: 0.6,
      avg_latency_ms: 500,
    });
    await registry.registerProvider(bestProvider);
    await registry.registerProvider(midProvider);
    await registry.registerProvider(worstProvider);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Top provider should be the best one
      expect(result.data.provider.id).toBe(bestProvider.providerRecord.id);

      // Alternatives should be in descending score order
      for (let i = 0; i < result.data.alternatives.length - 1; i++) {
        expect(result.data.alternatives[i]!.score).toBeGreaterThanOrEqual(
          result.data.alternatives[i + 1]!.score,
        );
      }
    }
  });
});