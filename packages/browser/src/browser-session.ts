/**
 * @agentos/browser — Browser Session
 * Manages a single browser session: URL state, cookies, response cache.
 * Sessions are workspace-scoped and recycled after idle timeout.
 */

import type { IBrowserStrategy, BrowserSessionConfig, BrowserSessionState } from './types.js';
import { createUUID } from '@agentos/types';

export class BrowserSession {
  readonly sessionId: string;
  private strategy: IBrowserStrategy;
  private config: Required<BrowserSessionConfig>;
  private _createdAt: number;
  private _lastActivityAt: number;
  private _requestCount = 0;
  private _active = true;
  /** Serialized storage state (localStorage, sessionStorage) from authentication flows */
  private _storageState?: string;
  /** Cookies from authentication flows */
  private _authCookies: Record<string, string> = {};

  constructor(strategy: IBrowserStrategy, config?: BrowserSessionConfig) {
    this.sessionId = createUUID();
    this.strategy = strategy;
    this.config = {
      idleTimeoutMs: config?.idleTimeoutMs ?? 300_000,
      workspaceId: config?.workspaceId ?? 'default',
      initialUrl: config?.initialUrl ?? '',
      cookies: config?.cookies ?? {},
    };
    this._createdAt = Date.now();
    this._lastActivityAt = this._createdAt;
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  get state(): BrowserSessionState {
    return {
      sessionId: this.sessionId,
      url: this.strategy.currentUrl(),
      title: this.strategy.currentTitle(),
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
  get browserStrategy(): IBrowserStrategy {
    return this.strategy;
  }

  /** Record activity (called on every capability invocation) */
  touch(): void {
    this._lastActivityAt = Date.now();
    this._requestCount++;
  }

  /** Navigate to initial URL if configured */
  async initialize(): Promise<void> {
    if (this.config.initialUrl) {
      await this.strategy.goto(this.config.initialUrl);
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
      // Simple check: can we still get the current URL?
      const url = this.strategy.currentUrl();
      return { healthy: !!url || this._requestCount === 0, latencyMs: Date.now() - start };
    } catch {
      return { healthy: false, latencyMs: Date.now() - start };
    }
  }

  // ─── Auth State Management ─────────────────────────────────────────────

  /** Get the stored authentication cookies */
  get authCookies(): Record<string, string> {
    return this._authCookies;
  }

  /** Set authentication cookies (from a login flow) */
  setAuthCookies(cookies: Record<string, string>): void {
    this._authCookies = { ...this._authCookies, ...cookies };
  }

  /** Get the stored browser storage state */
  get storageState(): string | undefined {
    return this._storageState;
  }

  /** Set the browser storage state (from a login flow) */
  setStorageState(state: string): void {
    this._storageState = state;
  }

  /** Whether this session has authentication state */
  get hasAuthState(): boolean {
    return Object.keys(this._authCookies).length > 0 || this._storageState !== undefined;
  }

  /** Clear authentication state */
  clearAuthState(): void {
    this._authCookies = {};
    this._storageState = undefined;
  }
}