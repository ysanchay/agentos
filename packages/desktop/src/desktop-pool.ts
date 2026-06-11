/**
 * @agentos/desktop — Desktop Pool
 * Manages a pool of desktop sessions with resource limits.
 * Sessions are recycled after idle timeout.
 */

import type { IDesktopStrategy, DesktopPoolConfig, DesktopSessionConfig, DesktopSessionState } from './types.js';
import { DESKTOP_ERRORS } from './types.js';
import { DesktopSession } from './desktop-session.js';
import { NativeStrategy } from './strategies/native-strategy.js';

export class DesktopPool {
  private config: Required<DesktopPoolConfig>;
  private sessions = new Map<string, DesktopSession>();
  private strategyFactory: () => IDesktopStrategy;
  private _totalRequests = 0;

  constructor(config?: DesktopPoolConfig, strategyFactory?: () => IDesktopStrategy) {
    this.config = {
      maxSessions: config?.maxSessions ?? 3, // Desktop is more resource-intensive
      idleTimeoutMs: config?.idleTimeoutMs ?? 300_000,
      maxTotalRequests: config?.maxTotalRequests ?? 500,
      strategyType: config?.strategyType ?? 'native',
    };

    this.strategyFactory = strategyFactory ?? (() => this.createDefaultStrategy());
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /** Get or create a session for the given workspace */
  async getSession(workspaceId: string, sessionConfig?: DesktopSessionConfig): Promise<DesktopSession> {
    // Try to find an existing active session
    for (const session of this.sessions.values()) {
      if (session.isActive) {
        session.touch();
        return session;
      }
    }

    // Recycle expired sessions
    this.recycleExpired();

    // Check capacity
    if (this.sessions.size >= this.config.maxSessions) {
      const oldest = this.findOldestSession();
      if (oldest) {
        await oldest.close();
        this.sessions.delete(oldest.sessionId);
      } else {
        throw new Error(`${DESKTOP_ERRORS.POOL_FULL}: Maximum ${this.config.maxSessions} concurrent desktop sessions reached`);
      }
    }

    // Create new session
    const strategy = this.strategyFactory();
    const session = new DesktopSession(strategy, {
      ...sessionConfig,
      workspaceId,
      idleTimeoutMs: this.config.idleTimeoutMs,
    });

    await session.initialize();
    this.sessions.set(session.sessionId, session);
    return session;
  }

  /** Get a session by ID */
  getSessionById(sessionId: string): DesktopSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session && session.isActive) {
      session.touch();
      return session;
    }
    return undefined;
  }

  /** Release a session */
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
    sessions: DesktopSessionState[];
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

  private createDefaultStrategy(): IDesktopStrategy {
    return new NativeStrategy();
  }

  /** Find the least recently used session for eviction */
  private findOldestSession(): DesktopSession | undefined {
    let oldest: DesktopSession | undefined;
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