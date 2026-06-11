/**
 * @agentos/browser — Browser Session Lifecycle Tests
 * Comprehensive tests for session creation, expiry, touch, close, state, and config.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserSession } from '../src/browser-session.js';
import { HTTPStrategy } from '../src/strategies/http-strategy.js';
import type { IBrowserStrategy } from '../src/types.js';

describe('BrowserSession - Lifecycle', () => {
  let strategy: IBrowserStrategy;

  beforeEach(() => {
    strategy = new HTTPStrategy();
  });

  it('should create a session with HTTPStrategy', () => {
    const session = new BrowserSession(strategy);
    expect(session).toBeDefined();
    expect(session.sessionId).toBeDefined();
    expect(session.sessionId.length).toBeGreaterThan(0);
    expect(session.isActive).toBe(true);
  });

  it('should expire after idleTimeoutMs', async () => {
    const session = new BrowserSession(strategy, { idleTimeoutMs: 1 });
    // Wait for the session to expire
    await new Promise<void>(resolve => setTimeout(resolve, 10));
    expect(session.isExpired).toBe(true);
    expect(session.isActive).toBe(false);
  });

  it('should reset expiry timer on touch()', async () => {
    const session = new BrowserSession(strategy, { idleTimeoutMs: 50 });
    // Wait just under the timeout, then touch to reset
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    session.touch();
    // Session should still be active after touch resets the timer
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    expect(session.isActive).toBe(true);
  });

  it('should mark session inactive after close()', async () => {
    const session = new BrowserSession(strategy);
    expect(session.isActive).toBe(true);
    await session.close();
    expect(session.isActive).toBe(false);
    expect(session.state.active).toBe(false);
  });

  it('should track request count via touch()', () => {
    const session = new BrowserSession(strategy);
    expect(session.state.requestCount).toBe(0);

    session.touch();
    expect(session.state.requestCount).toBe(1);

    session.touch();
    session.touch();
    expect(session.state.requestCount).toBe(3);
  });

  it('should return a complete state object', () => {
    const session = new BrowserSession(strategy);
    const state = session.state;

    expect(state.sessionId).toBe(session.sessionId);
    expect(state.url).toBe('');
    expect(state.title).toBe('');
    expect(state.createdAt).toBeGreaterThan(0);
    expect(state.lastActivityAt).toBeGreaterThanOrEqual(state.createdAt);
    expect(state.requestCount).toBe(0);
    expect(state.active).toBe(true);
  });

  it('should accept a custom workspaceId', () => {
    const session = new BrowserSession(strategy, { workspaceId: 'ws-custom-42' });
    expect(session).toBeDefined();
    expect(session.isActive).toBe(true);
    // Session config is applied internally; state still tracks sessionId
    expect(session.state.sessionId).toBeDefined();
  });

  it('should accept custom idleTimeoutMs in config', () => {
    const session = new BrowserSession(strategy, { idleTimeoutMs: 60_000 });
    expect(session.isActive).toBe(true);
    expect(session.isExpired).toBe(false);
  });

  it('should accept custom cookies in config', () => {
    const session = new BrowserSession(strategy, { cookies: { session: 'abc123' } });
    expect(session).toBeDefined();
    expect(session.isActive).toBe(true);
  });

  it('should expose the underlying browser strategy', () => {
    const session = new BrowserSession(strategy);
    expect(session.browserStrategy).toBe(strategy);
    expect(session.browserStrategy.name).toBe('http');
    expect(session.browserStrategy.supportsJS).toBe(false);
  });

  it('should pass health check for a fresh session', async () => {
    const session = new BrowserSession(strategy);
    const result = await session.healthCheck();
    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle auth cookie management', () => {
    const session = new BrowserSession(strategy);
    expect(session.authCookies).toEqual({});
    expect(session.hasAuthState).toBe(false);

    session.setAuthCookies({ token: 'abc', session: 'xyz' });
    expect(session.authCookies).toEqual({ token: 'abc', session: 'xyz' });
    expect(session.hasAuthState).toBe(true);
  });

  it('should merge auth cookies on repeated calls', () => {
    const session = new BrowserSession(strategy);
    session.setAuthCookies({ token: 'abc' });
    session.setAuthCookies({ session: 'xyz' });
    expect(session.authCookies).toEqual({ token: 'abc', session: 'xyz' });
  });

  it('should handle storage state management', () => {
    const session = new BrowserSession(strategy);
    expect(session.storageState).toBeUndefined();
    expect(session.hasAuthState).toBe(false);

    session.setStorageState('{"localStorage":{}}');
    expect(session.storageState).toBe('{"localStorage":{}}');
    expect(session.hasAuthState).toBe(true);
  });

  it('should clear auth state', () => {
    const session = new BrowserSession(strategy);
    session.setAuthCookies({ token: 'abc' });
    session.setStorageState('{"key":"val"}');
    expect(session.hasAuthState).toBe(true);

    session.clearAuthState();
    expect(session.authCookies).toEqual({});
    expect(session.storageState).toBeUndefined();
    expect(session.hasAuthState).toBe(false);
  });

  it('should create sessions with different IDs', () => {
    const session1 = new BrowserSession(strategy);
    const session2 = new BrowserSession(strategy);
    expect(session1.sessionId).not.toBe(session2.sessionId);
  });

  it('should initialize with initialUrl if configured', async () => {
    const mockStrategy = {
      ...strategy,
      goto: vi.fn().mockResolvedValue({ url: 'https://example.com', title: 'Example', durationMs: 50 }),
    } as unknown as IBrowserStrategy;

    const session = new BrowserSession(mockStrategy, { initialUrl: 'https://example.com' });
    await session.initialize();
    expect(mockStrategy.goto).toHaveBeenCalledWith('https://example.com');
  });

  it('should not call goto when no initialUrl configured', async () => {
    const mockStrategy = {
      ...strategy,
      goto: vi.fn(),
    } as unknown as IBrowserStrategy;

    const session = new BrowserSession(mockStrategy);
    await session.initialize();
    expect(mockStrategy.goto).not.toHaveBeenCalled();
  });
});