/**
 * @agentos/resources — Budget Enforcer
 * Hard + Soft budget enforcement from resource-model-v1.md Section 8.
 *
 * Hard budget:
 * - 80% warning
 * - 95% critical
 * - 100% graceful termination (10s checkpoint)
 * - 100%+30s force terminate
 *
 * Soft budget:
 * - 1st offense: 50% throttle for 5 min
 * - 2nd offense: 25% throttle for 15 min
 * - 3rd offense: 10% throttle for 1h
 * - 5+: suspend
 */

import type { AgentID, Outcome, ISO8601 } from '@agentos/types';
import {
  ok, err, KER,
  BUDGET_WARNING_PERCENT,
  BUDGET_CRITICAL_PERCENT,
  BUDGET_EXHAUSTED_PERCENT,
  BUDGET_FORCE_TERMINATE_AFTER_MS,
} from '@agentos/types';

// ─── Budget Thresholds ───────────────────────────────────────────────

export enum BudgetLevel {
  OK = 'ok',
  WARNING = 'warning',
  CRITICAL = 'critical',
  EXHAUSTED = 'exhausted',
  FORCE_TERMINATE = 'force_terminate',
}

export interface BudgetStatus {
  level: BudgetLevel;
  percentUsed: number;
  budgetTotal: number;
  budgetUsed: number;
  message?: string;
  checkpointDeadline?: ISO8601;  // For exhausted level
  forceTerminateAt?: ISO8601;   // For exhausted level
}

export interface SoftOffense {
  agentId: AgentID;
  offenseNumber: number;
  throttlePercent: number;
  durationMs: number;
  timestamp: number;
}

// ─── BudgetEnforcer ──────────────────────────────────────────────────

export class BudgetEnforcer {
  /** Agent offense history for soft budget */
  private offenseHistory: Map<string, SoftOffense[]> = new Map();

  /** Agent exhaustion tracking */
  private exhaustionTimes: Map<string, number> = new Map();

  /**
   * Evaluate budget usage and return the current status level.
   */
  evaluate(budgetTotal: number, budgetUsed: number, agentId?: AgentID): BudgetStatus {
    if (budgetTotal <= 0) {
      return {
        level: BudgetLevel.OK,
        percentUsed: 0,
        budgetTotal: 0,
        budgetUsed: 0,
        message: 'No budget defined',
      };
    }

    const percentUsed = (budgetUsed / budgetTotal) * 100;

    if (percentUsed >= BUDGET_EXHAUSTED_PERCENT) {
      // Check if force terminate applies
      const agentKey = agentId as string | undefined;
      let forceTerminate: ISO8601 | undefined;
      let checkpointDeadline: ISO8601 | undefined;

      if (agentKey) {
        const exhaustedAt = this.exhaustionTimes.get(agentKey);
        const now = Date.now();

        if (!exhaustedAt) {
          // First time at 100% — start the clock
          this.exhaustionTimes.set(agentKey, now);
          checkpointDeadline = new Date(now + 10_000).toISOString() as ISO8601;
          forceTerminate = new Date(now + BUDGET_FORCE_TERMINATE_AFTER_MS).toISOString() as ISO8601;
        } else {
          // Already exhausted
          checkpointDeadline = new Date(exhaustedAt + 10_000).toISOString() as ISO8601;
          forceTerminate = new Date(exhaustedAt + BUDGET_FORCE_TERMINATE_AFTER_MS).toISOString() as ISO8601;

          // Check if force terminate threshold passed
          if (now - exhaustedAt >= BUDGET_FORCE_TERMINATE_AFTER_MS) {
            return {
              level: BudgetLevel.FORCE_TERMINATE,
              percentUsed,
              budgetTotal,
              budgetUsed,
              message: 'Budget exhausted. Force termination imminent.',
              checkpointDeadline,
              forceTerminateAt: forceTerminate,
            };
          }
        }
      }

      return {
        level: BudgetLevel.EXHAUSTED,
        percentUsed,
        budgetTotal,
        budgetUsed,
        message: 'Budget exhausted. Graceful termination required (10s checkpoint window).',
        checkpointDeadline,
        forceTerminateAt: forceTerminate,
      };
    }

    if (percentUsed >= BUDGET_CRITICAL_PERCENT) {
      return {
        level: BudgetLevel.CRITICAL,
        percentUsed,
        budgetTotal,
        budgetUsed,
        message: `Budget at ${Math.round(percentUsed)}% — critical threshold (${BUDGET_CRITICAL_PERCENT}%) exceeded.`,
      };
    }

    if (percentUsed >= BUDGET_WARNING_PERCENT) {
      return {
        level: BudgetLevel.WARNING,
        percentUsed,
        budgetTotal,
        budgetUsed,
        message: `Budget at ${Math.round(percentUsed)}% — warning threshold (${BUDGET_WARNING_PERCENT}%) exceeded.`,
      };
    }

    return {
      level: BudgetLevel.OK,
      percentUsed,
      budgetTotal,
      budgetUsed,
    };
  }

