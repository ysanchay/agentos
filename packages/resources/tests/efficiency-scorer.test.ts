import { describe, it, expect, beforeEach } from 'vitest';
import { EfficiencyScorer } from '../src/efficiency-scorer.js';
import type { AllocationRecord } from '../src/allocator.js';
import type { ResourceBudget } from '@agentos/types';
import { AllocationState } from '@agentos/types';
import { createUUID } from '@agentos/types';
import type { AgentID, WorkspaceID, AllocationID, Priority, ISO8601 } from '@agentos/types';

function makeAllocation(overrides: Partial<AllocationRecord> = {}): AllocationRecord {
  const now = new Date().toISOString() as ISO8601;
  return {
    id: createUUID() as unknown as AllocationID,
    agent_id: createUUID() as unknown as AgentID,
    workspace_id: createUUID() as unknown as WorkspaceID,
    state: AllocationState.ACTIVE,
    priority: 3 as Priority,
    preemptible: true,
    ru_allocated: 100,
    mu_allocated: 50,
    eu_allocated: 10,
    vu_allocated: 5,
    ru_consumed: 50,
    mu_consumed: 25,
    eu_consumed: 5,
    vu_consumed: 2,
    created_at: now,
    updated_at: now,
    preemption_count: 0,
    throttle_level: 0,
    ...overrides,
  };
}

