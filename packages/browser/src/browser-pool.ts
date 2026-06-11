/**
 * @agentos/browser — Browser Pool
 * Manages a pool of browser sessions with resource limits.
 * Sessions are recycled after idle timeout.
 */

import type { IBrowserStrategy, BrowserPoolConfig, BrowserSessionConfig, BrowserSessionState } from './types.js';
import { BROWSER_ERRORS } from './types.js';
import { BrowserSession } from './browser-session.js';
import { HTTPStrategy } from './strategies/http-strategy.js';

export class BrowserPool {
  private config: Required<BrowserPoolConfig>;
  private sessions = new Map<string, BrowserSession>();
  private strategyFactory: () => IBrowserStrategy;
  private _totalRequests = 0;

  constructor(config?: BrowserPoolConfig, strategyFactory?: () => IBrowserStrategy) {
    this.config = {
      maxSessions: config?.maxSessions ?? 5,
      idleTimeoutMs: config?.idleTimeoutMs ?? 300_000,
      maxTotalRequests: config?.maxTotalRequests ?? 1000,
      strategyType: config?.strategyType ?? 'http',
    };

    this.strategyFactory = strategyFactory ?? (() => this.createDefaultStrategy());
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /** Get or create a session for the given workspace */
  async getSession(workspaceId: string, sessionConfig?: BrowserSessionConfig): Promise<BrowserSession> {
    // Try to find an existing active session for this workspace
    for (const session of this.sessions.values()) {
      if (session.isActive) {
        const sessionWorkspace = session.state.sessionId; // TODO: track workspace in session state
        // Reuse existing active session
        session.touch();
        return session;
      }
    }

    // Recycle expired sessions
    this.recycleExpired();

    // Check capacity
    if (this.sessions.size >= this.config.maxSessions) {
      // Evict the oldest (least recently used) session
      const oldest = this.findOldestSession();
      if (oldest) {
        await oldest.close();
        this.sessions.delete(oldest.sessionId);
      } else {
        throw new Error(`${BROWSER_ERRORS.POOL_FULL}: Maximum ${this.config.maxSessions} concurrent browser sessions reached`);
      }
    }

    // Create new session
    const strategy = this.strategyFactory();
    const session = new BrowserSession(strategy, {
      ...sessionConfig,
      workspaceId,
      idleTimeoutMs: this.config.idleTimeoutMs,
    });

    await session.initialize();
    this.sessions.set(session.sessionId, session);
    return session;
  }

  /** Get a session by ID */
  getSessionById(sessionId: string): BrowserSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session && session.isActive) {
      session.touch();
      return session;
    }
    return undefined;
  }

  /** Release a session (mark for potential recycling) */
  async releaseSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.close();
      this.sessions.delete(sessionId);
    }
  }

  /** Get pool status */
  get status(): {
    activeSessions: number;
    totalRequests: number;
    sessions: BrowserSessionState[];
  } {
    return {
      activeSessions: this.sessions.size,
      totalRequests: this._totalRequests,
      sessions: Array.from(this.sessions.values()).map(s => s.state),
    };
  }

  /** Record a request */
  recordRequest(): void {
    this._totalRequests++;
  }

  /** Recycle all expired sessions */
  recycleExpired(): number {
    let recycled = 0;
    for (const [id, session] of this.sessions) {
      if (session.isExpired || !session.isActive) {
        session.close().catch(() => {}); // Best-effort close
        this.sessions.delete(id);
        recycled++;
      }
    }
    return recycled;
  }

  /** Close all sessions and shut down the pool */
  async shutdown(): Promise<void> {
    const closePromises = Array.from(this.sessions.values()).map(s => s.close().catch(() => {}));
    await Promise.all(closePromises);
    this.sessions.clear();
  }

  // ─── Private Methods ────────────────────────────────────────────────────

  private createDefaultStrategy(): IBrowserStrategy {
    return new HTTPStrategy();
  }

  /** Find the least recently used session for eviction */
  private findOldestSession(): BrowserSession | undefined {
    let oldest: BrowserSession | undefined;
    let oldestTime = Infinity;

    for (const session of this.sessions.values()) {
      const lastActivity = session.state.lastActivityAt;
      if (lastActivity < oldestTime) {
        oldest = session;
        oldestTime = lastActivity;
      }
    }

    return oldest;
  }
}