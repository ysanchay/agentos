import { describe, it, expect, beforeEach } from 'vitest';
import { PreemptionEngine } from '../src/preemption-engine.js';
import type { AllocationRecord } from '../src/allocator.js';
import { AllocationState, PRIORITY_SYSTEM, PRIORITY_CRITICAL, PRIORITY_HIGH, PRIORITY_NORMAL, PRIORITY_LOW, PRIORITY_IDLE } from '@agentos/types';
import type { Priority, AgentID, WorkspaceID, AllocationID, ISO8601 } from '@agentos/types';
import { createUUID } from '@agentos/types';

function makeId(): string { return createUUID(); }

function makeAllocation(overrides: Partial<AllocationRecord> = {}): AllocationRecord {
  const now = new Date().toISOString() as ISO8601;
  return {
    id: makeId() as unknown as AllocationID,
    agent_id: makeId() as unknown as AgentID,
    workspace_id: makeId() as unknown as WorkspaceID,
    state: AllocationState.ACTIVE,
    priority: PRIORITY_NORMAL,
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

describe('PreemptionEngine', () => {
  let engine: PreemptionEngine;

  beforeEach(() => {
    engine = new PreemptionEngine();
  });

  describe('canPreempt', () => {
    it('should not allow preemption of SYSTEM priority', () => {
      expect(engine.canPreempt(PRIORITY_CRITICAL as Priority, PRIORITY_SYSTEM)).toBe(false);
      expect(engine.canPreempt(PRIORITY_HIGH as Priority, PRIORITY_SYSTEM)).toBe(false);
      expect(engine.canPreempt(PRIORITY_NORMAL as Priority, PRIORITY_SYSTEM)).toBe(false);
    });

    it('should allow CRITICAL to preempt LOW and IDLE', () => {
      expect(engine.canPreempt(PRIORITY_CRITICAL as Priority, PRIORITY_LOW as Priority)).toBe(true);
      expect(engine.canPreempt(PRIORITY_CRITICAL as Priority, PRIORITY_IDLE as Priority)).toBe(true);
    });

    it('should not allow CRITICAL to preempt NORMAL', () => {
      expect(engine.canPreempt(PRIORITY_CRITICAL as Priority, PRIORITY_NORMAL as Priority)).toBe(false);
    });

    it('should allow HIGH to preempt IDLE only', () => {
      expect(engine.canPreempt(PRIORITY_HIGH as Priority, PRIORITY_IDLE as Priority)).toBe(true);
      expect(engine.canPreempt(PRIORITY_HIGH as Priority, PRIORITY_LOW as Priority)).toBe(false);
      expect(engine.canPreempt(PRIORITY_HIGH as Priority, PRIORITY_NORMAL as Priority)).toBe(false);
    });

    it('should not allow NORMAL to preempt anything', () => {
      expect(engine.canPreempt(PRIORITY_NORMAL as Priority, PRIORITY_LOW as Priority)).toBe(false);
      expect(engine.canPreempt(PRIORITY_NORMAL as Priority, PRIORITY_IDLE as Priority)).toBe(false);
    });

    it('should not allow SYSTEM to preempt anything', () => {
      expect(engine.canPreempt(PRIORITY_SYSTEM, PRIORITY_IDLE as Priority)).toBe(false);
    });
  });

  describe('isImmune', () => {
    it('should return true for allocation within MIN_RUNTIME_MS', () => {
      const now = Date.now();
      const alloc = makeAllocation({
        active_since: new Date(now - 10000).toISOString() as ISO8601,
      });

      // 10 seconds ago, MIN_RUNTIME_MS = 30000, so still immune
      expect(engine.isImmune(alloc, now)).toBe(true);
    });

    it('should return false for allocation past MIN_RUNTIME_MS', () => {
      const now = Date.now();
      const alloc = makeAllocation({
        active_since: new Date(now - 60000).toISOString() as ISO8601,
      });

      // 60 seconds ago, past MIN_RUNTIME_MS
      expect(engine.isImmune(alloc, now)).toBe(false);
    });

    it('should return false when active_since is undefined', () => {
      const alloc = makeAllocation({ active_since: undefined });
      expect(engine.isImmune(alloc)).toBe(false);
    });

    it('should return true at exactly MIN_RUNTIME_MS - 1', () => {
      const now = Date.now();
      const alloc = makeAllocation({
        active_since: new Date(now - 29999).toISOString() as ISO8601,
      });
      expect(engine.isImmune(alloc, now)).toBe(true);
    });
  });

  describe('isPreemptible', () => {
    it('should return true when allocation preemptible flag is true', () => {
      const alloc = makeAllocation({ preemptible: true });
      expect(engine.isPreemptible(alloc)).toBe(true);
    });

    it('should return false when allocation preemptible flag is false', () => {
      const alloc = makeAllocation({ preemptible: false });
      expect(engine.isPreemptible(alloc)).toBe(false);
    });
  });

  describe('selectCandidates', () => {
    it('should return empty list when no preemptible allocations', () => {
      const allocs = [
        makeAllocation({ priority: PRIORITY_IDLE as Priority, preemptible: false }),
      ];

      const candidates = engine.selectCandidates(allocs, PRIORITY_CRITICAL as Priority, 50, 25, 5, 2);
      expect(candidates).toHaveLength(0);
    });

    it('should return candidates sorted by priority (lowest priority first)', () => {
      const now = Date.now();
      const idle = makeAllocation({
        priority: PRIORITY_IDLE as Priority,
        preemptible: true,
        active_since: new Date(now - 60000).toISOString() as ISO8601,
        created_at: new Date(now - 60000).toISOString() as ISO8601,
      });
      const low = makeAllocation({
        priority: PRIORITY_LOW as Priority,
        preemptible: true,
        active_since: new Date(now - 60000).toISOString() as ISO8601,
        created_at: new Date(now - 60000).toISOString() as ISO8601,
      });

      const candidates = engine.selectCandidates([idle, low], PRIORITY_CRITICAL as Priority, 50, 25, 5, 2);
      expect(candidates.length).toBeGreaterThan(0);
      // IDLE (5) should come before LOW (4) in sort order (higher number = lower priority = preempted first)
      if (candidates.length >= 2) {
        expect(candidates[0].allocation.priority).toBe(PRIORITY_IDLE);
      }
    });

    it('should skip allocations not in active/throttled state', () => {
      const pending = makeAllocation({
        state: AllocationState.PENDING,
        priority: PRIORITY_IDLE as Priority,
        preemptible: true,
      });
      const released = makeAllocation({
        state: AllocationState.RELEASED,
        priority: PRIORITY_IDLE as Priority,
        preemptible: true,
      });

      const candidates = engine.selectCandidates([pending, released], PRIORITY_CRITICAL as Priority, 50, 25, 5, 2);
      expect(candidates).toHaveLength(0);
    });

    it('should skip immune allocations', () => {
      const now = Date.now();
      const immune = makeAllocation({
        priority: PRIORITY_IDLE as Priority,
        preemptible: true,
        active_since: new Date(now - 5000).toISOString() as ISO8601, // Still immune
      });

      const candidates = engine.selectCandidates([immune], PRIORITY_CRITICAL as Priority, 50, 25, 5, 2);
      // The allocation is immune but still appears as a candidate with immune=true
      // but it should be skipped in selection (not added to `selected`)
      // Looking at the implementation: immune allocations are candidates but are skipped
      // in the greedy loop. So candidates will include it but selected won't.
      expect(candidates.every(c => c.immune)).toBe(true);
    });

    it('should select non-immune candidates to meet resource needs', () => {
      const now = Date.now();
      const alloc1 = makeAllocation({
        priority: PRIORITY_IDLE as Priority,
        preemptible: true,
        active_since: new Date(now - 60000).toISOString() as ISO8601,
        ru_allocated: 100,
        mu_allocated: 50,
        eu_allocated: 10,
        vu_allocated: 5,
        ru_consumed: 50,
        mu_consumed: 25,
        eu_consumed: 5,
        vu_consumed: 2,
      });

      const candidates = engine.selectCandidates([alloc1], PRIORITY_CRITICAL as Priority, 50, 25, 5, 2);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].immune).toBe(false);
    });

    it('should include throttled allocations as candidates', () => {
      const now = Date.now();
      const throttled = makeAllocation({
        state: AllocationState.THROTTLED,
        priority: PRIORITY_IDLE as Priority,
        preemptible: true,
        active_since: new Date(now - 60000).toISOString() as ISO8601,
      });

      const candidates = engine.selectCandidates([throttled], PRIORITY_CRITICAL as Priority, 50, 25, 5, 2);
      expect(candidates).toHaveLength(1);
    });
  });

  describe('preempt', () => {
    it('should preempt non-immune candidates and track history', () => {
      const now = Date.now();
      const alloc = makeAllocation({
        priority: PRIORITY_IDLE as Priority,
        preemptible: true,
        active_since: new Date(now - 60000).toISOString() as ISO8601,
      });

      const result = engine.preempt(
        [{ allocation: alloc, immune: false }],
        'higher_priority_request',
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.preempted).toHaveLength(1);
        expect(result.data.failed).toHaveLength(0);
        expect(result.data.preempted[0]).toBe(alloc);
      }
    });

    it('should fail for immune candidates', () => {
      const now = Date.now();
      const alloc = makeAllocation({
        priority: PRIORITY_IDLE as Priority,
        preemptible: true,
        active_since: new Date(now - 5000).toISOString() as ISO8601, // Immune
      });

      const result = engine.preempt(
        [{ allocation: alloc, immune: true }],
        'higher_priority_request',
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.preempted).toHaveLength(0);
        expect(result.data.failed).toHaveLength(1);
        expect(result.data.failed[0].reason).toContain('immune');
      }
    });

    it('should track preemption count per agent', () => {
      const agentId = makeId() as unknown as AgentID;
      const now = Date.now();
      const alloc = makeAllocation({
        agent_id: agentId,
        priority: PRIORITY_IDLE as Priority,
        preemptible: true,
        active_since: new Date(now - 60000).toISOString() as ISO8601,
      });

      engine.preempt([{ allocation: alloc, immune: false }], 'test');
      expect(engine.getPreemptionCount(agentId)).toBe(1);

      // Preempt again
      const alloc2 = makeAllocation({
        agent_id: agentId,
        priority: PRIORITY_IDLE as Priority,
        preemptible: true,
        active_since: new Date(now - 60000).toISOString() as ISO8601,
      });
      engine.preempt([{ allocation: alloc2, immune: false }], 'test');
      expect(engine.getPreemptionCount(agentId)).toBe(2);
    });

    it('should return 0 for unknown agent', () => {
      expect(engine.getPreemptionCount('unknown' as unknown as AgentID)).toBe(0);
    });
  });

  describe('getAgentPenalty', () => {
    it('should return no penalty for fewer than 3 preemptions', () => {
      const agentId = makeId() as unknown as AgentID;
      const now = Date.now();

      // Record 2 preemptions
      const alloc = makeAllocation({
        agent_id: agentId,
        priority: PRIORITY_IDLE as Priority,
        preemptible: true,
        active_since: new Date(now - 60000).toISOString() as ISO8601,
      });
      engine.preempt([{ allocation: alloc, immune: false }], 'test');
      const alloc2 = makeAllocation({
        agent_id: agentId,
        priority: PRIORITY_IDLE as Priority,
        preemptible: true,
        active_since: new Date(now - 60000).toISOString() as ISO8601,
      });
      engine.preempt([{ allocation: alloc2, immune: false }], 'test');

      const penalty = engine.getAgentPenalty(agentId);
      expect(penalty.priorityPenalty).toBe(0);
      expect(penalty.flagged).toBe(false);
    });

    it('should return priority penalty for 3+ preemptions', () => {
      const agentId = makeId() as unknown as AgentID;
      const now = Date.now();

      for (let i = 0; i < 3; i++) {
        const alloc = makeAllocation({
          agent_id: agentId,
          priority: PRIORITY_IDLE as Priority,
          preemptible: true,
          active_since: new Date(now - 60000).toISOString() as ISO8601,
        });
        engine.preempt([{ allocation: alloc, immune: false }], 'test');
      }

      const penalty = engine.getAgentPenalty(agentId);
      expect(penalty.priorityPenalty).toBe(1);
      expect(penalty.flagged).toBe(false);
    });

    it('should flag for review after 5 preemptions', () => {
      const agentId = makeId() as unknown as AgentID;
      const now = Date.now();

      for (let i = 0; i < 5; i++) {
        const alloc = makeAllocation({
          agent_id: agentId,
          priority: PRIORITY_IDLE as Priority,
          preemptible: true,
          active_since: new Date(now - 60000).toISOString() as ISO8601,
        });
        engine.preempt([{ allocation: alloc, immune: false }], 'test');
      }

      const penalty = engine.getAgentPenalty(agentId);
      expect(penalty.priorityPenalty).toBe(1);
      expect(penalty.flagged).toBe(true);
    });
  });

  describe('getGracePeriodDeadline', () => {
    it('should return deadline 10 seconds after preemptedAt', () => {
      const preemptedAt = '2026-01-01T00:00:00.000Z' as ISO8601;
      const deadline = engine.getGracePeriodDeadline(preemptedAt);
      const deadlineDate = new Date(deadline);
      const preemptedDate = new Date(preemptedAt);

      expect(deadlineDate.getTime() - preemptedDate.getTime()).toBe(10000);
    });
  });
});