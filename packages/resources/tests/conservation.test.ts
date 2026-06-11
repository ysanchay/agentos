import { describe, it, expect, beforeEach } from 'vitest';
import { ConservationEnforcer } from '../src/conservation.js';
import type { AllocationRecord } from '../src/allocator.js';
import type { ResourceBudget } from '@agentos/types';
import { createUUID } from '@agentos/types';
import type { AgentID, WorkspaceID, AllocationID, Priority, ISO8601 } from '@agentos/types';
import { AllocationState } from '@agentos/types';

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

describe('ConservationEnforcer', () => {
  let enforcer: ConservationEnforcer;
  const capacity: ResourceBudget = { ru: 1000, mu: 500, eu: 100, vu: 50 };

  beforeEach(() => {
    enforcer = new ConservationEnforcer();
  });

  describe('enforce - RU conservation (Law 1)', () => {
    it('should pass when total RU allocated is within capacity', () => {
      const allocs = [makeAllocation({ ru_allocated: 400 }), makeAllocation({ ru_allocated: 500 })];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.valid).toBe(true);
    });

    it('should fail when total RU allocated exceeds capacity', () => {
      const allocs = [makeAllocation({ ru_allocated: 600 }), makeAllocation({ ru_allocated: 600 })];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.law === 'RU_CONSERVATION')).toBe(true);
    });
  });

  describe('enforce - MU conservation (Law 2)', () => {
    it('should fail when total MU allocated exceeds capacity', () => {
      const allocs = [makeAllocation({ mu_allocated: 300 }), makeAllocation({ mu_allocated: 300 })];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.law === 'MU_CONSERVATION')).toBe(true);
    });
  });

  describe('enforce - EU conservation (Law 3)', () => {
    it('should fail when total EU allocated exceeds capacity', () => {
      const allocs = [makeAllocation({ eu_allocated: 60 }), makeAllocation({ eu_allocated: 60 })];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.law === 'EU_CONSERVATION')).toBe(true);
    });
  });

  describe('enforce - VU conservation (Law 4)', () => {
    it('should fail when total VU allocated exceeds capacity', () => {
      const allocs = [makeAllocation({ vu_allocated: 30 }), makeAllocation({ vu_allocated: 30 })];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.law === 'VU_CONSERVATION')).toBe(true);
    });
  });

  describe('enforce - per-agent conservation (Law 5)', () => {
    it('should pass when consumed <= allocated for each type', () => {
      const allocs = [makeAllocation({
        ru_allocated: 100, ru_consumed: 50,
        mu_allocated: 50, mu_consumed: 25,
        eu_allocated: 10, eu_consumed: 5,
        vu_allocated: 5, vu_consumed: 2,
      })];
      const result = enforcer.enforce(allocs, capacity);
      const perAgentViolations = result.violations.filter(v => v.law === 'PER_AGENT_CONSERVATION');
      expect(perAgentViolations).toHaveLength(0);
    });

    it('should fail when RU consumed exceeds allocated', () => {
      const allocs = [makeAllocation({ ru_allocated: 100, ru_consumed: 150 })];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.violations.some(v => v.law === 'PER_AGENT_CONSERVATION')).toBe(true);
    });

    it('should fail when MU consumed exceeds allocated', () => {
      const allocs = [makeAllocation({ mu_allocated: 50, mu_consumed: 60 })];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.violations.some(v => v.law === 'PER_AGENT_CONSERVATION')).toBe(true);
    });

    it('should fail when EU consumed exceeds allocated', () => {
      const allocs = [makeAllocation({ eu_allocated: 10, eu_consumed: 15 })];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.violations.some(v => v.law === 'PER_AGENT_CONSERVATION')).toBe(true);
    });

    it('should fail when VU consumed exceeds allocated', () => {
      const allocs = [makeAllocation({ vu_allocated: 5, vu_consumed: 10 })];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.violations.some(v => v.law === 'PER_AGENT_CONSERVATION')).toBe(true);
    });
  });

  describe('enforce - non-negative (Law 6)', () => {
    it('should fail when any allocated value is negative', () => {
      const allocs = [makeAllocation({ ru_allocated: -10 })];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.violations.some(v => v.law === 'NON_NEGATIVE')).toBe(true);
    });

    it('should fail when any consumed value is negative', () => {
      const allocs = [makeAllocation({ mu_consumed: -5 })];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.violations.some(v => v.law === 'NON_NEGATIVE')).toBe(true);
    });

    it('should pass when all values are zero or positive', () => {
      const allocs = [makeAllocation({
        ru_allocated: 0, mu_allocated: 0, eu_allocated: 0, vu_allocated: 0,
        ru_consumed: 0, mu_consumed: 0, eu_consumed: 0, vu_consumed: 0,
      })];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.violations.some(v => v.law === 'NON_NEGATIVE')).toBe(false);
    });
  });

  describe('enforce - no double-counting (Law 7)', () => {
    it('should fail when duplicate allocation IDs exist', () => {
      const id = createUUID() as unknown as AllocationID;
      const allocs = [
        makeAllocation({ id }),
        makeAllocation({ id }),
      ];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.violations.some(v => v.law === 'NO_DOUBLE_COUNTING')).toBe(true);
    });

    it('should pass with unique allocation IDs', () => {
      const allocs = [
        makeAllocation({ ru_allocated: 200 }),
        makeAllocation({ ru_allocated: 300 }),
      ];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.violations.some(v => v.law === 'NO_DOUBLE_COUNTING')).toBe(false);
    });
  });

  describe('enforce - combined violations', () => {
    it('should report multiple violations at once', () => {
      const id = createUUID() as unknown as AllocationID;
      const allocs = [
        makeAllocation({
          id,
          ru_allocated: 600,
          ru_consumed: 700, // per-agent violation + capacity violation
        }),
        makeAllocation({
          id, // duplicate ID
          ru_allocated: 600,
          ru_consumed: -5, // negative
        }),
      ];
      const result = enforcer.enforce(allocs, capacity);
      expect(result.valid).toBe(false);
      expect(result.violations.length).toBeGreaterThan(1);
    });
  });

  describe('checkAllocation', () => {
    it('should check per-agent conservation for a single allocation', () => {
      const alloc = makeAllocation({
        ru_allocated: 100,
        ru_consumed: 50,
      });
      const result = enforcer.checkAllocation(alloc);
      expect(result.valid).toBe(true);
    });

    it('should fail per-agent conservation check', () => {
      const alloc = makeAllocation({
        ru_allocated: 100,
        ru_consumed: 150,
      });
      const result = enforcer.checkAllocation(alloc);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.law === 'PER_AGENT_CONSERVATION')).toBe(true);
    });

    it('should fail non-negative check', () => {
      const alloc = makeAllocation({
        ru_allocated: -5,
      });
      const result = enforcer.checkAllocation(alloc);
      expect(result.valid).toBe(false);
      expect(result.violations.some(v => v.law === 'NON_NEGATIVE')).toBe(true);
    });
  });

  describe('checkCapacity', () => {
    it('should pass when new allocation fits within capacity', () => {
      const existing = [makeAllocation({ ru_allocated: 400, mu_allocated: 200, eu_allocated: 40, vu_allocated: 20 })];
      const newAlloc = makeAllocation({ ru_allocated: 300, mu_allocated: 150, eu_allocated: 30, vu_allocated: 15 });

      const result = enforcer.checkCapacity(existing, newAlloc, capacity);
      expect(result.valid).toBe(true);
    });

    it('should fail when new allocation exceeds capacity', () => {
      const existing = [makeAllocation({ ru_allocated: 800, mu_allocated: 400, eu_allocated: 80, vu_allocated: 40 })];
      const newAlloc = makeAllocation({ ru_allocated: 300, mu_allocated: 150, eu_allocated: 30, vu_allocated: 15 });

      const result = enforcer.checkCapacity(existing, newAlloc, capacity);
      expect(result.valid).toBe(false);
    });

    it('should pass with empty existing allocations', () => {
      const newAlloc = makeAllocation({ ru_allocated: 500, mu_allocated: 250, eu_allocated: 50, vu_allocated: 25 });
      const result = enforcer.checkCapacity([], newAlloc, capacity);
      expect(result.valid).toBe(true);
    });
  });
});