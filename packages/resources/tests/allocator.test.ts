import { describe, it, expect, beforeEach } from 'vitest';
import { AllocationStateMachine, type AllocationRecord } from '../src/allocator.js';
import { AllocationState, KER } from '@agentos/types';
import { createUUID } from '@agentos/types';
import type { AgentID, WorkspaceID, AllocationID, TaskID, Priority, ISO8601 } from '@agentos/types';

function makeUUID(): string {
  return createUUID();
}

function makeAgentId(): AgentID {
  return makeUUID() as unknown as AgentID;
}

function makeWorkspaceId(): WorkspaceID {
  return makeUUID() as unknown as WorkspaceID;
}

function makeAllocationId(): AllocationID {
  return makeUUID() as unknown as AllocationID;
}

function makeTaskId(): TaskID {
  return makeUUID() as unknown as TaskID;
}

// Helper to create a base AllocationRecord in a given state
function makeRecord(overrides: Partial<AllocationRecord> = {}): AllocationRecord {
  const now = new Date().toISOString() as ISO8601;
  return {
    id: makeAllocationId(),
    agent_id: makeAgentId(),
    workspace_id: makeWorkspaceId(),
    state: AllocationState.PENDING,
    priority: 3 as Priority,
    preemptible: true,
    ru_allocated: 100,
    mu_allocated: 50,
    eu_allocated: 10,
    vu_allocated: 5,
    ru_consumed: 0,
    mu_consumed: 0,
    eu_consumed: 0,
    vu_consumed: 0,
    created_at: now,
    updated_at: now,
    preemption_count: 0,
    throttle_level: 0,
    ...overrides,
  };
}

