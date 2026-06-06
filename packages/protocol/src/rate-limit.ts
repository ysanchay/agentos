/**
 * TokenBucketRateLimiter + SlidingWindowRateLimiter
 * Two rate limiting strategies for ACP message throughput control.
 */

import { ok, err } from '@agentos/types';
import type { Outcome } from '@agentos/types';

/**
 * Token Bucket Rate Limiter
 * Allows burst traffic up to bucket capacity, then refills at a steady rate.
 */
export class TokenBucketRateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRatePerMs: number;
  private lastRefillTime: number;

  constructor(opts: { maxTokens: number; refillRatePerMs: number; initialTokens?: number }) {
    this.maxTokens = opts.maxTokens;
    this.refillRatePerMs = opts.refillRatePerMs;
    this.tokens = opts.initialTokens ?? opts.maxTokens;
    this.lastRefillTime = Date.now();
  }

  /**
   * Try to consume one token. Returns true if allowed, false if rate limited.
   */
  tryConsume(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /**
   * Try to consume N tokens. Returns true if allowed, false if rate limited.
   */
  tryConsumeN(count: number): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  /**
   * Check if a request would be allowed without actually consuming.
   */
  peek(): boolean {
    this.refill();
    return this.tokens >= 1;
  }

  /**
   * Get the current number of available tokens.
   */
  availableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Get the time in ms until the next token is available.
   */
  waitTimeMs(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil(1 / this.refillRatePerMs);
  }

  /**
   * Reset the bucket to full capacity.
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefillTime = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    const tokensToAdd = elapsed * this.refillRatePerMs;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefillTime = now;
  }
}

/**
 * Sliding Window Rate Limiter
 * Tracks requests within a time window that slides forward with each request.
 */
export class SlidingWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private timestamps: number[] = [];

  constructor(opts: { maxRequests: number; windowMs: number }) {
    this.maxRequests = opts.maxRequests;
    this.windowMs = opts.windowMs;
  }

  /**
   * Try to make a request. Returns Outcome with retry_after_ms if rate limited.
   */
  tryAcquire(): Outcome<true> {
    const now = Date.now();
    this.pruneOlder(now);

    if (this.timestamps.length < this.maxRequests) {
      this.timestamps.push(now);
      return ok(true);
    }

    // Calculate when the oldest request will expire
    const oldestInWindow = this.timestamps[0]!;
    const retryAfterMs = oldestInWindow + this.windowMs - now;

    return err('ACP-E009', 'Rate limit exceeded', {
      retryable: true,
      retry_after: Math.max(1, retryAfterMs),
    });
  }

  /**
   * Check if a request would be allowed without recording it.
   */
  peek(): boolean {
    const now = Date.now();
    this.pruneOlder(now);
    return this.timestamps.length < this.maxRequests;
  }

  /**
   * Get the number of requests remaining in the current window.
   */
  remaining(): number {
    const now = Date.now();
    this.pruneOlder(now);
    return Math.max(0, this.maxRequests - this.timestamps.length);
  }

  /**
   * Get the time in ms until the next slot opens up.
   */
  waitTimeMs(): number {
    const now = Date.now();
    this.pruneOlder(now);
    if (this.timestamps.length < this.maxRequests) return 0;
    const oldestInWindow = this.timestamps[0]!;
    return Math.max(0, oldestInWindow + this.windowMs - now);
  }

  /**
   * Reset the limiter, clearing all tracked requests.
   */
  reset(): void {
    this.timestamps = [];
  }

  /**
   * Get the current count of requests in the window.
   */
  currentCount(): number {
    this.pruneOlder(Date.now());
    return this.timestamps.length;
  }

  private pruneOlder(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift();
    }
  }
}

/**
 * Per-agent rate limiter that maintains separate limiters for each agent.
 */
export class PerAgentRateLimiter {
  private limiters = new Map<string, SlidingWindowRateLimiter>();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(opts: { maxRequests: number; windowMs: number }) {
    this.maxRequests = opts.maxRequests;
    this.windowMs = opts.windowMs;
  }

  /**
   * Try to acquire a slot for a specific agent.
   */
  tryAcquire(agentId: string): Outcome<true> {
    let limiter = this.limiters.get(agentId);
    if (!limiter) {
      limiter = new SlidingWindowRateLimiter({
        maxRequests: this.maxRequests,
        windowMs: this.windowMs,
      });
      this.limiters.set(agentId, limiter);
    }
    return limiter.tryAcquire();
  }

  /**
   * Get the remaining request count for a specific agent.
   */
  remaining(agentId: string): number {
    const limiter = this.limiters.get(agentId);
    if (!limiter) return this.maxRequests;
    return limiter.remaining();
  }

  /**
   * Reset the rate limiter for a specific agent.
   */
  resetAgent(agentId: string): void {
    this.limiters.delete(agentId);
  }

  /**
   * Reset all agent rate limiters.
   */
  resetAll(): void {
    this.limiters.clear();
  }
}