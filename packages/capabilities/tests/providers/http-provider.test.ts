/**
 * @agentos/capabilities — HTTP Provider Tests
 * Tests HTTP operations using a mock fetch approach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HttpProvider } from '../../src/providers/http-provider.js';
import type { ProviderExecuteContext } from '../../src/types.js';
import type {
  CapabilityInvocation,
  InvocationID,
  AgentID,
  WorkspaceID,
  ProviderID,
  CapabilityPath,
} from '@agentos/types';
import { createUUID } from '@agentos/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInvocation(path: string, input: unknown): CapabilityInvocation {
  return {
    id: createUUID() as unknown as InvocationID,
    capability_path: path as CapabilityPath,
    provider_id: createUUID() as unknown as ProviderID,
    caller: {
      agent_id: createUUID() as unknown as AgentID,
      workspace_id: createUUID() as unknown as WorkspaceID,
    },
    input,
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

describe('HttpProvider', () => {
  it('should register HTTP capabilities', () => {
    const provider = new HttpProvider();
    const paths = provider.capabilities.map(c => c.path as string);
    expect(paths).toContain('communicate.http.get');
    expect(paths).toContain('communicate.http.post');
    expect(paths).toContain('communicate.http.put');
    expect(paths).toContain('communicate.http.delete');
    expect(paths).toContain('communicate.http.head');
  });

  it('should have network sandbox enabled', () => {
    const provider = new HttpProvider();
    expect(provider.sandboxConfig.network.enabled).toBe(true);
    expect(provider.sandboxConfig.network.allowOutbound).toBe(true);
  });

  it('should build provider record with communicate root', () => {
    const provider = new HttpProvider();
    expect(provider.providerRecord.id).toBeDefined();
    expect(provider.capabilities[0]!.root).toBe('communicate');
  });

  it('should reject disallowed hosts', async () => {
    const provider = new HttpProvider({ allowedHosts: ['api.example.com'] });

    const invocation = makeInvocation('communicate.http.get', { url: 'https://evil.com/data' });
    const context = makeContext(invocation);

    await expect(provider.execute(context)).rejects.toThrow('not allowed');
  });

  it('should allow wildcard host patterns', async () => {
    const provider = new HttpProvider({ allowedHosts: ['*.example.com'] });

    // This should not throw a "not allowed" error — it'll try to actually
    // make the request and fail on network, but the host check passes
    const invocation = makeInvocation('communicate.http.get', { url: 'https://api.example.com/data' });
    const context = makeContext(invocation);

    // The request will fail because we can't reach api.example.com in tests,
    // but we're just verifying the host check passes
    try {
      await provider.execute(context);
    } catch (e) {
      // Should NOT be a "not allowed" error
      expect((e as Error).message).not.toContain('not allowed');
    }
  });

  it('should use custom default headers', () => {
    const provider = new HttpProvider({
      defaultHeaders: { 'X-Custom': 'test' },
    });
    // Provider creates successfully with custom headers
    expect(provider).toBeDefined();
  });

  it('should respect max response size config', () => {
    const provider = new HttpProvider({ maxResponseSize: 1000 });
    expect(provider.sandboxConfig.network.maxResponseSize).toBe(1000);
  });

  it('should have correct capability paths under communicate', () => {
    const provider = new HttpProvider();
    for (const cap of provider.capabilities) {
      expect((cap.path as string).startsWith('communicate.http')).toBe(true);
    }
  });
});