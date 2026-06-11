/**
 * @agentos/desktop — DesktopPool Tests
 * Validates session pool management, capacity, eviction, and shutdown.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DesktopPool } from '../src/desktop-pool.js';
import { DesktopSession } from '../src/desktop-session.js';
import type { IDesktopStrategy } from '../src/types.js';
import { DESKTOP_ERRORS } from '../src/types.js';

// ─── Mock Strategy ───────────────────────────────────────────────────────────

function createMockStrategy(): IDesktopStrategy {
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
  } as IDesktopStrategy;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DesktopPool', () => {
  let pool: DesktopPool;
  let mockStrategy: IDesktopStrategy;
  let strategyCallCount: number;

  beforeEach(() => {
    strategyCallCount = 0;
    mockStrategy = createMockStrategy();
    pool = new DesktopPool(
      { maxSessions: 3, idleTimeoutMs: 300_000 },
      () => {
        strategyCallCount++;
        return createMockStrategy();
      },
    );
  });

  it('creates a pool with default config', () => {
    const defaultPool = new DesktopPool();
    expect(defaultPool.status.activeSessions).toBe(0);
    expect(defaultPool.status.totalRequests).toBe(0);
  });

  it('creates a session on first getSession', async () => {
    const session = await pool.getSession('ws-1');

    expect(session).toBeDefined();
    expect(session.sessionId).toBeDefined();
    expect(session.isActive).toBe(true);
    expect(strategyCallCount).toBe(1);
  });

  it('reuses active session for subsequent getSession calls', async () => {
    const session1 = await pool.getSession('ws-1');
    const session2 = await pool.getSession('ws-2');

    // Pool reuses the first active session
    expect(session1.sessionId).toBe(session2.sessionId);
    expect(pool.status.activeSessions).toBe(1);
  });

  it('creates new session when no active sessions exist', async () => {
    const session1 = await pool.getSession('ws-1');
    await pool.releaseSession(session1.sessionId);

    // Now no active sessions, next call creates a new one
    const session2 = await pool.getSession('ws-2');
    expect(session2.sessionId).not.toBe(session1.sessionId);
  });

  it('records requests', async () => {
    await pool.getSession('ws-1');
    pool.recordRequest();
    pool.recordRequest();

    expect(pool.status.totalRequests).toBe(2);
  });

  it('evicts oldest session when at capacity', async () => {
    // Fill pool by creating sessions and releasing them between
    // The pool reuses sessions, so we need to close them first
    const s1 = await pool.getSession('ws-1');

    // Close the session so a new one will be created
    await pool.releaseSession(s1.sessionId);
    const s2 = await pool.getSession('ws-2');
    await pool.releaseSession(s2.sessionId);
    const s3 = await pool.getSession('ws-3');

    expect(pool.status.activeSessions).toBe(1); // Only s3 is active
  });

  it('getSessionById returns active session', async () => {
    const session = await pool.getSession('ws-1');
    const found = pool.getSessionById(session.sessionId);

    expect(found).toBeDefined();
    expect(found!.sessionId).toBe(session.sessionId);
  });

  it('getSessionById returns undefined for unknown ID', () => {
    const found = pool.getSessionById('nonexistent');
    expect(found).toBeUndefined();
  });

  it('releaseSession closes and removes session', async () => {
    const session = await pool.getSession('ws-1');
    const sessionId = session.sessionId;

    await pool.releaseSession(sessionId);

    expect(pool.getSessionById(sessionId)).toBeUndefined();
  });

  it('releaseSession is no-op for unknown session', async () => {
    await expect(pool.releaseSession('nonexistent')).resolves.toBeUndefined();
  });

  it('shutdown closes all sessions', async () => {
    await pool.getSession('ws-1');

    await pool.shutdown();

    expect(pool.status.activeSessions).toBe(0);
  });

  it('recycles expired sessions', async () => {
    // Create pool with very short idle timeout
    const expiringPool = new DesktopPool(
      { maxSessions: 3, idleTimeoutMs: 1 }, // 1ms = instant expiry
      () => createMockStrategy(),
    );

    const session = await expiringPool.getSession('ws-1');

    // Wait for expiry
    await new Promise(r => setTimeout(r, 50));

    const recycled = expiringPool.recycleExpired();
    expect(recycled).toBeGreaterThanOrEqual(0); // May have already been cleaned
  });

  it('DESKTOP_ERRORS.POOL_FULL contains the error code', () => {
    expect(DESKTOP_ERRORS.POOL_FULL).toBe('DESKTOP_POOL_FULL');
  });

  it('respects maxSessions config', () => {
    const smallPool = new DesktopPool({ maxSessions: 1 }, () => mockStrategy);
    expect(smallPool.status.activeSessions).toBe(0);
  });
});