/**
 * @agentos/browser — Browser Session Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserSession } from '../src/browser-session.js';
import { HTTPStrategy } from '../src/strategies/http-strategy.js';
import type { IBrowserStrategy } from '../src/types.js';

describe('BrowserSession', () => {
  it('should create a session with unique ID', () => {
    const strategy = new HTTPStrategy();
    const session = new BrowserSession(strategy);
    expect(session.sessionId).toBeDefined();
    expect(session.sessionId.length).toBeGreaterThan(0);
  });

  it('should report initial state', () => {
    const strategy = new HTTPStrategy();
    const session = new BrowserSession(strategy);
    const state = session.state;

    expect(state.sessionId).toBe(session.sessionId);
    expect(state.url).toBe('');
    expect(state.title).toBe('');
    expect(state.active).toBe(true);
    expect(state.requestCount).toBe(0);
  });

  it('should track activity via touch()', () => {
    const strategy = new HTTPStrategy();
    const session = new BrowserSession(strategy);

    const before = session.state.lastActivityAt;
    // Small delay to ensure timestamp difference
    session.touch();
    const after = session.state.lastActivityAt;

    expect(session.state.requestCount).toBe(1);
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('should report not expired for fresh session', () => {
    const strategy = new HTTPStrategy();
    const session = new BrowserSession(strategy);
    expect(session.isExpired).toBe(false);
    expect(session.isActive).toBe(true);
  });

  it('should expose the underlying strategy', () => {
    const strategy = new HTTPStrategy();
    const session = new BrowserSession(strategy);
    expect(session.browserStrategy).toBe(strategy);
  });

  it('should accept custom config', () => {
    const strategy = new HTTPStrategy();
    const session = new BrowserSession(strategy, {
      workspaceId: 'ws-123',
      idleTimeoutMs: 60_000,
      cookies: { session: 'abc' },
    });

    expect(session.state).toBeDefined();
  });

  it('should close and mark inactive', async () => {
    const strategy = new HTTPStrategy();
    const session = new BrowserSession(strategy);
    await session.close();
    expect(session.isActive).toBe(false);
    expect(session.state.active).toBe(false);
  });

  it('should pass health check for fresh session', async () => {
    const strategy = new HTTPStrategy();
    const session = new BrowserSession(strategy);
    const result = await session.healthCheck();
    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should create sessions with different IDs', () => {
    const strategy1 = new HTTPStrategy();
    const strategy2 = new HTTPStrategy();
    const session1 = new BrowserSession(strategy1);
    const session2 = new BrowserSession(strategy2);

    expect(session1.sessionId).not.toBe(session2.sessionId);
  });
});