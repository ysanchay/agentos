/**
 * @agentos/resources — Efficiency Scorer
 * Calculates efficiency metrics for resource allocations.
 * From resource-model-v1.md Section 9.
 */

import type { AllocationRecord } from './allocator.js';
import type { ResourceBudget } from '@agentos/types';

// ─── Types ─────────────────────────────────────────────────────────────

export interface EfficiencyMetrics {
  /** Overall efficiency score (0-1) */
  score: number;
  /** RU utilization rate (0-1) */
  ruUtilization: number;
  /** MU utilization rate (0-1) */
  muUtilization: number;
  /** EU utilization rate (0-1) */
  euUtilization: number;
  /** VU utilization rate (0-1) */
  vuUtilization: number;
  /** Allocation efficiency: avg(consumed/allocated) across active allocations */
  allocationEfficiency: number;
  /** Number of active allocations */
  activeCount: number;
  /** Number of preempted allocations */
  preemptedCount: number;
  /** Preemption rate */
  preemptionRate: number;
  /** Average wait time in ms */
  avgWaitTimeMs: number;
}

// ─── EfficiencyScorer ──────────────────────────────────────────────────

export class EfficiencyScorer {
  private totalWaitTimeMs: number = 0;
  private totalWaits: number = 0;

  /**
   * Calculate efficiency metrics for a set of allocations.
   */
  calculate(
    allocations: AllocationRecord[],
    totalCapacity: ResourceBudget,
  ): EfficiencyMetrics {
    const active = allocations.filter(
      (a) => a.state === 'active' || a.state === 'throttled',
    );
    const preempted = allocations.filter((a) => a.state === 'preempted');
    const total = allocations.length;

    // Per-resource utilization
    const ruUtilization = totalCapacity.ru > 0
      ? active.reduce((sum, a) => sum + a.ru_consumed, 0) / totalCapacity.ru
      : 0;
    const muUtilization = totalCapacity.mu > 0
      ? active.reduce((sum, a) => sum + a.mu_consumed, 0) / totalCapacity.mu
      : 0;
    const euUtilization = totalCapacity.eu > 0
      ? active.reduce((sum, a) => sum + a.eu_consumed, 0) / totalCapacity.eu
      : 0;
    const vuUtilization = totalCapacity.vu > 0
      ? active.reduce((sum, a) => sum + a.vu_consumed, 0) / totalCapacity.vu
      : 0;

    // Allocation efficiency: average consumed/allocated ratio
    let allocationEfficiency = 0;
    if (active.length > 0) {
      const efficiencies = active.map((a) => {
        const allocated = a.ru_allocated + a.mu_allocated + a.eu_allocated + a.vu_allocated;
        const consumed = a.ru_consumed + a.mu_consumed + a.eu_consumed + a.vu_consumed;
        return allocated > 0 ? consumed / allocated : 0;
      });
      allocationEfficiency = efficiencies.reduce((sum, e) => sum + e, 0) / efficiencies.length;
    }

    // Overall score: weighted average
    const resourceAvg = (ruUtilization + muUtilization + euUtilization + vuUtilization) / 4;
    const score = (resourceAvg * 0.6) + (allocationEfficiency * 0.4);

    return {
      score: Math.min(1, Math.max(0, score)),
      ruUtilization: Math.min(1, ruUtilization),
      muUtilization: Math.min(1, muUtilization),
      euUtilization: Math.min(1, euUtilization),
      vuUtilization: Math.min(1, vuUtilization),
      allocationEfficiency: Math.min(1, allocationEfficiency),
      activeCount: active.length,
      preemptedCount: preempted.length,
      preemptionRate: total > 0 ? preempted.length / total : 0,
      avgWaitTimeMs: this.totalWaits > 0 ? this.totalWaitTimeMs / this.totalWaits : 0,
    };
  }

  /**
   * Record wait time for an allocation request.
   */
  recordWaitTime(waitTimeMs: number): void {
    this.totalWaitTimeMs += waitTimeMs;
    this.totalWaits++;
  }

  /**
   * Calculate efficiency for a single allocation.
   */
  allocationEfficiency(allocation: AllocationRecord): number {
    const allocated = allocation.ru_allocated + allocation.mu_allocated +
      allocation.eu_allocated + allocation.vu_allocated;
    const consumed = allocation.ru_consumed + allocation.mu_consumed +
      allocation.eu_consumed + allocation.vu_consumed;
    return allocated > 0 ? consumed / allocated : 0;
  }

  /**
   * Identify under-utilized allocations (efficiency below threshold).
   */
  findUnderUtilized(
    allocations: AllocationRecord[],
    threshold: number = 0.3,
  ): AllocationRecord[] {
    return allocations
      .filter((a) => a.state === 'active' || a.state === 'throttled')
      .filter((a) => this.allocationEfficiency(a) < threshold);
  }
}