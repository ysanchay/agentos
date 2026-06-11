/**
 * @agentos/resources — Throttle Engine
 * 4 throttle levels from resource-model-v1.md Section 5.
 *
 * Levels:
 * - mild: 50% rate reduction, 5 min
 * - moderate: 75% reduction, 15 min
 * - severe: 90% reduction, 1 hour
 * - critical: 95% reduction, until admin review
 * - Circuit breaker: reset throttle after 5min infrastructure downtime
 */

import type { Outcome, ISO8601 } from '@agentos/types';
import {
  ok, err, KER,
  THROTTLE_MILD, THROTTLE_MODERATE, THROTTLE_SEVERE, THROTTLE_CRITICAL,
  THROTTLE_MILD_DURATION_MS, THROTTLE_MODERATE_DURATION_MS, THROTTLE_SEVERE_DURATION_MS,
} from '@agentos/types';
import type { AllocationRecord } from './allocator.js';

// ─── Throttle Levels ─────────────────────────────────────────────────

export enum ThrottleLevel {
  NONE = 0,
  MILD = 1,
  MODERATE = 2,
  SEVERE = 3,
  CRITICAL = 4,
}

export interface ThrottleState {
  level: ThrottleLevel;
  rateMultiplier: number;  // 1.0 = full, 0.5 = mild, 0.25 = moderate, etc.
  startedAt: ISO8601;
  expiresAt?: ISO8601;     // undefined for CRITICAL (until admin review)
}

export interface ThrottleDecision {
  level: ThrottleLevel;
  rateMultiplier: number;
  durationMs: number;
  reason: string;
}

// Circuit breaker configuration
const CIRCUIT_BREAKER_DOWN_TIME_MS = 300_000; // 5 minutes infrastructure downtime

export class ThrottleEngine {
  /** Current throttle states by allocation ID */
  private throttleStates: Map<string, ThrottleState> = new Map();

  /** Infrastructure downtime tracker */
  private infrastructureDownSince: number | null = null;

  /**
   * Apply throttling to an allocation based on contention level.
   */
  applyThrottle(
    allocationId: string,
    level: ThrottleLevel,
    reason: string,
  ): Outcome<ThrottleState> {
    if (level === ThrottleLevel.NONE) {
      this.removeThrottle(allocationId);
      return ok({
        level: ThrottleLevel.NONE,
        rateMultiplier: 1.0,
        startedAt: new Date().toISOString() as ISO8601,
      });
    }

    const decision = this.getThrottleDecision(level, reason);
    const now = new Date();
    const startedAt = now.toISOString() as ISO8601;
    let expiresAt: ISO8601 | undefined;

    if (decision.durationMs > 0) {
      expiresAt = new Date(now.getTime() + decision.durationMs).toISOString() as ISO8601;
    }

    const state: ThrottleState = {
      level: decision.level,
      rateMultiplier: decision.rateMultiplier,
      startedAt,
      expiresAt,
    };

    this.throttleStates.set(allocationId, state);
    return ok(state);
  }

  /**
   * Remove throttling from an allocation.
   */
  removeThrottle(allocationId: string): void {
    this.throttleStates.delete(allocationId);
  }

  /**
   * Get the current throttle state for an allocation.
   */
  getThrottleState(allocationId: string): ThrottleState | undefined {
    const state = this.throttleStates.get(allocationId);
    if (!state) return undefined;

    // Check if throttle has expired
    if (state.expiresAt && Date.now() >= new Date(state.expiresAt).getTime()) {
      this.throttleStates.delete(allocationId);
      return undefined;
    }

    return state;
  }

  /**
   * Get the effective rate multiplier for an allocation (1.0 if not throttled).
   */
  getEffectiveRate(allocationId: string): number {
    const state = this.getThrottleState(allocationId);
    return state?.rateMultiplier ?? 1.0;
  }

  /**
   * Determine throttle level based on resource contention.
   */
  determineThrottleLevel(contentionRatio: number): ThrottleLevel {
    // contentionRatio: 0 = no contention, 1 = full contention
    if (contentionRatio >= 0.95) return ThrottleLevel.CRITICAL;
    if (contentionRatio >= 0.9) return ThrottleLevel.SEVERE;
    if (contentionRatio >= 0.75) return ThrottleLevel.MODERATE;
    if (contentionRatio >= 0.5) return ThrottleLevel.MILD;
    return ThrottleLevel.NONE;
  }

  /**
   * Check if an allocation can perform an operation given its throttle state.
   */
  canOperate(allocationId: string): boolean {
    const state = this.getThrottleState(allocationId);
    if (!state) return true; // Not throttled
    if (state.level === ThrottleLevel.CRITICAL) return false; // 95% reduction = basically blocked
    return true;
  }

  /**
   * Circuit breaker: notify of infrastructure status.
   * If infrastructure was down for 5+ minutes, reset all throttles when it comes back.
   */
  notifyInfrastructureStatus(isHealthy: boolean): void {
    if (!isHealthy) {
      if (this.infrastructureDownSince === null) {
        this.infrastructureDownSince = Date.now();
      }
    } else {
      if (this.infrastructureDownSince !== null) {
        const downDuration = Date.now() - this.infrastructureDownSince;
        if (downDuration >= CIRCUIT_BREAKER_DOWN_TIME_MS) {
          // Circuit breaker: reset all throttles
          this.throttleStates.clear();
        }
        this.infrastructureDownSince = null;
      }
    }
  }

  /**
   * Get throttle decision parameters for a given level.
   */
  private getThrottleDecision(level: ThrottleLevel, reason: string): ThrottleDecision {
    switch (level) {
      case ThrottleLevel.MILD:
        return {
          level: ThrottleLevel.MILD,
          rateMultiplier: THROTTLE_MILD,
          durationMs: THROTTLE_MILD_DURATION_MS,
          reason,
        };
      case ThrottleLevel.MODERATE:
        return {
          level: ThrottleLevel.MODERATE,
          rateMultiplier: THROTTLE_MODERATE,
          durationMs: THROTTLE_MODERATE_DURATION_MS,
          reason,
        };
      case ThrottleLevel.SEVERE:
        return {
          level: ThrottleLevel.SEVERE,
          rateMultiplier: THROTTLE_SEVERE,
          durationMs: THROTTLE_SEVERE_DURATION_MS,
          reason,
        };
      case ThrottleLevel.CRITICAL:
        return {
          level: ThrottleLevel.CRITICAL,
          rateMultiplier: THROTTLE_CRITICAL,
          durationMs: 0, // Until admin review
          reason,
        };
      default:
        return {
          level: ThrottleLevel.NONE,
          rateMultiplier: 1.0,
          durationMs: 0,
          reason: 'No throttling',
        };
    }
  }

  /**
   * Get all currently throttled allocations.
   */
  getThrottledAllocations(): Array<{ allocationId: string; state: ThrottleState }> {
    const result: Array<{ allocationId: string; state: ThrottleState }> = [];
    for (const [allocationId, state] of this.throttleStates) {
      // Filter out expired
      if (state.expiresAt && Date.now() >= new Date(state.expiresAt).getTime()) {
        this.throttleStates.delete(allocationId);
        continue;
      }
      result.push({ allocationId, state });
    }
    return result;
  }
}