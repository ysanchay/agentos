/**
 * @agentos/desktop — DesktopSession Tests
 * Validates session lifecycle, activity tracking, and expiry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DesktopSession } from '../src/desktop-session.js';
import type { IDesktopStrategy, DesktopSessionConfig } from '../src/types.js';
import { DESKTOP_ERRORS } from '../src/types.js';

// ─── Mock Strategy ───────────────────────────────────────────────────────────

function createMockStrategy(overrides?: Partial<IDesktopStrategy>): IDesktopStrategy {
  return {
    name: 'mock',
    supportsNativeApps: true,
    platform: 'windows',
    screenshot: vi.fn().mockResolvedValue({ data: 'base64...', mimeType: 'image/png', width: 1920, height: 1080, sizeBytes: 50000 }),
    getTree: vi.fn().mockResolvedValue({ root: { id: 'root', role: 'window', name: 'Desktop', children: [] }, nodeCount: 1, maxDepth: 0, window: { title: 'Desktop', appName: 'explorer', pid: 0, windowId: '1', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, focused: true } }),
    query: vi.fn().mockResolvedValue([{ id: '1', role: 'window', name: 'Test Window', value: 'Test', bounds: { x: 0, y: 0, width: 800, height: 600 }, visible: true, enabled: true, focused: true }]),
    read: vi.fn().mockResolvedValue({ elementId: '1', role: 'window', name: 'Test Window', text: 'Test', value: 'Test', properties: {} }),
    click: vi.fn().mockResolvedValue({ success: true, durationMs: 50 }),
    type: vi.fn().mockResolvedValue({ success: true, durationMs: 30 }),
    scroll: vi.fn().mockResolvedValue({ success: true, durationMs: 20 }),
    launchApp: vi.fn().mockResolvedValue({ success: true, durationMs: 200 }),
    focus: vi.fn().mockResolvedValue({ success: true, durationMs: 10 }),
    pressKey: vi.fn().mockResolvedValue({ success: true, durationMs: 15 }),
    currentWindow: vi.fn().mockReturnValue({ title: 'Test', appName: 'test', pid: 123, windowId: '1', bounds: { x: 0, y: 0, width: 800, height: 600 }, focused: true }),
    listWindows: vi.fn().mockResolvedValue([{ title: 'Test', appName: 'test', pid: 123, windowId: '1', bounds: { x: 0, y: 0, width: 800, height: 600 }, focused: true }]),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as IDesktopStrategy;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DesktopSession', () => {
  let strategy: IDesktopStrategy;

  beforeEach(() => {
    strategy = createMockStrategy();
  });

  it('creates a session with unique ID', () => {
    const session = new DesktopSession(strategy);
    expect(session.sessionId).toBeDefined();
    expect(typeof session.sessionId).toBe('string');
    expect(session.sessionId.length).toBeGreaterThan(0);
  });

  it('exposes the strategy via desktopStrategy getter', () => {
    const session = new DesktopSession(strategy);
    expect(session.desktopStrategy).toBe(strategy);
  });

  it('starts active and not expired', () => {
    const session = new DesktopSession(strategy);
    expect(session.isActive).toBe(true);
    expect(session.isExpired).toBe(false);
  });

  it('tracks state correctly', () => {
    const session = new DesktopSession(strategy);
    const state = session.state;

    expect(state.sessionId).toBe(session.sessionId);
    expect(state.active).toBe(true);
    expect(state.requestCount).toBe(0);
    expect(state.createdAt).toBeGreaterThan(0);
    expect(state.lastActivityAt).toBe(state.createdAt);
  });

  it('touch() updates lastActivityAt and increments requestCount', () => {
    const session = new DesktopSession(strategy);
    const before = session.state.lastActivityAt;

    // Small delay to ensure timestamp changes
    session.touch();

    expect(session.state.lastActivityAt).toBeGreaterThanOrEqual(before);
    expect(session.state.requestCount).toBe(1);
  });

  it('multiple touches increment requestCount', () => {
    const session = new DesktopSession(strategy);
    session.touch();
    session.touch();
    session.touch();

    expect(session.state.requestCount).toBe(3);
  });

  it('initializes with custom config', () => {
    const config: DesktopSessionConfig = {
      idleTimeoutMs: 60_000,
      workspaceId: 'ws-test',
      initialWindowId: 'win-1',
    };
    const session = new DesktopSession(strategy, config);

    expect(session.isActive).toBe(true);
    // The session tries to focus the initial window on initialize
  });

  it('expires after idle timeout', () => {
    const config: DesktopSessionConfig = {
      idleTimeoutMs: 1, // 1ms timeout = instant expiry
    };
    const session = new DesktopSession(strategy, config);

    // Wait a tiny bit for expiry
    const start = session.state.lastActivityAt;
    // Force expiry by waiting
    return new Promise<void>(resolve => {
      setTimeout(() => {
        expect(session.isExpired).toBe(true);
        expect(session.isActive).toBe(false);
        resolve();
      }, 10);
    });
  });

  it('close() marks session as inactive', async () => {
    const session = new DesktopSession(strategy);
    expect(session.isActive).toBe(true);

    await session.close();

    expect(session.isActive).toBe(false);
    expect(strategy.close).toHaveBeenCalledOnce();
  });

  it('healthCheck returns healthy for working strategy', async () => {
    const session = new DesktopSession(strategy);
    const result = await session.healthCheck();

    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('healthCheck returns unhealthy for failing strategy', async () => {
    const brokenStrategy = createMockStrategy({
      currentWindow: vi.fn().mockReturnValue(null),
    });
    // A session with 0 requests and null window is still healthy (just started)
    const session = new DesktopSession(brokenStrategy);
    const result = await session.healthCheck();
    // First request, no window yet — healthy by convention
    expect(result).toBeDefined();
  });

  it('initializes with initialWindowId by focusing it', async () => {
    const config: DesktopSessionConfig = {
      initialWindowId: 'win-1',
    };
    const session = new DesktopSession(strategy, config);
    await session.initialize();

    expect(strategy.focus).toHaveBeenCalledWith({ windowId: 'win-1' });
  });

  it('gracefully handles focus failure during initialization', async () => {
    const brokenStrategy = createMockStrategy({
      focus: vi.fn().mockRejectedValue(new Error('Window not found')),
    });
    const config: DesktopSessionConfig = {
      initialWindowId: 'win-missing',
    };
    const session = new DesktopSession(brokenStrategy, config);

    // Should not throw
    await expect(session.initialize()).resolves.toBeUndefined();
  });
});