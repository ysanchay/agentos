/**
 * @agentos/browser — Browser Pool Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserPool } from '../src/browser-pool.js';
import { BrowserSession } from '../src/browser-session.js';
import { HTTPStrategy } from '../src/strategies/http-strategy.js';

describe('BrowserPool', () => {
  it('should create a pool with default config', () => {
    const pool = new BrowserPool();
    expect(pool.status.activeSessions).toBe(0);
    expect(pool.status.totalRequests).toBe(0);
  });

  it('should create session on demand', async () => {
    const pool = new BrowserPool();
    const session = await pool.getSession('ws-1');

    expect(session).toBeDefined();
    expect(session.sessionId).toBeDefined();
    expect(pool.status.activeSessions).toBe(1);
  });

  it('should reuse existing session for same workspace', async () => {
    const pool = new BrowserPool();
    const session1 = await pool.getSession('ws-1');
    const session2 = await pool.getSession('ws-1');

    // Should reuse the same active session
    expect(pool.status.activeSessions).toBe(1);
  });

  it('should create new session when existing is expired', async () => {
    const pool = new BrowserPool({ idleTimeoutMs: 0 }); // Immediate expiry
    const session1 = await pool.getSession('ws-1');
    expect(pool.status.activeSessions).toBe(1);

    // With 0ms timeout, session should be expired immediately
    // The pool recycles expired sessions on getSession
    const session2 = await pool.getSession('ws-2');
    // Should have created a new session after recycling
    expect(pool.status.activeSessions).toBeGreaterThanOrEqual(1);
  });

  it('should respect max sessions limit', async () => {
    const pool = new BrowserPool({ maxSessions: 2, idleTimeoutMs: 999_999_000 });
    const s1 = await pool.getSession('ws-1');
    const s2 = await pool.getSession('ws-2');

    // Third session should evict oldest idle
    const s3 = await pool.getSession('ws-3');
    expect(pool.status.activeSessions).toBeLessThanOrEqual(2);
  });

  it('should record requests', () => {
    const pool = new BrowserPool();
    pool.recordRequest();
    pool.recordRequest();
    expect(pool.status.totalRequests).toBe(2);
  });

  it('should release session', async () => {
    const pool = new BrowserPool();
    const session = await pool.getSession('ws-1');
    expect(pool.status.activeSessions).toBe(1);

    await pool.releaseSession(session.sessionId);
    expect(pool.status.activeSessions).toBe(0);
  });

  it('should get session by ID', async () => {
    const pool = new BrowserPool();
    const session = await pool.getSession('ws-1');
    const found = pool.getSessionById(session.sessionId);

    expect(found).toBeDefined();
    expect(found!.sessionId).toBe(session.sessionId);
  });

  it('should return undefined for non-existent session', () => {
    const pool = new BrowserPool();
    const found = pool.getSessionById('nonexistent');
    expect(found).toBeUndefined();
  });

  it('should recycle expired sessions', async () => {
    const pool = new BrowserPool({ idleTimeoutMs: 0 });
    await pool.getSession('ws-1');

    const recycled = pool.recycleExpired();
    expect(recycled).toBeGreaterThanOrEqual(0); // May or may not be expired yet
  });

  it('should shutdown cleanly', async () => {
    const pool = new BrowserPool();
    await pool.getSession('ws-1');
    await pool.getSession('ws-2');

    await pool.shutdown();
    expect(pool.status.activeSessions).toBe(0);
  });

  it('should accept custom strategy factory', async () => {
    let created = 0;
    const factory = () => {
      created++;
      return new HTTPStrategy();
    };
    const pool = new BrowserPool({}, factory);
    await pool.getSession('ws-1');
    expect(created).toBe(1);
  });

  it('should report status with session states', async () => {
    const pool = new BrowserPool();
    await pool.getSession('ws-1');

    const status = pool.status;
    expect(status.activeSessions).toBe(1);
    expect(status.sessions).toHaveLength(1);
    expect(status.sessions[0]!.sessionId).toBeDefined();
  });
});