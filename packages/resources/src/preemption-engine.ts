/**
 * @agentos/resources — Preemption Engine
 * Priority-based preemption from resource-model-v1.md Section 4.2-4.3.
 *
 * Rules:
 * - SYSTEM (0) CANNOT be preempted
 * - CRITICAL (1) can preempt LOW and IDLE
 * - HIGH (2) can preempt IDLE only
 * - NORMAL (3) cannot preempt
 * - MIN_RUNTIME_MS = 30000 (30s immune period)
 * - GRACE_PERIOD_MS = 10000 (10s to checkpoint)
 * - After 3 preemptions in 24h: scheduling penalty (-1 priority for 1h)
 * - After 5 in 24h: flag for review
 */

import type { Priority, Outcome, ISO8601 } from '@agentos/types';
import { PRIORITY_SYSTEM, PRIORITY_CRITICAL, PRIORITY_HIGH, PRIORITY_NORMAL, ok, err, KER } from '@agentos/types';
import { MIN_RUNTIME_MS, GRACE_PERIOD_MS, PREEMPTION_PENALTY_THRESHOLD, PREEMPTION_FLAG_THRESHOLD } from '@agentos/types';
import type { AllocationRecord } from './allocator.js';

// ─── Preemption Eligibility ──────────────────────────────────────────

/** Which priority levels can preempt which */
const PREEMPTION_RULES: Map<Priority, Priority[]> = new Map([
  [0 as Priority, []],                     // SYSTEM cannot preempt (doesn't need to)
  [1 as Priority, [4 as Priority, 5 as Priority]], // CRITICAL preempts LOW, IDLE
  [2 as Priority, [5 as Priority]],         // HIGH preempts IDLE only
  [3 as Priority, []],                     // NORMAL cannot preempt
  [4 as Priority, []],                     // LOW cannot preempt
  [5 as Priority, []],                     // IDLE cannot preempt
]);

export interface PreemptionResult {
  preempted: AllocationRecord[];
  failed: Array<{ allocation: AllocationRecord; reason: string }>;
}

export interface PreemptionCandidate {
  allocation: AllocationRecord;
  immune: boolean; // Within MIN_RUNTIME_MS
}

export class PreemptionEngine {
  /** Agent preemption history for penalty tracking */
  private preemptionHistory: Map<string, Array<{ timestamp: number; allocationId: string }>> = new Map();

  /**
   * Check if a requesting priority can preempt a target allocation's priority.
   */
  canPreempt(requesterPriority: Priority, targetPriority: Priority): boolean {
    // SYSTEM cannot be preempted ever
    if (targetPriority === PRIORITY_SYSTEM) return false;
    const targets = PREEMPTION_RULES.get(requesterPriority);
    return targets !== undefined && targets.includes(targetPriority);
  }

  /**
   * Check if an allocation is immune from preemption (within MIN_RUNTIME_MS).
   */
  isImmune(allocation: AllocationRecord, now?: number): boolean {
    if (!allocation.active_since) return false;
    const nowMs = now ?? Date.now();
    const activeSinceMs = new Date(allocation.active_since).getTime();
    return (nowMs - activeSinceMs) < MIN_RUNTIME_MS;
  }

  /**
   * Check if an allocation is preemptible based on its own flag.
   */
  isPreemptible(allocation: AllocationRecord): boolean {
    return allocation.preemptible;
  }

