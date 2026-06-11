/**
 * @agentos/resources — Token Bucket Rate Limiter
 * Implements token bucket algorithm for burst and steady-state rate limiting.
 */

export interface TokenBucketConfig {
  /** Maximum tokens the bucket can hold */
  capacity: number;
  /** Tokens added per refill interval */
  refillRate: number;
  /** Refill interval in milliseconds */
  refillIntervalMs: number;
}

export class TokenBucket {
  private tokens: number;
  private lastRefillTime: number;
  private readonly capacity: number;
  private readonly refillRate: number;
  private readonly refillIntervalMs: number;

  constructor(config: TokenBucketConfig) {
    this.capacity = config.capacity;
    this.refillRate = config.refillRate;
    this.refillIntervalMs = config.refillIntervalMs;
    this.tokens = config.capacity; // Start full
    this.lastRefillTime = Date.now();
  }

  /** Try to consume n tokens. Returns true if successful, false if insufficient. */
  tryConsume(n: number): boolean {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  /** Try to consume n tokens, waiting if needed. Returns wait time in ms, or -1 if impossible. */
  tryConsumeOrWait(n: number): number {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return 0;
    }
    if (this.refillRate <= 0) return -1;
    const deficit = n - this.tokens;
    const tokensPerMs = this.refillRate / this.refillIntervalMs;
    const waitMs = Math.ceil(deficit / tokensPerMs);
    return waitMs;
  }

  /** Get current token count (after refill) */
  available(): number {
    this.refill();
    return this.tokens;
  }

  /** Force-add tokens (for burst credits, etc.) */
  addTokens(n: number): void {
    this.refill();
    this.tokens = Math.min(this.capacity, this.tokens + n);
  }

  /** Reset bucket to full capacity */
  reset(): void {
    this.tokens = this.capacity;
    this.lastRefillTime = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillTime;
    if (elapsed >= this.refillIntervalMs) {
      const intervals = Math.floor(elapsed / this.refillIntervalMs);
      const added = intervals * this.refillRate;
      this.tokens = Math.min(this.capacity, this.tokens + added);
      this.lastRefillTime = now - (elapsed % this.refillIntervalMs);
    }
  }
}