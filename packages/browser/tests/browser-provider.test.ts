/**
 * @agentos/browser — Browser Provider Tests
 * Tests browser capability registration, handler dispatch, and
 * session/pool management using the HTTP strategy.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserProvider } from '../src/browser-provider.js';
import { BrowserPool } from '../src/browser-pool.js';
import { BrowserSession } from '../src/browser-session.js';
import { HTTPStrategy } from '../src/strategies/http-strategy.js';
import type { ProviderExecuteContext } from '@agentos/capabilities';
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

// ═══════════════════════════════════════════════════════════════════════════

describe('BrowserProvider', () => {
  it('should register all perceive.browser capabilities', () => {
    const provider = new BrowserProvider();
    const paths = provider.capabilities.map(c => c.path as string);

    expect(paths).toContain('perceive.browser.screenshot');
    expect(paths).toContain('perceive.browser.extract');
    expect(paths).toContain('perceive.browser.query');
    expect(paths).toContain('perceive.browser.wait');
    expect(paths).toContain('perceive.browser.auth-state');
    expect(paths).toContain('perceive.browser.tabs');
  });

  it('should register all navigate.browser capabilities', () => {
    const provider = new BrowserProvider();
    const paths = provider.capabilities.map(c => c.path as string);

    expect(paths).toContain('navigate.browser.goto');
    expect(paths).toContain('navigate.browser.back');
    expect(paths).toContain('navigate.browser.forward');
    expect(paths).toContain('navigate.browser.reload');
    expect(paths).toContain('navigate.browser.click');
    expect(paths).toContain('navigate.browser.type');
    expect(paths).toContain('navigate.browser.scroll');
    expect(paths).toContain('navigate.browser.hover');
    expect(paths).toContain('navigate.browser.select');
    expect(paths).toContain('navigate.browser.authenticate');
    expect(paths).toContain('navigate.browser.download');
    expect(paths).toContain('navigate.browser.intercept');
    expect(paths).toContain('navigate.browser.dialog');
    expect(paths).toContain('navigate.browser.drag-drop');
    expect(paths).toContain('navigate.browser.file-upload');
    expect(paths).toContain('navigate.browser.switch-frame');
    expect(paths).toContain('navigate.browser.switch-tab');
    expect(paths).toContain('navigate.browser.geolocation');
    expect(paths).toContain('navigate.browser.timezone');
  });

  it('should register 25 total capabilities (13 original + 12 advanced)', () => {
    const provider = new BrowserProvider();
    expect(provider.capabilities).toHaveLength(25);
  });

  it('should have network sandbox enabled', () => {
    const provider = new BrowserProvider();
    expect(provider.sandboxConfig.network.enabled).toBe(true);
    expect(provider.sandboxConfig.network.allowOutbound).toBe(true);
  });

  it('should build provider record with perceive root', () => {
    const provider = new BrowserProvider();
    expect(provider.providerRecord.id).toBeDefined();
    expect(provider.capabilities[0]!.root).toBe('perceive');
  });

  it('should mark all capabilities as beta or experimental stability', () => {
    const provider = new BrowserProvider();
    for (const cap of provider.capabilities) {
      expect(['beta', 'experimental']).toContain(cap.stability);
    }
  });

  it('should have custom resource profiles per capability', () => {
    const provider = new BrowserProvider();
    const screenshotCap = provider.capabilities.find(c => c.path === 'perceive.browser.screenshot');
    expect(screenshotCap?.resource_profile.typical.ru).toBe(5);
    expect(screenshotCap?.resource_profile.typical.eu).toBe(10);

    const gotoCap = provider.capabilities.find(c => c.path === 'navigate.browser.goto');
    expect(gotoCap?.resource_profile.typical.ru).toBe(5);
    expect(gotoCap?.resource_profile.typical.eu).toBe(15);
  });

  it('should throw for unknown capability paths', async () => {
    const provider = new BrowserProvider();
    const invocation = makeInvocation('perceive.browser.unknown', {});
    const context = makeContext(invocation);

    await expect(provider.execute(context)).rejects.toThrow('No handler');
  });
});

describe('BrowserProvider - Navigate Handlers', () => {
  it('should reject invalid URLs in goto', async () => {
    const provider = new BrowserProvider();
    const invocation = makeInvocation('navigate.browser.goto', { url: 'not-a-url' });
    const context = makeContext(invocation);

    await expect(provider.execute(context)).rejects.toThrow(/Invalid URL|NAVIGATION_FAILED/);
  });

  it('should reject missing URL in goto', async () => {
    const provider = new BrowserProvider();
    const invocation = makeInvocation('navigate.browser.goto', {});
    const context = makeContext(invocation);

    await expect(provider.execute(context)).rejects.toThrow();
  });

  it('should return unsupported action for click with HTTP strategy', async () => {
    const provider = new BrowserProvider();
    const invocation = makeInvocation('navigate.browser.click', { selector: '#btn' });
    const context = makeContext(invocation);

    const result = await provider.execute(context);
    expect(result.output).toMatchObject({ success: false });
    expect((result.output as any).error).toContain('REQUIRES_JS');
  });

  it('should return unsupported action for type with HTTP strategy', async () => {
    const provider = new BrowserProvider();
    const invocation = makeInvocation('navigate.browser.type', { selector: '#input', text: 'hello' });
    const context = makeContext(invocation);

    const result = await provider.execute(context);
    expect(result.output).toMatchObject({ success: false });
    expect((result.output as any).error).toContain('REQUIRES_JS');
  });

  it('should return unsupported action for scroll with HTTP strategy', async () => {
    const provider = new BrowserProvider();
    const invocation = makeInvocation('navigate.browser.scroll', { direction: 'down' });
    const context = makeContext(invocation);

    const result = await provider.execute(context);
    expect(result.output).toMatchObject({ success: false });
  });

  it('should return unsupported action for hover with HTTP strategy', async () => {
    const provider = new BrowserProvider();
    const invocation = makeInvocation('navigate.browser.hover', { selector: '#link' });
    const context = makeContext(invocation);

    const result = await provider.execute(context);
    expect(result.output).toMatchObject({ success: false });
  });

  it('should return unsupported action for select with HTTP strategy', async () => {
    const provider = new BrowserProvider();
    const invocation = makeInvocation('navigate.browser.select', { selector: '#dropdown', values: ['opt1'] });
    const context = makeContext(invocation);

    const result = await provider.execute(context);
    expect(result.output).toMatchObject({ success: false });
  });
});

describe('BrowserProvider - Perceive Handlers', () => {
  it('should return empty screenshot with HTTP strategy', async () => {
    const provider = new BrowserProvider();
    // First navigate to a page so there's content
    const gotoInvocation = makeInvocation('navigate.browser.goto', { url: 'https://example.com' });
    const gotoContext = makeContext(gotoInvocation);
    try { await provider.execute(gotoContext); } catch { /* may fail without network */ }

    const invocation = makeInvocation('perceive.browser.screenshot', {});
    const context = makeContext(invocation);

    const result = await provider.execute(context);
    expect(result.output).toMatchObject({ mimeType: 'image/png' });
    expect(result.resourcesConsumed.ru).toBe(5);
  });

  it('should extract content after navigation', async () => {
    const provider = new BrowserProvider();
    // The HTTP strategy requires navigation before extraction
    // Without network, we test that the handler dispatches correctly
    const invocation = makeInvocation('perceive.browser.extract', { selector: 'h1' });
    const context = makeContext(invocation);

    const result = await provider.execute(context);
    const output = result.output as any;
    expect(output).toHaveProperty('elements');
    expect(output).toHaveProperty('count');
    expect(output).toHaveProperty('selector', 'h1');
    expect(result.resourcesConsumed.ru).toBe(3);
  });

  it('should query elements', async () => {
    const provider = new BrowserProvider();
    const invocation = makeInvocation('perceive.browser.query', { selector: 'a' });
    const context = makeContext(invocation);

    const result = await provider.execute(context);
    const output = result.output as any;
    expect(output).toHaveProperty('elements');
    expect(result.resourcesConsumed.ru).toBe(2);
  });

  it('should wait for selector condition', async () => {
    const provider = new BrowserProvider();
    const invocation = makeInvocation('perceive.browser.wait', {
      condition: { type: 'selector', selector: 'h1' },
    });
    const context = makeContext(invocation);

    const result = await provider.execute(context);
    const output = result.output as any;
    expect(output).toHaveProperty('success');
    expect(output).toHaveProperty('conditionType', 'selector');
    expect(result.resourcesConsumed.ru).toBe(1);
  });
});

describe('BrowserProvider - Health & Lifecycle', () => {
  it('should pass health check', async () => {
    const provider = new BrowserProvider();
    const result = await provider.healthCheck();
    expect(result.healthy).toBe(true);
  });

  it('should shutdown cleanly', async () => {
    const provider = new BrowserProvider();
    await expect(provider.shutdown()).resolves.toBeUndefined();
  });

  it('should initialize without error', async () => {
    const provider = new BrowserProvider();
    await expect(provider.initialize()).resolves.toBeUndefined();
  });

  it('should accept custom config', () => {
    const provider = new BrowserProvider({
      maxSessions: 3,
      idleTimeoutMs: 60_000,
      reliabilityScore: 0.8,
    });
    expect(provider.providerRecord.reliability_score).toBe(0.8);
  });
});