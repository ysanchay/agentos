/**
 * @agentos/desktop — Desktop Session
 * Manages a single desktop session: window tracking, activity tracking, idle timeout.
 */

import type { IDesktopStrategy, DesktopSessionConfig, DesktopSessionState } from './types.js';
import { createUUID } from '@agentos/types';

export class DesktopSession {
  readonly sessionId: string;
  private strategy: IDesktopStrategy;
  private config: Required<DesktopSessionConfig>;
  private _createdAt: number;
  private _lastActivityAt: number;
  private _requestCount = 0;
  private _active = true;

  constructor(strategy: IDesktopStrategy, config?: DesktopSessionConfig) {
    this.sessionId = createUUID();
    this.strategy = strategy;
    this.config = {
      idleTimeoutMs: config?.idleTimeoutMs ?? 300_000,
      workspaceId: config?.workspaceId ?? 'default',
      initialWindowId: config?.initialWindowId ?? '',
    };
    this._createdAt = Date.now();
    this._lastActivityAt = this._createdAt;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  get state(): DesktopSessionState {
    return {
      sessionId: this.sessionId,
      currentWindowId: this.strategy.currentWindow()?.windowId ?? null,
      createdAt: this._createdAt,
      lastActivityAt: this._lastActivityAt,
      requestCount: this._requestCount,
      active: this._active,
    };
  }

  get isExpired(): boolean {
    return Date.now() - this._lastActivityAt > this.config.idleTimeoutMs;
  }

  get isActive(): boolean {
    return this._active && !this.isExpired;
  }

  /** Get the underlying strategy for direct capability handler use */
  get desktopStrategy(): IDesktopStrategy {
    return this.strategy;
  }

  /** Record activity (called on every capability invocation) */
  touch(): void {
    this._lastActivityAt = Date.now();
    this._requestCount++;
  }

  /** Initialize session (optionally focus initial window) */
  async initialize(): Promise<void> {
    if (this.config.initialWindowId) {
      try {
        await this.strategy.focus({ windowId: this.config.initialWindowId });
      } catch {
        // Best-effort — window may not exist
      }
      this.touch();
    }
  }

  /** Close the session and release resources */
  async close(): Promise<void> {
    this._active = false;
    await this.strategy.close();
  }

  /** Check health of underlying strategy */
  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const window = this.strategy.currentWindow();
      return { healthy: window !== null || this._requestCount === 0, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }
}