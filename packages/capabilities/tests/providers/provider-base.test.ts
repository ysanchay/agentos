/**
 * @agentos/capabilities — Provider Base Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { ProviderBase, type ProviderBaseConfig, type ProviderCapabilityDef } from '../../src/providers/provider-base.js';
import type { ProviderExecuteContext, ProviderSandboxConfig } from '../../src/types.js';
import type {
  CapabilityInvocation,
  InvocationID,
  AgentID,
  WorkspaceID,
  ProviderID,
  CapabilityPath,
} from '@agentos/types';
import { createUUID } from '@agentos/types';

// ─── Test Provider Implementation ─────────────────────────────────────────────

class TestProvider extends ProviderBase {
  constructor(config: ProviderBaseConfig, defs: ProviderCapabilityDef[]) {
    super(config, defs);
  }
}

function makeInvocation(path: string): CapabilityInvocation {
  return {
    id: createUUID() as unknown as InvocationID,
    capability_path: path as CapabilityPath,
    provider_id: createUUID() as unknown as ProviderID,
    caller: {
      agent_id: createUUID() as unknown as AgentID,
      workspace_id: createUUID() as unknown as WorkspaceID,
    },
    input: {},
    options: { timeout_ms: 30000, priority: 3, retry_on_failure: false },
    status: 'pending',
    created_at: new Date().toISOString(),
  };
}

function makeContext(invocation: CapabilityInvocation): ProviderExecuteContext {
  return {
    invocation,
    capability: {} as any,
    env: {},
    deadlineMs: 30000,
    log: () => {},
    signal: new AbortController().signal,
  };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('ProviderBase', () => {
  it('should register capabilities from definitions', () => {
    const provider = new TestProvider(
      { root: 'actuate' },
      [
        {
          path: 'actuate.filesystem.read',
          displayName: 'Read File',
          description: 'Read a file',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          handler: vi.fn().mockResolvedValue({ output: {}, durationMs: 10, resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 } }),
        },
        {
          path: 'actuate.filesystem.write',
          displayName: 'Write File',
          description: 'Write a file',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          handler: vi.fn().mockResolvedValue({ output: {}, durationMs: 10, resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 } }),
        },
      ],
    );

    expect(provider.capabilities.length).toBe(2);
    expect(provider.capabilities[0]!.path).toBe('actuate.filesystem.read');
    expect(provider.capabilities[1]!.path).toBe('actuate.filesystem.write');
  });

  it('should build provider record', () => {
    const provider = new TestProvider(
      { root: 'actuate', reliabilityScore: 0.99, avgLatencyMs: 50, successRate: 0.98 },
      [
        {
          path: 'actuate.test',
          displayName: 'Test',
          description: 'Test capability',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          handler: vi.fn().mockResolvedValue({ output: {}, durationMs: 10, resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 } }),
        },
      ],
    );

    expect(provider.providerRecord.reliability_score).toBe(0.99);
    expect(provider.providerRecord.avg_latency_ms).toBe(50);
    expect(provider.providerRecord.success_rate).toBe(0.98);
    expect(provider.providerRecord.status).toBe('available');
  });

  it('should dispatch to the correct handler', async () => {
    const readHandler = vi.fn().mockResolvedValue({ output: { content: 'hello' }, durationMs: 10, resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 } });
    const writeHandler = vi.fn().mockResolvedValue({ output: { success: true }, durationMs: 20, resourcesConsumed: { ru: 2, mu: 1, eu: 1, vu: 0 } });

    const provider = new TestProvider(
      { root: 'actuate' },
      [
        {
          path: 'actuate.filesystem.read',
          displayName: 'Read',
          description: 'Read',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          handler: readHandler,
        },
        {
          path: 'actuate.filesystem.write',
          displayName: 'Write',
          description: 'Write',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          handler: writeHandler,
        },
      ],
    );

    const readInvocation = makeInvocation('actuate.filesystem.read');
    await provider.execute(makeContext(readInvocation));
    expect(readHandler).toHaveBeenCalledOnce();

    const writeInvocation = makeInvocation('actuate.filesystem.write');
    await provider.execute(makeContext(writeInvocation));
    expect(writeHandler).toHaveBeenCalledOnce();
  });

  it('should throw for unknown capability paths', async () => {
    const provider = new TestProvider(
      { root: 'actuate' },
      [
        {
          path: 'actuate.filesystem.read',
          displayName: 'Read',
          description: 'Read',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          handler: vi.fn().mockResolvedValue({ output: {}, durationMs: 10, resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 } }),
        },
      ],
    );

    const invocation = makeInvocation('actuate.nonexistent');
    await expect(provider.execute(makeContext(invocation))).rejects.toThrow('No handler for capability path');
  });

  it('should fall back to parent handler', async () => {
    const parentHandler = vi.fn().mockResolvedValue({ output: { result: 'parent' }, durationMs: 10, resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 } });

    const provider = new TestProvider(
      { root: 'actuate' },
      [
        {
          path: 'actuate.filesystem',
          displayName: 'Filesystem',
          description: 'Filesystem operations',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          handler: parentHandler,
        },
      ],
    );

    const invocation = makeInvocation('actuate.filesystem.read');
    await provider.execute(makeContext(invocation));
    expect(parentHandler).toHaveBeenCalledOnce();
  });

  it('should build sandbox config with defaults', () => {
    const provider = new TestProvider(
      { root: 'actuate' },
      [
        {
          path: 'actuate.test',
          displayName: 'Test',
          description: 'Test',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          handler: vi.fn().mockResolvedValue({ output: {}, durationMs: 10, resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 } }),
        },
      ],
    );

    expect(provider.sandboxConfig.filesystem.enabled).toBe(false);
    expect(provider.sandboxConfig.network.enabled).toBe(false);
    expect(provider.sandboxConfig.process.enabled).toBe(false);
    expect(provider.sandboxConfig.maxTimeoutMs).toBe(30_000);
  });

  it('should pass health check by default', async () => {
    const provider = new TestProvider(
      { root: 'actuate' },
      [
        {
          path: 'actuate.test',
          displayName: 'Test',
          description: 'Test',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          handler: vi.fn().mockResolvedValue({ output: {}, durationMs: 10, resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 } }),
        },
      ],
    );

    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
  });

  it('should initialize and shutdown without error', async () => {
    const provider = new TestProvider(
      { root: 'actuate' },
      [
        {
          path: 'actuate.test',
          displayName: 'Test',
          description: 'Test',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          handler: vi.fn().mockResolvedValue({ output: {}, durationMs: 10, resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 } }),
        },
      ],
    );

    await expect(provider.initialize()).resolves.toBeUndefined();
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });

  it('should set capability stability and permissions', () => {
    const provider = new TestProvider(
      { root: 'actuate' },
      [
        {
          path: 'actuate.shell.exec',
          displayName: 'Exec',
          description: 'Execute',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object' },
          handler: vi.fn(),
          stability: 'beta',
          permissionsRequired: ['shell:exec'],
        },
      ],
    );

    expect(provider.capabilities[0]!.stability).toBe('beta');
    expect(provider.capabilities[0]!.permissions_required).toEqual(['shell:exec']);
  });
});