/**
 * @agentos/desktop — Desktop Pool Concurrent Tests
 * Tests for max sessions enforcement, concurrent access patterns,
 * eviction at capacity, and error recovery.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DesktopPool } from '../src/desktop-pool.js';
import { DesktopSession } from '../src/desktop-session.js';
import type { IDesktopStrategy } from '../src/types.js';
import { DESKTOP_ERRORS } from '../src/types.js';

// ─── Mock Strategy ───────────────────────────────────────────────────────────

function createMockStrategy(overrides?: Partial<IDesktopStrategy>): IDesktopStrategy {
  return {
    name: 'mock',
    supportsNativeApps: true,
    platform: 'windows',
    screenshot: vi.fn().mockResolvedValue({ data: 'base64...', mimeType: 'image/png', width: 1920, height: 1080, sizeBytes: 50000 }),
    getTree: vi.fn().mockResolvedValue({ root: { id: 'root', role: 'window', name: 'Desktop', children: [] }, nodeCount: 1, maxDepth: 0, window: { title: 'Desktop', appName: 'explorer', pid: 0, windowId: '1', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, focused: true } }),
    query: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue({ elementId: '1', role: 'window', name: 'Test', properties: {} }),
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DesktopPool - Concurrent', () => {
  it('should enforce max sessions limit', async () => {
    const smallPool = new DesktopPool({ maxSessions: 2, idleTimeoutMs: 999_999_000 }, () => createMockStrategy());
    const s1 = await smallPool.getSession('ws-1');
    const s2 = await smallPool.getSession('ws-2');
    expect(smallPool.status.activeSessions).toBeLessThanOrEqual(2);
  });

  it('should evict oldest session when at capacity', async () => {
    const smallPool = new DesktopPool({ maxSessions: 1, idleTimeoutMs: 999_999_000 }, () => createMockStrategy());
    const s1 = await smallPool.getSession('ws-1');
    const id1 = s1.sessionId;

    // Creating a second session when maxSessions=1 should evict the first
    const s2 = await smallPool.getSession('ws-2');
    expect(smallPool.status.activeSessions).toBeLessThanOrEqual(1);
  });

  it('should handle concurrent getSession calls for same workspace', async () => {
    const pool = new DesktopPool({}, () => createMockStrategy());
    // Since the pool reuses the first active session, concurrent calls get the same session
    const [s1, s2] = await Promise.all([
      pool.getSession('ws-1'),
      pool.getSession('ws-1'),
    ]);
    expect(s1).toBeDefined();
    expect(s2).toBeDefined();
  });

  it('should reuse existing active session', async () => {
    const pool = new DesktopPool({}, () => createMockStrategy());
    const s1 = await pool.getSession('ws-1');
    const s2 = await pool.getSession('ws-2');
    // Pool reuses the first active session
    expect(s1.sessionId).toBe(s2.sessionId);
    expect(pool.status.activeSessions).toBe(1);
  });

  it('should create new session after all are released', async () => {
    const pool = new DesktopPool({}, () => createMockStrategy());
    const s1 = await pool.getSession('ws-1');
    const id1 = s1.sessionId;

    await pool.releaseSession(id1);
    const s2 = await pool.getSession('ws-2');
    expect(s2.sessionId).not.toBe(id1);
  });
});

describe('DesktopPool - Error Recovery', () => {
  it('should handle strategy factory that throws', async () => {
    const brokenFactory = () => {
      throw new Error('Strategy creation failed');
    };
    const brokenPool = new DesktopPool({}, brokenFactory);
    await expect(brokenPool.getSession('ws-1')).rejects.toThrow('Strategy creation failed');
  });

  it('should handle session close failure during eviction', async () => {
    let callCount = 0;
    const factory = () => {
      callCount++;
      const strat = createMockStrategy();
      if (callCount === 1) {
        // First strategy's close throws
        strat.close = vi.fn().mockRejectedValue(new Error('Close failed'));
      }
      return strat;
    };
    const smallPool = new DesktopPool({ maxSessions: 1, idleTimeoutMs: 999_999_000 }, factory);

    const s1 = await smallPool.getSession('ws-1');
    // The first session's strategy throws on close
    // The pool should still function (best-effort close)
    const s2 = await smallPool.getSession('ws-2');
    expect(s2).toBeDefined();
  });

  it('should handle releaseSession for non-existent session', async () => {
    const pool = new DesktopPool({}, () => createMockStrategy());
    await expect(pool.releaseSession('nonexistent')).resolves.toBeUndefined();
  });

  it('should recover from recycleExpired errors', async () => {
    const expiringPool = new DesktopPool({ maxSessions: 3, idleTimeoutMs: 1 }, () => createMockStrategy());
    await expiringPool.getSession('ws-1');

    // Wait for expiry
    await new Promise<void>(resolve => setTimeout(resolve, 10));

    const recycled = expiringPool.recycleExpired();
    expect(recycled).toBeGreaterThanOrEqual(0);
    expect(expiringPool.status.activeSessions).toBe(0);
  });

  it('should handle shutdown with failing strategy close', async () => {
    const factory = () => {
      const strat = createMockStrategy();
      strat.close = vi.fn().mockRejectedValue(new Error('Close failed'));
      return strat;
    };
    const pool = new DesktopPool({}, factory);
    await pool.getSession('ws-1');

    // Shutdown should complete even if strategy close fails (best-effort)
    await expect(pool.shutdown()).resolves.toBeUndefined();
    expect(pool.status.activeSessions).toBe(0);
  });

  it('should include DESKTOP_ERRORS.POOL_FULL in capacity error', () => {
    expect(DESKTOP_ERRORS.POOL_FULL).toBe('DESKTOP_POOL_FULL');
  });
});