/**
 * @agentos/resources — Fairness Engine
 * No starvation + fair share from resource-model-v1.md Section 7.
 *
 * Rules:
 * - Maximum wait times: CRITICAL=10s, HIGH=60s, NORMAL=300s
 * - If wait exceeded: auto-upgrade priority by 1 (max 2 upgrades)
 * - Fair share: equal division among same-priority agents
 * - Burst: 20% of hourly quota can be consumed in 1-min window
 * - Priority inversion prevention: temporary promotion for 30s (max 3x/hour)
 * - Fair share recalculated every 30s
 */

import type {
  Priority,
  Outcome,
  AgentID,
  ISO8601,
  ResourceBudget,
} from '@agentos/types';
import {
  ok, err, KER,
  PRIORITY_SYSTEM, PRIORITY_CRITICAL, PRIORITY_HIGH, PRIORITY_NORMAL,
  MAX_PRIORITY_WAIT_MS,
  BURST_ALLOWANCE_RATIO,
  FAIR_SHARE_RECALCULATE_MS,
  PRIORITY_INVERSION_MAX_DURATION_MS,
  PRIORITY_INVERSION_MAX_PER_HOUR,
} from '@agentos/types';
import type { AllocationRecord } from './allocator.js';

// ─── Interfaces ──────────────────────────────────────────────────────

export interface WaitEntry {
  agentId: AgentID;
  requestedAt: ISO8601;
  originalPriority: Priority;
  currentPriority: Priority;
  upgrades: number;
}

export interface FairShareAllocation {
  agentId: AgentID;
  share: ResourceBudget;
  priority: Priority;
}

export interface PriorityInversionRecord {
  agentId: AgentID;
  promotedAt: number;
  originalPriority: Priority;
  promotedTo: Priority;
  expiresAt: number;
}

export interface BurstState {
  agentId: AgentID;
  hourlyQuota: number;
  burstAllowance: number;
  burstConsumed: number;
  windowStart: number;
  windowDurationMs: number;
}

// ─── FairnessEngine ──────────────────────────────────────────────────

export class FairnessEngine {
  /** Waiting queue entries by agent */
  private waitQueue: Map<string, WaitEntry> = new Map();

  /** Priority inversion tracking */
  private inversionRecords: Map<string, PriorityInversionRecord[]> = new Map();

  /** Burst state tracking per agent */
  private burstStates: Map<string, BurstState> = new Map();

  /** Last fair share recalculation */
  private lastRecalculation: number = 0;

  /** Cached fair share results */
  private cachedShares: Map<string, ResourceBudget> = new Map();

  /**
   * Register an agent as waiting in the queue.
   */
  registerWait(
    agentId: AgentID,
    priority: Priority,
    requestedAt?: ISO8601,
  ): void {
    const entry: WaitEntry = {
      agentId,
      requestedAt: requestedAt ?? new Date().toISOString() as ISO8601,
      originalPriority: priority,
      currentPriority: priority,
      upgrades: 0,
    };
    this.waitQueue.set(agentId as string, entry);
  }

  /**
   * Remove an agent from the wait queue (when granted).
   */
  removeWait(agentId: AgentID): void {
    this.waitQueue.delete(agentId as string);
  }

  /**
   * Check for starvation and auto-upgrade priorities as needed.
   * Returns agents that were upgraded.
   */
  checkStarvation(now?: number): Array<{ agentId: AgentID; from: Priority; to: Priority }> {
    const nowMs = now ?? Date.now();
    const upgraded: Array<{ agentId: AgentID; from: Priority; to: Priority }> = [];

    for (const [, entry] of this.waitQueue) {
      // SYSTEM never waits, so never needs upgrade
      if (entry.originalPriority === PRIORITY_SYSTEM) continue;

      // Max 2 upgrades allowed
      if (entry.upgrades >= 2) continue;

      const maxWait = MAX_PRIORITY_WAIT_MS[entry.currentPriority];
      // -1 means no guarantee (LOW, IDLE), undefined for unknown priorities
      if (maxWait === undefined || maxWait === -1 || maxWait === 0) continue;

      const waitMs = nowMs - new Date(entry.requestedAt).getTime();
      if (waitMs > maxWait) {
        // Auto-upgrade priority by 1
        const newPriority = Math.max(0, entry.currentPriority - 1) as Priority;
        if (newPriority < entry.currentPriority) {
          entry.currentPriority = newPriority;
          entry.upgrades++;
          upgraded.push({
            agentId: entry.agentId,
            from: entry.currentPriority + 1 as Priority,
            to: newPriority,
          });
        }
      }
    }

    return upgraded;
  }