describe('AllocationStateMachine', () => {
  let sm: AllocationStateMachine;

  beforeEach(() => {
    sm = new AllocationStateMachine();
  });

  describe('createPending', () => {
    it('should create a record in PENDING state with zero consumption', () => {
      const id = makeAllocationId();
      const agentId = makeAgentId();
      const workspaceId = makeWorkspaceId();

      const record = sm.createPending(id, agentId, workspaceId, 3 as Priority, true, 100, 50, 10, 5);

      expect(record.id).toBe(id);
      expect(record.agent_id).toBe(agentId);
      expect(record.workspace_id).toBe(workspaceId);
      expect(record.state).toBe(AllocationState.PENDING);
      expect(record.priority).toBe(3);
      expect(record.preemptible).toBe(true);
      expect(record.ru_allocated).toBe(100);
      expect(record.mu_allocated).toBe(50);
      expect(record.eu_allocated).toBe(10);
      expect(record.vu_allocated).toBe(5);
      expect(record.ru_consumed).toBe(0);
      expect(record.mu_consumed).toBe(0);
      expect(record.eu_consumed).toBe(0);
      expect(record.vu_consumed).toBe(0);
      expect(record.preemption_count).toBe(0);
      expect(record.throttle_level).toBe(0);
      expect(record.created_at).toBeTruthy();
      expect(record.updated_at).toBeTruthy();
    });

    it('should create a record with optional taskId and expiresAt', () => {
      const taskId = makeUUID() as unknown as TaskID;
      const expiresAt = '2026-12-31T23:59:59.000Z' as ISO8601;
      const record = sm.createPending(
        makeAllocationId(),
        makeAgentId(),
        makeWorkspaceId(),
        1 as Priority,
        false,
        50, 20, 5, 2,
        { taskId, expiresAt },
      );

      expect(record.task_id).toBe(taskId);
      expect(record.expires_at).toBe(expiresAt);
      expect(record.priority).toBe(1);
      expect(record.preemptible).toBe(false);
    });
  });

  describe('isTerminal', () => {
    it('should identify terminal states', () => {
      expect(sm.isTerminal(AllocationState.RELEASED)).toBe(true);
      expect(sm.isTerminal(AllocationState.EXPIRED)).toBe(true);
      expect(sm.isTerminal(AllocationState.REVOKED)).toBe(true);
    });

    it('should identify non-terminal states', () => {
      expect(sm.isTerminal(AllocationState.PENDING)).toBe(false);
      expect(sm.isTerminal(AllocationState.GRANTED)).toBe(false);
      expect(sm.isTerminal(AllocationState.ACTIVE)).toBe(false);
      expect(sm.isTerminal(AllocationState.THROTTLED)).toBe(false);
      expect(sm.isTerminal(AllocationState.PREEMPTED)).toBe(false);
    });
  });

  describe('getValidTransitions', () => {
    it('should return correct transitions for PENDING', () => {
      const transitions = sm.getValidTransitions(AllocationState.PENDING);
      expect(transitions).toContain(AllocationState.GRANTED);
      expect(transitions).toContain(AllocationState.REVOKED);
      expect(transitions).toHaveLength(2);
    });

    it('should return correct transitions for GRANTED', () => {
      const transitions = sm.getValidTransitions(AllocationState.GRANTED);
      expect(transitions).toContain(AllocationState.ACTIVE);
      expect(transitions).toContain(AllocationState.EXPIRED);
      expect(transitions).toHaveLength(2);
    });

    it('should return correct transitions for ACTIVE', () => {
      const transitions = sm.getValidTransitions(AllocationState.ACTIVE);
      expect(transitions).toContain(AllocationState.THROTTLED);
      expect(transitions).toContain(AllocationState.PREEMPTED);
      expect(transitions).toContain(AllocationState.RELEASED);
      expect(transitions).toContain(AllocationState.EXPIRED);
      expect(transitions).toContain(AllocationState.REVOKED);
      expect(transitions).toHaveLength(5);
    });

    it('should return correct transitions for THROTTLED', () => {
      const transitions = sm.getValidTransitions(AllocationState.THROTTLED);
      expect(transitions).toContain(AllocationState.ACTIVE);
      expect(transitions).toContain(AllocationState.PREEMPTED);
      expect(transitions).toContain(AllocationState.RELEASED);
      expect(transitions).toHaveLength(3);
    });

    it('should return correct transitions for PREEMPTED', () => {
      const transitions = sm.getValidTransitions(AllocationState.PREEMPTED);
      expect(transitions).toContain(AllocationState.PENDING);
      expect(transitions).toHaveLength(1);
    });

    it('should return empty array for terminal states', () => {
      expect(sm.getValidTransitions(AllocationState.RELEASED)).toHaveLength(0);
      expect(sm.getValidTransitions(AllocationState.EXPIRED)).toHaveLength(0);
      expect(sm.getValidTransitions(AllocationState.REVOKED)).toHaveLength(0);
    });
  });

  describe('transition', () => {
    it('should successfully transition PENDING -> GRANTED', () => {
      const record = makeRecord({ state: AllocationState.PENDING });
      const result = sm.transition(record, AllocationState.GRANTED);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.state).toBe(AllocationState.GRANTED);
        expect(result.data.granted_at).toBeTruthy();
        expect(result.data.updated_at).toBeTruthy();
      }
    });

    it('should successfully transition GRANTED -> ACTIVE', () => {
      const record = makeRecord({ state: AllocationState.GRANTED });
      const result = sm.transition(record, AllocationState.ACTIVE);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.state).toBe(AllocationState.ACTIVE);
        expect(result.data.active_since).toBeTruthy();
      }
    });

    it('should successfully transition ACTIVE -> RELEASED', () => {
      const record = makeRecord({ state: AllocationState.ACTIVE });
      const result = sm.transition(record, AllocationState.RELEASED);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.state).toBe(AllocationState.RELEASED);
        expect(result.data.released_at).toBeTruthy();
      }
    });

    it('should successfully transition ACTIVE -> PREEMPTED and increment preemption_count', () => {
      const record = makeRecord({ state: AllocationState.ACTIVE, preemption_count: 0 });
      const result = sm.transition(record, AllocationState.PREEMPTED);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.state).toBe(AllocationState.PREEMPTED);
        expect(result.data.preemption_count).toBe(1);
      }
    });

    it('should increment preemption_count from a non-zero value', () => {
      const record = makeRecord({ state: AllocationState.ACTIVE, preemption_count: 3 });
      const result = sm.transition(record, AllocationState.PREEMPTED);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.preemption_count).toBe(4);
      }
    });

    it('should successfully transition THROTTLED -> ACTIVE', () => {
      const record = makeRecord({ state: AllocationState.THROTTLED });
      const result = sm.transition(record, AllocationState.ACTIVE);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.state).toBe(AllocationState.ACTIVE);
      }
    });

    it('should successfully transition PREEMPTED -> PENDING', () => {
      const record = makeRecord({ state: AllocationState.PREEMPTED });
      const result = sm.transition(record, AllocationState.PENDING);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.state).toBe(AllocationState.PENDING);
      }
    });

    it('should reject invalid transition PENDING -> ACTIVE', () => {
      const record = makeRecord({ state: AllocationState.PENDING });
      const result = sm.transition(record, AllocationState.ACTIVE);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe(KER.INVALID_STATE_TRANSITION);
      }
    });

    it('should reject invalid transition ACTIVE -> PENDING', () => {
      const record = makeRecord({ state: AllocationState.ACTIVE });
      const result = sm.transition(record, AllocationState.PENDING);

      expect(result.ok).toBe(false);
    });

    it('should reject transition from terminal state RELEASED', () => {
      const record = makeRecord({ state: AllocationState.RELEASED });
      const result = sm.transition(record, AllocationState.PENDING);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe(KER.INVALID_STATE_TRANSITION);
      }
    });

    it('should reject transition from terminal state EXPIRED', () => {
      const record = makeRecord({ state: AllocationState.EXPIRED });
      const result = sm.transition(record, AllocationState.PENDING);

      expect(result.ok).toBe(false);
    });

    it('should reject transition from terminal state REVOKED', () => {
      const record = makeRecord({ state: AllocationState.REVOKED });
      const result = sm.transition(record, AllocationState.GRANTED);

      expect(result.ok).toBe(false);
    });

    it('should preserve original record fields on transition', () => {
      const record = makeRecord({
        state: AllocationState.PENDING,
        ru_allocated: 200,
        mu_allocated: 100,
        priority: 1 as Priority,
      });
      const result = sm.transition(record, AllocationState.GRANTED);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.ru_allocated).toBe(200);
        expect(result.data.mu_allocated).toBe(100);
        expect(result.data.priority).toBe(1);
        expect(result.data.id).toBe(record.id);
        expect(result.data.agent_id).toBe(record.agent_id);
      }
    });

    it('should set throttle_level externally (not changed by transition to THROTTLED)', () => {
      const record = makeRecord({ state: AllocationState.ACTIVE, throttle_level: 0 });
      const result = sm.transition(record, AllocationState.THROTTLED);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.state).toBe(AllocationState.THROTTLED);
        // throttle_level is not changed by the transition itself
        expect(result.data.throttle_level).toBe(0);
      }
    });
  });
});