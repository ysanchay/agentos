/**
 * Circuit Breaker: Closed -> Open -> Half-Open state machine
 * Prevents cascading failures by blocking requests when failure threshold is reached.
 */

import { CIRCUIT_BREAKER_TRIGGER_COUNT, CIRCUIT_BREAKER_PAUSE_MS } from '@agentos/types';
import { ok, err } from '@agentos/types';
import type { Outcome } from '@agentos/types';
import { circuitBreakerOpen } from './errors.js';

export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOpts {
  /** Number of failures before opening the circuit (default: 5) */
  triggerCount?: number;
  /** Time in ms to wait before transitioning to half-open (default: 60000) */
  pauseMs?: number;
  /** Number of successful requests in half-open to close the circuit (default: 3) */
  halfOpenSuccessCount?: number;
}

export interface CircuitBreakerStatus {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  lastFailureAt?: string;
  lastStateChange: string;
  openedAt?: string;
}

/**
 * Circuit Breaker implements the classic three-state pattern:
 *
 * CLOSED (normal) -> failures accumulate -> OPEN (blocking)
 * OPEN (blocking) -> timeout expires -> HALF-OPEN (testing)
 * HALF-OPEN (testing) -> success -> CLOSED | failure -> OPEN
 */
export class CircuitBreaker {
  private state: CircuitBreakerState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private halfOpenSuccesses = 0;
  private lastFailureAt?: string;
  private lastStateChange: string;
  private openedAt?: string;
  private readonly triggerCount: number;
  private readonly pauseMs: number;
  private readonly halfOpenSuccessCount: number;

  constructor(opts?: CircuitBreakerOpts) {
    this.triggerCount = opts?.triggerCount ?? CIRCUIT_BREAKER_TRIGGER_COUNT;
    this.pauseMs = opts?.pauseMs ?? CIRCUIT_BREAKER_PAUSE_MS;
    this.halfOpenSuccessCount = opts?.halfOpenSuccessCount ?? 3;
    this.lastStateChange = new Date().toISOString();
  }

  /**
   * Check if a request is allowed through the circuit breaker.
   * CLOSED: always allow
   * OPEN: allow only if pause period has expired (transitions to HALF-OPEN)
   * HALF-OPEN: allow limited requests for testing
   */
  allow(): Outcome<true> {
    if (this.state === 'closed') {
      return ok(true);
    }

    if (this.state === 'open') {
      const elapsed = Date.now() - new Date(this.openedAt!).getTime();
      if (elapsed >= this.pauseMs) {
        this.transitionTo('half-open');
        return ok(true);
      }
      return circuitBreakerOpen();
    }

    // half-open: allow a limited number of test requests
    if (this.halfOpenSuccesses < this.halfOpenSuccessCount) {
      return ok(true);
    }

    return circuitBreakerOpen();
  }

  /**
   * Record a successful request.
   * In HALF-OPEN, accumulating enough successes transitions back to CLOSED.
   */
  recordSuccess(): void {
    this.successCount++;

    if (this.state === 'half-open') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.halfOpenSuccessCount) {
        this.transitionTo('closed');
        this.failureCount = 0;
        this.halfOpenSuccesses = 0;
      }
    }
  }

  /**
   * Record a failed request.
   * In CLOSED, accumulating failures transitions to OPEN.
   * In HALF-OPEN, any failure transitions back to OPEN.
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureAt = new Date().toISOString();

    if (this.state === 'half-open') {
      this.transitionTo('open');
      this.halfOpenSuccesses = 0;
      return;
    }

    if (this.state === 'closed' && this.failureCount >= this.triggerCount) {
      this.transitionTo('open');
    }
  }

  /**
   * Execute a function through the circuit breaker.
   * Automatically records success/failure and returns the result.
   */
  async execute<T>(fn: () => Promise<T>): Promise<Outcome<T>> {
    const allowResult = this.allow();
    if (!allowResult.ok) {
      return allowResult as unknown as Outcome<T>;
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return ok(result);
    } catch (e) {
      this.recordFailure();
      const message = e instanceof Error ? e.message : 'Unknown error';
      return err('KER-0006', message);
    }
  }

  /**
   * Get the current state of the circuit breaker.
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Get detailed status information.
   */
  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureAt: this.lastFailureAt,
      lastStateChange: this.lastStateChange,
      openedAt: this.openedAt,
    };
  }

  /**
   * Reset the circuit breaker to CLOSED state.
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.halfOpenSuccesses = 0;
    this.lastFailureAt = undefined;
    this.openedAt = undefined;
    this.lastStateChange = new Date().toISOString();
  }

  /**
   * Force the circuit breaker to OPEN state.
   */
  trip(): void {
    this.transitionTo('open');
  }

  /**
   * Get the time remaining in ms before the circuit transitions from OPEN to HALF-OPEN.
   * Returns 0 if not in OPEN state.
   */
  timeUntilHalfOpen(): number {
    if (this.state !== 'open' || !this.openedAt) return 0;
    const elapsed = Date.now() - new Date(this.openedAt).getTime();
    return Math.max(0, this.pauseMs - elapsed);
  }

  private transitionTo(newState: CircuitBreakerState): void {
    if (this.state === newState) return;
    this.state = newState;
    this.lastStateChange = new Date().toISOString();

    if (newState === 'open') {
      this.openedAt = new Date().toISOString();
      this.halfOpenSuccesses = 0;
    }
  }
}