  /**
   * Enforce hard budget: returns true if the agent should be allowed to continue.
   * Returns false + appropriate level if budget limits are breached.
   */
  enforceHard(budgetTotal: number, budgetUsed: number, agentId: AgentID): {
    allowed: boolean;
    status: BudgetStatus;
  } {
    const status = this.evaluate(budgetTotal, budgetUsed, agentId);

    switch (status.level) {
      case BudgetLevel.OK:
      case BudgetLevel.WARNING:
        return { allowed: true, status };
      case BudgetLevel.CRITICAL:
        return { allowed: true, status }; // Still allowed but warned
      case BudgetLevel.EXHAUSTED:
        return { allowed: false, status }; // Graceful termination
      case BudgetLevel.FORCE_TERMINATE:
        return { allowed: false, status }; // Force terminate
    }
  }

  /**
   * Enforce soft budget: returns throttle percentage for repeated offenses.
   * 1st offense: 50% for 5 min
   * 2nd offense: 25% for 15 min
   * 3rd offense: 10% for 1h
   * 5+: suspend (0%)
   */
  enforceSoft(agentId: AgentID): Outcome<{
    throttlePercent: number;
    durationMs: number;
    suspended: boolean;
  }> {
    const key = agentId as string;
    const now = Date.now();

    // Get or initialize offense history
    let offenses = this.offenseHistory.get(key);
    if (!offenses) {
      offenses = [];
      this.offenseHistory.set(key, offenses);
    }

    // Clean up expired offenses (older than 24h)
    const oneDayAgo = now - 86_400_000;
    const recent = offenses.filter(o => o.timestamp > oneDayAgo);
    this.offenseHistory.set(key, recent);

    const offenseNumber = recent.length + 1;

    // Determine penalty
    let throttlePercent: number;
    let durationMs: number;
    let suspended = false;

    if (offenseNumber >= 5) {
      throttlePercent = 0;
      durationMs = 0;
      suspended = true;
    } else if (offenseNumber === 4) {
      throttlePercent = 10;
      durationMs = 3_600_000; // 1 hour
    } else if (offenseNumber === 3) {
      throttlePercent = 10;
      durationMs = 3_600_000;
    } else if (offenseNumber === 2) {
      throttlePercent = 25;
      durationMs = 900_000; // 15 min
    } else {
      throttlePercent = 50;
      durationMs = 300_000; // 5 min
    }

    // Record the offense
    const offense: SoftOffense = {
      agentId,
      offenseNumber,
      throttlePercent,
      durationMs,
      timestamp: now,
    };
    recent.push(offense);

    return ok({ throttlePercent, durationMs, suspended });
  }

  /**
   * Clear exhaustion timer for an agent (e.g., after budget reset or top-up).
   */
  clearExhaustion(agentId: AgentID): void {
    this.exhaustionTimes.delete(agentId as string);
  }

  /**
   * Get the number of recent soft offenses for an agent.
   */
  getOffenseCount(agentId: AgentID): number {
    const offenses = this.offenseHistory.get(agentId as string);
    if (!offenses) return 0;
    const oneDayAgo = Date.now() - 86_400_000;
    return offenses.filter(o => o.timestamp > oneDayAgo).length;
  }
}