/**
 * @agentos/desktop — DesktopProvider Tests
 * Validates capability registration, handler dispatch, and provider lifecycle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DesktopProvider } from '../src/desktop-provider.js';
import type { ProviderExecuteContext } from '@agentos/capabilities';
import type { CapabilityInvocation, InvocationID, AgentID, WorkspaceID, ProviderID, CapabilityPath } from '@agentos/types';
import { createUUID } from '@agentos/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInvocation(path: string, input: unknown): CapabilityInvocation {
  return {
    id: createUUID() as unknown as InvocationID,
    capability_path: path as CapabilityPath,
    provider_id: createUUID() as unknown as ProviderID,
    caller: {
      agent_id: createUUID() as unknown as AgentID,
      workspace_id: 'test-workspace' as unknown as WorkspaceID,
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DesktopProvider', () => {
  let provider: DesktopProvider;

  beforeEach(() => {
    provider = new DesktopProvider();
  });

  it('registers 10 capabilities (4 perceive + 6 actuate)', () => {
    expect(provider.capabilities).toHaveLength(10);

    const perceive = provider.capabilities.filter(c => c.path.startsWith('perceive.desktop'));
    const actuate = provider.capabilities.filter(c => c.path.startsWith('actuate.desktop'));

    expect(perceive).toHaveLength(4);
    expect(actuate).toHaveLength(6);
  });

  it('registers all perceive.desktop capabilities with correct paths', () => {
    const paths = provider.capabilities.map(c => c.path);

    expect(paths).toContain('perceive.desktop.screenshot');
    expect(paths).toContain('perceive.desktop.tree');
    expect(paths).toContain('perceive.desktop.query');
    expect(paths).toContain('perceive.desktop.read');
  });

  it('registers all actuate.desktop capabilities with correct paths', () => {
    const paths = provider.capabilities.map(c => c.path);

    expect(paths).toContain('actuate.desktop.click');
    expect(paths).toContain('actuate.desktop.type');
    expect(paths).toContain('actuate.desktop.scroll');
    expect(paths).toContain('actuate.desktop.launch');
    expect(paths).toContain('actuate.desktop.focus');
    expect(paths).toContain('actuate.desktop.key');
  });

  it('sets root capability to perceive', () => {
    expect(provider.providerRecord.capability_path).toContain('perceive');
  });

  it('sets default reliability and latency scores', () => {
    expect(provider.providerRecord.reliability_score).toBe(0.80);
    expect(provider.providerRecord.avg_latency_ms).toBe(200);
  });

  it('sets all perceive capabilities as beta stability', () => {
    const perceive = provider.capabilities.filter(c => c.path.startsWith('perceive.desktop'));
    for (const cap of perceive) {
      expect(cap.stability).toBe('beta');
    }
  });

  it('sets all actuate capabilities as beta stability', () => {
    const actuate = provider.capabilities.filter(c => c.path.startsWith('actuate.desktop'));
    for (const cap of actuate) {
      expect(cap.stability).toBe('beta');
    }
  });

  it('defines resource profiles for all capabilities', () => {
    for (const cap of provider.capabilities) {
      expect(cap.resource_profile).toBeDefined();
      expect(cap.resource_profile.typical).toBeDefined();
      expect(cap.resource_profile.typical.ru).toBeGreaterThan(0);
      expect(cap.resource_profile.peak).toBeDefined();
      expect(cap.resource_profile.peak.ru).toBeGreaterThanOrEqual(cap.resource_profile.typical.ru);
    }
  });

  it('screenshot capability has higher resource cost than read', () => {
    const screenshot = provider.capabilities.find(c => c.path === 'perceive.desktop.screenshot')!;
    const read = provider.capabilities.find(c => c.path === 'perceive.desktop.read')!;

    expect(screenshot.resource_profile.typical.ru).toBeGreaterThan(read.resource_profile.typical.ru);
  });

  it('launch capability has the highest EU cost', () => {
    const launch = provider.capabilities.find(c => c.path === 'actuate.desktop.launch')!;
    const otherActuate = provider.capabilities.filter(c => c.path.startsWith('actuate.desktop') && c.path !== 'actuate.desktop.launch');

    for (const other of otherActuate) {
      expect(launch.resource_profile.typical.eu).toBeGreaterThan(other.resource_profile.typical.eu);
    }
  });

  it('has sandbox config with network disabled by default', () => {
    expect(provider.sandboxConfig.network.enabled).toBe(false);
    expect(provider.sandboxConfig.network.allowOutbound).toBe(false);
  });

  it('accepts custom maxSessions config', () => {
    const custom = new DesktopProvider({ maxSessions: 5 });
    expect(custom).toBeDefined();
    expect(custom.capabilities).toHaveLength(10);
  });

  it('accepts custom strategyType config', () => {
    const custom = new DesktopProvider({ strategyType: 'nutjs' });
    expect(custom).toBeDefined();
  });

  // ─── Handler Dispatch ─────────────────────────────────────────────────────

  describe('handler dispatch', () => {
    it('routes perceive.desktop.screenshot to handler', async () => {
      // In CI with no display, NativeStrategy returns DESKTOP_NO_DISPLAY error
      const ctx = makeContext(makeInvocation('perceive.desktop.screenshot', {}));
      const result = await provider.execute(ctx);

      // Result should have output (either screenshot or error about no display)
      expect(result).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('routes perceive.desktop.query to handler', async () => {
      const ctx = makeContext(makeInvocation('perceive.desktop.query', { role: 'window' }));
      const result = await provider.execute(ctx);

      expect(result).toBeDefined();
      expect(result.resourcesConsumed).toBeDefined();
      expect(result.resourcesConsumed.ru).toBe(3); // query typical RU
    });

    it('routes actuate.desktop.click to handler', async () => {
      const ctx = makeContext(makeInvocation('actuate.desktop.click', { x: 100, y: 200 }));
      const result = await provider.execute(ctx);

      expect(result).toBeDefined();
      expect(result.resourcesConsumed).toBeDefined();
      expect(result.resourcesConsumed.ru).toBe(3); // click typical RU
    });

    it('routes actuate.desktop.type to handler', async () => {
      const ctx = makeContext(makeInvocation('actuate.desktop.type', { text: 'hello' }));
      const result = await provider.execute(ctx);

      expect(result).toBeDefined();
      expect(result.resourcesConsumed.ru).toBe(3); // type typical RU
    });

    it('throws for unknown capability path', async () => {
      const ctx = makeContext(makeInvocation('perceive.desktop.unknown', {}));
      await expect(provider.execute(ctx)).rejects.toThrow();
    });
  });

  // ─── Health Check ─────────────────────────────────────────────────────────

  describe('health check', () => {
    it('returns healthy status', async () => {
      const result = await provider.healthCheck();
      expect(result.healthy).toBe(true);
    });
  });

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('initialize and shutdown work without error', async () => {
      await expect(provider.initialize()).resolves.toBeUndefined();
      await expect(provider.shutdown()).resolves.toBeUndefined();
    });
  });
});