/**
 * Exponential Backoff with Jitter
 * Implements backoff strategy respecting max delay cap, with full jitter
 */

import { RPC_BACKOFF_BASE_MS, RPC_MAX_DELAY_MS, RPC_JITTER_MS } from '@agentos/types';

export interface BackoffOptions {
  /** Base delay in milliseconds */
  baseMs?: number;
  /** Maximum delay cap in milliseconds */
  maxDelayMs?: number;
  /** Jitter range in milliseconds (0 to jitterMs random offset added) */
  jitterMs?: number;
  /** Maximum number of retries */
  maxRetries?: number;
}

export interface BackoffState {
  attempt: number;
  nextDelayMs: number;
  exhausted: boolean;
}

/**
 * Calculate exponential backoff delay with jitter for a given attempt number.
 * Uses full jitter strategy: delay = min(base * 2^attempt, maxDelay) + random(0, jitter)
 */
export function calculateBackoff(attempt: number, opts?: BackoffOptions): number {
  const baseMs = opts?.baseMs ?? RPC_BACKOFF_BASE_MS;
  const maxDelayMs = opts?.maxDelayMs ?? RPC_MAX_DELAY_MS;
  const jitterMs = opts?.jitterMs ?? RPC_JITTER_MS;

  const exponentialDelay = baseMs * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  const jitter = Math.random() * jitterMs;
  return Math.floor(cappedDelay + jitter);
}

/**
 * Create a backoff iterator that yields increasing delays.
 * Returns a stateful object that tracks attempt count and exhaustion.
 */
export function createBackoffIterator(opts?: BackoffOptions): {
  next: () => BackoffState;
  reset: () => void;
  getAttempt: () => number;
} {
  const maxRetries = opts?.maxRetries ?? 3;
  let attempt = 0;

  return {
    next(): BackoffState {
      if (attempt >= maxRetries) {
        return { attempt, nextDelayMs: 0, exhausted: true };
      }
      const delay = calculateBackoff(attempt, opts);
      attempt++;
      return { attempt, nextDelayMs: delay, exhausted: attempt >= maxRetries };
    },
    reset(): void {
      attempt = 0;
    },
    getAttempt(): number {
      return attempt;
    },
  };
}

/**
 * Sleep helper that returns a promise resolving after the specified milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}