describe('EfficiencyScorer', () => {
  let scorer: EfficiencyScorer;
  const capacity: ResourceBudget = { ru: 1000, mu: 500, eu: 100, vu: 50 };

  beforeEach(() => {
    scorer = new EfficiencyScorer();
  });

  describe('calculate', () => {
    it('should return zero metrics for empty allocations', () => {
      const metrics = scorer.calculate([], capacity);
      expect(metrics.score).toBe(0);
      expect(metrics.activeCount).toBe(0);
      expect(metrics.preemptedCount).toBe(0);
      expect(metrics.preemptionRate).toBe(0);
    });

    it('should calculate utilization metrics', () => {
      const allocs = [makeAllocation({
        ru_consumed: 100, mu_consumed: 50, eu_consumed: 10, vu_consumed: 5,
        ru_allocated: 200, mu_allocated: 100, eu_allocated: 20, vu_allocated: 10,
      })];

      const metrics = scorer.calculate(allocs, capacity);
      expect(metrics.ruUtilization).toBe(0.1); // 100/1000
      expect(metrics.muUtilization).toBe(0.1); // 50/500
      expect(metrics.euUtilization).toBe(0.1); // 10/100
      expect(metrics.vuUtilization).toBe(0.1); // 5/50
      expect(metrics.activeCount).toBe(1);
    });

    it('should count active and preempted allocations', () => {
      const allocs = [
        makeAllocation({ state: AllocationState.ACTIVE }),
        makeAllocation({ state: AllocationState.THROTTLED }),
        makeAllocation({ state: AllocationState.PREEMPTED }),
        makeAllocation({ state: AllocationState.RELEASED }),
      ];

      const metrics = scorer.calculate(allocs, capacity);
      expect(metrics.activeCount).toBe(2); // ACTIVE + THROTTLED
      expect(metrics.preemptedCount).toBe(1);
      expect(metrics.preemptionRate).toBe(0.25); // 1/4
    });

    it('should calculate allocation efficiency', () => {
      const allocs = [makeAllocation({
        ru_allocated: 100, mu_allocated: 50, eu_allocated: 10, vu_allocated: 5,
        ru_consumed: 50, mu_consumed: 25, eu_consumed: 5, vu_consumed: 2,
        // total allocated = 165, total consumed = 82
        // efficiency = 82/165 ≈ 0.497
      })];

      const metrics = scorer.calculate(allocs, capacity);
      expect(metrics.allocationEfficiency).toBeCloseTo(82 / 165, 2);
    });

    it('should calculate overall score as weighted average', () => {
      const allocs = [makeAllocation({
        ru_consumed: 500, mu_consumed: 250, eu_consumed: 50, vu_consumed: 25,
        ru_allocated: 1000, mu_allocated: 500, eu_allocated: 100, vu_allocated: 50,
      })];

      const metrics = scorer.calculate(allocs, capacity);
      // RU util = 500/1000 = 0.5, others similar
      // Resource avg = 0.5, allocation efficiency = 825/1650 = 0.5
      // Score = 0.5 * 0.6 + 0.5 * 0.4 = 0.5
      expect(metrics.score).toBeCloseTo(0.5, 1);
    });

    it('should cap score at 1.0', () => {
      // Create allocation with consumption higher than capacity
      // This shouldn't normally happen but we should cap gracefully
      const allocs = [makeAllocation({
        ru_consumed: 2000, mu_consumed: 1000, eu_consumed: 200, vu_consumed: 100,
        ru_allocated: 1000, mu_allocated: 500, eu_allocated: 100, vu_allocated: 50,
      })];

      const metrics = scorer.calculate(allocs, capacity);
      expect(metrics.score).toBeLessThanOrEqual(1.0);
    });

    it('should handle zero capacity gracefully', () => {
      const zeroCapacity: ResourceBudget = { ru: 0, mu: 0, eu: 0, vu: 0 };
      const allocs = [makeAllocation()];

      const metrics = scorer.calculate(allocs, zeroCapacity);
      expect(metrics.ruUtilization).toBe(0);
      expect(metrics.muUtilization).toBe(0);
      expect(metrics.euUtilization).toBe(0);
      expect(metrics.vuUtilization).toBe(0);
    });
  });

  describe('recordWaitTime', () => {
    it('should track average wait time', () => {
      scorer.recordWaitTime(100);
      scorer.recordWaitTime(200);
      scorer.recordWaitTime(300);

      const metrics = scorer.calculate([], capacity);
      expect(metrics.avgWaitTimeMs).toBe(200); // (100+200+300)/3
    });
  });

  describe('allocationEfficiency', () => {
    it('should calculate efficiency for a single allocation', () => {
      const alloc = makeAllocation({
        ru_allocated: 100, mu_allocated: 50, eu_allocated: 10, vu_allocated: 5,
        ru_consumed: 50, mu_consumed: 25, eu_consumed: 5, vu_consumed: 2,
        // total allocated = 165, total consumed = 82
      });

      const efficiency = scorer.allocationEfficiency(alloc);
      expect(efficiency).toBeCloseTo(82 / 165, 2);
    });

    it('should return 0 for zero allocated', () => {
      const alloc = makeAllocation({
        ru_allocated: 0, mu_allocated: 0, eu_allocated: 0, vu_allocated: 0,
        ru_consumed: 0, mu_consumed: 0, eu_consumed: 0, vu_consumed: 0,
      });

      const efficiency = scorer.allocationEfficiency(alloc);
      expect(efficiency).toBe(0);
    });
  });

  describe('findUnderUtilized', () => {
    it('should find allocations below threshold', () => {
      const allocs = [
        makeAllocation({
          state: AllocationState.ACTIVE,
          ru_allocated: 100, mu_allocated: 50, eu_allocated: 10, vu_allocated: 5,
          ru_consumed: 10, mu_consumed: 5, eu_consumed: 1, vu_consumed: 0,
          // efficiency = 16/165 ≈ 0.097
        }),
        makeAllocation({
          state: AllocationState.ACTIVE,
          ru_allocated: 100, mu_allocated: 50, eu_allocated: 10, vu_allocated: 5,
          ru_consumed: 80, mu_consumed: 40, eu_consumed: 8, vu_consumed: 4,
          // efficiency = 132/165 ≈ 0.8
        }),
      ];

      const underUtilized = scorer.findUnderUtilized(allocs, 0.3);
      expect(underUtilized).toHaveLength(1);
      expect(underUtilized[0].ru_consumed).toBe(10);
    });

    it('should use default threshold of 0.3', () => {
      const allocs = [
        makeAllocation({
          state: AllocationState.ACTIVE,
          ru_allocated: 100, mu_allocated: 50, eu_allocated: 10, vu_allocated: 5,
          ru_consumed: 10, mu_consumed: 5, eu_consumed: 1, vu_consumed: 0,
        }),
      ];

      const underUtilized = scorer.findUnderUtilized(allocs);
      expect(underUtilized).toHaveLength(1);
    });

    it('should only consider active or throttled allocations', () => {
      const allocs = [
        makeAllocation({
          state: AllocationState.PREEMPTED,
          ru_allocated: 100, mu_allocated: 50, eu_allocated: 10, vu_allocated: 5,
          ru_consumed: 1, mu_consumed: 1, eu_consumed: 0, vu_consumed: 0,
        }),
        makeAllocation({
          state: AllocationState.ACTIVE,
          ru_allocated: 100, mu_allocated: 50, eu_allocated: 10, vu_allocated: 5,
          ru_consumed: 10, mu_consumed: 5, eu_consumed: 1, vu_consumed: 0,
        }),
      ];

      const underUtilized = scorer.findUnderUtilized(allocs, 0.3);
      expect(underUtilized).toHaveLength(1);
      expect(underUtilized[0].state).toBe(AllocationState.ACTIVE);
    });

    it('should return empty array when all are well-utilized', () => {
      const allocs = [makeAllocation({
        state: AllocationState.ACTIVE,
        ru_allocated: 100, mu_allocated: 50, eu_allocated: 10, vu_allocated: 5,
        ru_consumed: 90, mu_consumed: 45, eu_consumed: 9, vu_consumed: 4,
        // efficiency = 148/165 ≈ 0.9
      })];

      const underUtilized = scorer.findUnderUtilized(allocs, 0.3);
      expect(underUtilized).toHaveLength(0);
    });
  });
});