  /**
   * Calculate fair share for agents at the same priority level.
   * Equal division of available resources.
   */
  calculateFairShare(
    available: ResourceBudget,
    agents: Array<{ agentId: AgentID; priority: Priority }>,
  ): FairShareAllocation[] {
    // Group agents by priority
    const byPriority: Map<Priority, AgentID[]> = new Map();
    for (const agent of agents) {
      let group = byPriority.get(agent.priority);
      if (!group) {
        group = [];
        byPriority.set(agent.priority, group);
      }
      group.push(agent.agentId);
    }

    const result: FairShareAllocation[] = [];
    let remaining = { ...available };

    // Distribute from highest priority (lowest number) to lowest
    const sortedPriorities = [...byPriority.keys()].sort((a, b) => a - b);

    for (const priority of sortedPriorities) {
      const group = byPriority.get(priority)!;
      const count = group.length;
      if (count === 0) continue;

      // Equal division per agent at this priority
      const perAgent: ResourceBudget = {
        ru: Math.floor(remaining.ru / count),
        mu: Math.floor(remaining.mu / count),
        eu: Math.floor(remaining.eu / count),
        vu: Math.floor(remaining.vu / count),
      };

      for (const agentId of group) {
        result.push({ agentId, share: perAgent, priority });
        remaining.ru -= perAgent.ru;
        remaining.mu -= perAgent.mu;
        remaining.eu -= perAgent.eu;
        remaining.vu -= perAgent.vu;
      }
    }

    // Cache the results
    this.lastRecalculation = Date.now();
    this.cachedShares.clear();
    for (const alloc of result) {
      this.cachedShares.set(alloc.agentId as string, alloc.share);
    }

    return result;
  }

  /**
   * Check if fair share needs recalculation (every 30s).
   */
  needsRecalculation(): boolean {
    return (Date.now() - this.lastRecalculation) >= FAIR_SHARE_RECALCULATE_MS;
  }

  /**
   * Request a priority inversion prevention promotion for an agent.
   * Temporary promotion for 30s, max 3x/hour.
   */
  requestInversionPrevention(
    agentId: AgentID,
    currentPriority: Priority,
    targetPriority: Priority,
  ): Outcome<{ promoted: boolean; promotedTo: Priority }> {
    const key = agentId as string;
    let records = this.inversionRecords.get(key);
    if (!records) {
      records = [];
      this.inversionRecords.set(key, records);
    }

    const now = Date.now();
    const oneHourAgo = now - 3_600_000;

    // Clean up expired records
    const active = records.filter(r => r.expiresAt > now && r.promotedAt > oneHourAgo);

    // Check per-hour limit
    const recentCount = active.length;
    if (recentCount >= PRIORITY_INVERSION_MAX_PER_HOUR) {
      return err(KER.QUOTA_EXCEEDED, 'Priority inversion prevention limit reached (3x/hour)', {
        retryable: true,
        retry_after: PRIORITY_INVERSION_MAX_DURATION_MS,
      });
    }

    // Grant promotion
    const record: PriorityInversionRecord = {
      agentId,
      promotedAt: now,
      originalPriority: currentPriority,
      promotedTo: targetPriority,
      expiresAt: now + PRIORITY_INVERSION_MAX_DURATION_MS,
    };

    active.push(record);
    this.inversionRecords.set(key, active);

    return ok({ promoted: true, promotedTo: targetPriority });
  }

  /**
   * Check if an agent currently has a priority inversion promotion active.
   */
  getActivePromotion(agentId: AgentID): PriorityInversionRecord | undefined {
    const records = this.inversionRecords.get(agentId as string);
    if (!records) return undefined;

    const now = Date.now();
    return records.find(r => r.expiresAt > now);
  }

  /**
   * Check burst allowance for an agent.
   * 20% of hourly quota can be consumed in a 1-minute window.
   */
  checkBurst(
    agentId: AgentID,
    requestedAmount: number,
    hourlyQuota: number,
  ): boolean {
    const key = agentId as string;
    let burst = this.burstStates.get(key);
    const now = Date.now();

    if (!burst) {
      burst = {
        agentId,
        hourlyQuota,
        burstAllowance: Math.floor(hourlyQuota * BURST_ALLOWANCE_RATIO),
        burstConsumed: 0,
        windowStart: now,
        windowDurationMs: 60_000, // 1 minute window
      };
      this.burstStates.set(key, burst);
    }

    // Reset window if expired
    if (now - burst.windowStart >= burst.windowDurationMs) {
      burst.windowStart = now;
      burst.burstConsumed = 0;
      burst.burstAllowance = Math.floor(hourlyQuota * BURST_ALLOWANCE_RATIO);
    }

    return (burst.burstConsumed + requestedAmount) <= burst.burstAllowance;
  }

  /**
   * Record burst consumption.
   */
  recordBurstConsumption(agentId: AgentID, amount: number, hourlyQuota: number): void {
    const key = agentId as string;
    const burst = this.burstStates.get(key);
    const now = Date.now();

    if (!burst) {
      this.burstStates.set(key, {
        agentId,
        hourlyQuota,
        burstAllowance: Math.floor(hourlyQuota * BURST_ALLOWANCE_RATIO),
        burstConsumed: amount,
        windowStart: now,
        windowDurationMs: 60_000,
      });
      return;
    }

    // Reset window if expired
    if (now - burst.windowStart >= burst.windowDurationMs) {
      burst.windowStart = now;
      burst.burstConsumed = 0;
      burst.burstAllowance = Math.floor(hourlyQuota * BURST_ALLOWANCE_RATIO);
    }

    burst.burstConsumed += amount;
  }

  /**
   * Get wait queue depth.
   */
  getQueueDepth(priority?: Priority): number {
    if (priority !== undefined) {
      let count = 0;
      for (const [, entry] of this.waitQueue) {
        if (entry.currentPriority === priority) count++;
      }
      return count;
    }
    return this.waitQueue.size;
  }

  /**
   * Get a waiting agent's effective priority (after any starvation upgrades).
   */
  getEffectivePriority(agentId: AgentID): Priority | undefined {
    const entry = this.waitQueue.get(agentId as string);
    return entry?.currentPriority;
  }
}