  /**
   * Select candidates for preemption to free resources for a higher-priority request.
   * Returns ordered list of candidates (lowest priority first, then oldest).
   */
  selectCandidates(
    allocations: AllocationRecord[],
    requesterPriority: Priority,
    neededRu: number,
    neededMu: number,
    neededEu: number,
    neededVu: number,
    now?: number,
  ): PreemptionCandidate[] {
    const nowMs = now ?? Date.now();
    const candidates: PreemptionCandidate[] = [];

    for (const alloc of allocations) {
      // Must be in a preemptible state
      if (alloc.state !== 'active' && alloc.state !== 'throttled') continue;

      // Must be preemptible by the requester
      if (!this.canPreempt(requesterPriority, alloc.priority)) continue;

      // Must have preemptible flag
      if (!this.isPreemptible(alloc)) continue;

      const immune = this.isImmune(alloc, nowMs);
      candidates.push({ allocation: alloc, immune });
    }

    // Sort: non-immune first (can be preempted now), then by priority (lowest first),
    // then by age (oldest first for tie-breaking)
    candidates.sort((a, b) => {
      // Non-immune before immune
      if (a.immune !== b.immune) return a.immune ? 1 : -1;
      // Lower priority (higher number) first
      if (a.allocation.priority !== b.allocation.priority) {
        return b.allocation.priority - a.allocation.priority;
      }
      // Older allocations first
      return new Date(a.allocation.created_at).getTime() - new Date(b.allocation.created_at).getTime();
    });

    // Greedily select until we have enough resources
    const selected: PreemptionCandidate[] = [];
    let freedRu = 0, freedMu = 0, freedEu = 0, freedVu = 0;

    for (const candidate of candidates) {
      if (candidate.immune) {
        // Skip immune allocations unless we absolutely must wait
        continue;
      }
      selected.push(candidate);
      freedRu += candidate.allocation.ru_allocated - candidate.allocation.ru_consumed;
      freedMu += candidate.allocation.mu_allocated - candidate.allocation.mu_consumed;
      freedEu += candidate.allocation.eu_allocated - candidate.allocation.eu_consumed;
      freedVu += candidate.allocation.vu_allocated - candidate.allocation.vu_consumed;

      if (freedRu >= neededRu && freedMu >= neededMu &&
          freedEu >= neededEu && freedVu >= neededVu) {
        break;
      }
    }

    return selected;
  }

  /**
   * Execute preemption: mark allocations as preempted and track history.
   */
  preempt(
    candidates: PreemptionCandidate[],
    reason: string,
  ): Outcome<PreemptionResult> {
    const result: PreemptionResult = { preempted: [], failed: [] };
    const now = Date.now();

    for (const candidate of candidates) {
      if (candidate.immune) {
        result.failed.push({
          allocation: candidate.allocation,
          reason: 'Allocation is immune (within MIN_RUNTIME_MS)',
        });
        continue;
      }

      // Record preemption in history for penalty tracking
      const agentId = candidate.allocation.agent_id as string;
      let history = this.preemptionHistory.get(agentId);
      if (!history) {
        history = [];
        this.preemptionHistory.set(agentId, history);
      }
      history.push({ timestamp: now, allocationId: candidate.allocation.id as string });

      // Clean up old history (older than 24h)
      const cutoff = now - 86_400_000;
      const filtered = history.filter(h => h.timestamp >= cutoff);
      this.preemptionHistory.set(agentId, filtered);

      result.preempted.push(candidate.allocation);
    }

    return ok(result);
  }

  /**
   * Get the preemption count for an agent in the last 24 hours.
   */
  getPreemptionCount(agentId: string): number {
    const history = this.preemptionHistory.get(agentId);
    if (!history) return 0;
    const cutoff = Date.now() - 86_400_000;
    return history.filter(h => h.timestamp >= cutoff).length;
  }

  /**
   * Check if an agent should receive a scheduling penalty.
   * After 3 preemptions in 24h: -1 priority for 1h.
   * After 5 in 24h: flag for review.
   */
  getAgentPenalty(agentId: string): { priorityPenalty: number; flagged: boolean } {
    const count = this.getPreemptionCount(agentId);
    return {
      priorityPenalty: count >= PREEMPTION_PENALTY_THRESHOLD ? 1 : 0,
      flagged: count >= PREEMPTION_FLAG_THRESHOLD,
    };
  }

  /**
   * Get the grace period deadline for a preempted allocation.
   * Returns the ISO8601 timestamp by which the agent must checkpoint.
   */
  getGracePeriodDeadline(preemptedAt: ISO8601): ISO8601 {
    const deadline = new Date(new Date(preemptedAt).getTime() + GRACE_PERIOD_MS);
    return deadline.toISOString() as ISO8601;
  }
}