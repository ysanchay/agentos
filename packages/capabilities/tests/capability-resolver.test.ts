/**
 * @agentos/capabilities — Capability Resolver Tests
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

describe('CapabilityResolver', () => {
  let registry: CapabilityRegistry;
  let resolver: CapabilityResolver;

  beforeEach(async () => {
    registry = new CapabilityRegistry();
    resolver = new CapabilityResolver(registry);
  });

  it('should resolve an exact capability path', async () => {
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
      expect(result.data.match_type).toBe('exact');
      expect(result.data.provider.id).toBe(provider.providerRecord.id);
    }
  });

  it('should fall back to parent path', async () => {
    const provider = makeProvider('actuate.filesystem');
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
      expect(result.data.match_type).toBe('parent_fallback');
    }
  });

  it('should return error for unknown capability', () => {
    const request: ResolutionRequest = {
      capability_path: cpath('nonexistent.capability'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(false);
  });

  it('should return error when no providers available', () => {
    // Register capability but no provider
    registry.registerCapability(makeCapability('actuate.filesystem.read'));

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(false);
  });

  it('should filter by max latency constraint', async () => {
    const fastProvider = makeProvider('actuate.filesystem.read', { avg_latency_ms: 50, reliability_score: 0.95 });
    const slowProvider = makeProvider('actuate.filesystem.read', { avg_latency_ms: 5000, reliability_score: 0.95 });
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
      expect(result.data.provider.avg_latency_ms).toBe(50);
    }
  });

  it('should filter by min reliability constraint', async () => {
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

  it('should exclude specified providers', async () => {
    const provider1 = makeProvider('actuate.filesystem.read');
    const provider2 = makeProvider('actuate.filesystem.read');
    await registry.registerProvider(provider1);
    await registry.registerProvider(provider2);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: { exclude_providers: [provider1.providerRecord.id] },
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.provider.id).toBe(provider2.providerRecord.id);
    }
  });

  it('should include alternatives in result', async () => {
    const provider1 = makeProvider('actuate.filesystem.read', { reliability_score: 0.99 });
    const provider2 = makeProvider('actuate.filesystem.read', { reliability_score: 0.85 });
    await registry.registerProvider(provider1);
    await registry.registerProvider(provider2);

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = resolver.resolve(request);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.alternatives.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('should prioritize by optimization target', async () => {
    const fastProvider = makeProvider('actuate.filesystem.read', {
      avg_latency_ms: 10,
      reliability_score: 0.7,
    });
    const reliableProvider = makeProvider('actuate.filesystem.read', {
      avg_latency_ms: 500,
      reliability_score: 0.99,
    });
    await registry.registerProvider(fastProvider);
    await registry.registerProvider(reliableProvider);

    // Optimize for latency → pick fast
    const latencyRequest: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'latency' },
    };
    const latencyResult = resolver.resolve(latencyRequest);
    expect(latencyResult.ok).toBe(true);
    if (latencyResult.ok) {
      expect(latencyResult.data.provider.avg_latency_ms).toBe(10);
    }

    // Need a fresh registry for the reliability test
    const registry2 = new CapabilityRegistry();
    const resolver2 = new CapabilityResolver(registry2);
    const fast2 = makeProvider('actuate.filesystem.read', { avg_latency_ms: 10, reliability_score: 0.7 });
    const reliable2 = makeProvider('actuate.filesystem.read', { avg_latency_ms: 500, reliability_score: 0.99 });
    await registry2.registerProvider(fast2);
    await registry2.registerProvider(reliable2);

    // Optimize for reliability → pick reliable
    const reliabilityRequest: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: {},
      constraints: {},
      preferences: { optimize_for: 'reliability' },
    };
    const reliabilityResult = resolver2.resolve(reliabilityRequest);
    expect(reliabilityResult.ok).toBe(true);
    if (reliabilityResult.ok) {
      expect(reliabilityResult.data.provider.reliability_score).toBe(0.99);
    }
  });

  it('should return confidence score based on resolution quality', async () => {
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
});