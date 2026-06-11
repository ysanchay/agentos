/**
 * @agentos/capabilities — Capability Registry Tests
 */

import { describe, it, expect, vi } from 'vitest';
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
} from '@agentos/types';
import { createUUID } from '@agentos/types';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeCapability(path: string): Capability {
  return {
    id: createUUID() as CapabilityID,
    path: path as CapabilityPath,
    version: '1.0.0',
    display_name: `Capability ${path}`,
    description: `Test capability at ${path}`,
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
    provider_count: 0,
    deprecated: false,
    tags: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeProviderRecord(path: string, id?: string): CapabilityProvider {
  return {
    id: (id ?? createUUID()) as ProviderID,
    capability_path: path as CapabilityPath,
    agent_id: undefined,
    service_id: undefined,
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
  };
}

function makeProvider(path: string, id?: string): ICapabilityProvider {
  const capability = makeCapability(path);
  const record = makeProviderRecord(path, id);
  const sandboxConfig: ProviderSandboxConfig = {
    filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 10_000_000 },
    network: { enabled: false, allowedHosts: [], allowOutbound: false, maxResponseSize: 5_000_000 },
    process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
    maxTimeoutMs: 30000,
  };

  return {
    providerRecord: record,
    capabilities: [capability],
    sandboxConfig,
    execute: vi.fn().mockResolvedValue({
      output: { result: 'ok' },
      durationMs: 100,
      resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 },
    }),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 50 }),
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('CapabilityRegistry', () => {
  it('should register a capability', () => {
    const registry = new CapabilityRegistry();
    const cap = makeCapability('actuate.filesystem.read');
    const result = registry.registerCapability(cap);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(cap.id);
    expect(registry.capabilityCount).toBe(1);
  });

  it('should reject duplicate capability registration', () => {
    const registry = new CapabilityRegistry();
    const cap = makeCapability('actuate.filesystem.read');
    registry.registerCapability(cap);
    const result = registry.registerCapability(cap);

    expect(result.ok).toBe(false);
  });

  it('should get capability by ID', () => {
    const registry = new CapabilityRegistry();
    const cap = makeCapability('actuate.filesystem.read');
    registry.registerCapability(cap);

    expect(registry.getCapability(cap.id)).toBe(cap);
    expect(registry.getCapability('nonexistent' as CapabilityID)).toBeUndefined();
  });

  it('should get capability by path', () => {
    const registry = new CapabilityRegistry();
    const cap = makeCapability('actuate.filesystem.read');
    registry.registerCapability(cap);

    expect(registry.getCapabilityByPath('actuate.filesystem.read' as CapabilityPath)).toBe(cap);
    expect(registry.getCapabilityByPath('nonexistent' as CapabilityPath)).toBeUndefined();
  });

  it('should get capabilities by root', () => {
    const registry = new CapabilityRegistry();
    const cap1 = makeCapability('actuate.filesystem.read');
    const cap2 = makeCapability('actuate.shell.exec');
    const cap3 = makeCapability('communicate.http.get');
    registry.registerCapability(cap1);
    registry.registerCapability(cap2);
    registry.registerCapability(cap3);

    const actuateCaps = registry.getCapabilitiesByRoot('actuate');
    expect(actuateCaps.length).toBe(2);
  });

  it('should register a provider', async () => {
    const registry = new CapabilityRegistry();
    const provider = makeProvider('actuate.filesystem.read');
    const result = await registry.registerProvider(provider);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toBe(provider.providerRecord.id);
    expect(registry.providerCount).toBe(1);
  });

  it('should call provider.initialize() on registration', async () => {
    const registry = new CapabilityRegistry();
    const provider = makeProvider('actuate.filesystem.read');
    await registry.registerProvider(provider);

    expect(provider.initialize).toHaveBeenCalledOnce();
  });

  it('should reject duplicate provider registration', async () => {
    const registry = new CapabilityRegistry();
    const provider = makeProvider('actuate.filesystem.read');
    await registry.registerProvider(provider);
    const result = await registry.registerProvider(provider);

    expect(result.ok).toBe(false);
  });

  it('should deregister a provider', async () => {
    const registry = new CapabilityRegistry();
    const provider = makeProvider('actuate.filesystem.read');
    const result = await registry.registerProvider(provider);
    if (!result.ok) throw new Error('Registration failed');

    const deregResult = await registry.deregisterProvider(provider.providerRecord.id);
    expect(deregResult.ok).toBe(true);
    expect(registry.providerCount).toBe(0);
    expect(provider.shutdown).toHaveBeenCalledOnce();
  });

  it('should get providers for a capability path', async () => {
    const registry = new CapabilityRegistry();
    const provider = makeProvider('actuate.filesystem.read');
    await registry.registerProvider(provider);

    const providers = registry.getProviders('actuate.filesystem.read' as CapabilityPath);
    expect(providers.length).toBe(1);
    expect(providers[0]!.providerRecord.id).toBe(provider.providerRecord.id);
  });

  it('should fall back to parent path when getting providers', async () => {
    const registry = new CapabilityRegistry();
    const provider = makeProvider('actuate.filesystem');
    await registry.registerProvider(provider);

    const providers = registry.getProviders('actuate.filesystem.read' as CapabilityPath);
    expect(providers.length).toBe(1);
  });

  it('should return empty array for path with no providers', async () => {
    const registry = new CapabilityRegistry();
    const providers = registry.getProviders('nonexistent' as CapabilityPath);
    expect(providers).toEqual([]);
  });

  it('should get provider by ID', async () => {
    const registry = new CapabilityRegistry();
    const provider = makeProvider('actuate.filesystem.read');
    await registry.registerProvider(provider);

    const retrieved = registry.getProvider(provider.providerRecord.id);
    expect(retrieved).toBe(provider);
  });

  it('should list child capability paths', () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability(makeCapability('actuate.filesystem.read'));
    registry.registerCapability(makeCapability('actuate.filesystem.write'));
    registry.registerCapability(makeCapability('actuate.shell.exec'));

    const children = registry.getChildren('actuate' as CapabilityPath);
    expect(children.length).toBe(2);
    expect(children.some(c => (c as string) === 'actuate.filesystem')).toBe(true);
    expect(children.some(c => (c as string) === 'actuate.shell')).toBe(true);
  });

  it('should walk a capability path', () => {
    const registry = new CapabilityRegistry();
    registry.registerCapability(makeCapability('actuate'));
    registry.registerCapability(makeCapability('actuate.filesystem'));
    registry.registerCapability(makeCapability('actuate.filesystem.read'));

    const walked = registry.walkPath('actuate.filesystem.read' as CapabilityPath);
    expect(walked.length).toBe(3);
  });

  it('should run health checks', async () => {
    const registry = new CapabilityRegistry();
    const provider = makeProvider('actuate.filesystem.read');
    await registry.registerProvider(provider);

    await registry.runHealthChecks();
    expect(provider.healthCheck).toHaveBeenCalledOnce();

    const health = registry.getProviderHealth(provider.providerRecord.id);
    expect(health).toBeDefined();
    expect(health!.status).toBe('healthy');
  });

  it('should auto-register capabilities when provider is registered', async () => {
    const registry = new CapabilityRegistry();
    const provider = makeProvider('actuate.filesystem.read');

    expect(registry.capabilityCount).toBe(0);
    await registry.registerProvider(provider);
    expect(registry.capabilityCount).toBe(1);
  });

  it('should filter out offline providers', async () => {
    const registry = new CapabilityRegistry();
    const offlineProvider = makeProvider('actuate.filesystem.read');
    offlineProvider.providerRecord = {
      ...offlineProvider.providerRecord,
      status: 'offline',
    };
    await registry.registerProvider(offlineProvider);

    const providers = registry.getProviders('actuate.filesystem.read' as CapabilityPath);
    expect(providers.length).toBe(0);
  });
});