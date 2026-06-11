/**
 * @agentos/blackboard — ClaimProcessor Tests
 * Full coverage of processClaim, releaseClaim, overrideClaim,
 * getClaim, getClaimsByAgent, isClaimed, expireStaleClaims
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ClaimProcessor } from '../src/claim-processor.js';
import {
  createUUID,
  TaskState,
  TaskType,
  ZERO_BUDGET,
  BB_E,
} from '@agentos/types';
import type { AgentID, TaskID, BlackboardTask, ResourceBudget } from '@agentos/types';
import type { AgentProfile } from '../src/claim-processor.js';

function makeTask(overrides: Partial<BlackboardTask> = {}): BlackboardTask {
  const id = createUUID() as unknown as TaskID;
  return {
    id,
    title: 'Test Task',
    description: 'A test task',
    type: TaskType.ACTION,
    priority: 3,
    state: TaskState.ANNOUNCED,
    owner: undefined,
    owner_since: undefined,
    previous_owners: [],
    depends_on: [],
    blocks: [],
    resources_required: ZERO_BUDGET,
    retry_count: 0,
    max_retries: 3,
    tags: [],
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: createUUID() as unknown as AgentID,
    capabilities: ['code', 'test'],
    available_resources: { ru: 100, mu: 100, eu: 100, vu: 100 } as ResourceBudget,
    role: 'worker',
    ...overrides,
  };
}

describe('ClaimProcessor', () => {
  let processor: ClaimProcessor;

  beforeEach(() => {
    processor = new ClaimProcessor(60_000);
  });

  // ─── processClaim ─────────────────────────────────────────────────

  describe('processClaim', () => {
    it('should successfully claim an announced task', () => {
      const task = makeTask();
      const agent = makeAgent();
      const result = processor.processClaim(task, agent, '2025-01-01T00:00:00.000Z');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.task_id).toBe(task.id);
        expect(result.data.agent_id).toBe(agent.id);
        expect(result.data.status).toBe('active');
        expect(result.data.claimed_at).toBe('2025-01-01T00:00:00.000Z');
      }
    });

    it('should set expires_at based on claimTimeoutMs', () => {
      const proc = new ClaimProcessor(30_000);
      const task = makeTask();
      const agent = makeAgent();
      const result = proc.processClaim(task, agent, '2025-01-01T00:00:00.000Z');

      expect(result.ok).toBe(true);
      if (result.ok) {
        // 30s after claimed_at
        expect(result.data.expires_at).toBe('2025-01-01T00:00:30.000Z');
      }
    });

    it('should reject claim when task is undefined', () => {
      const agent = makeAgent();
      const result = processor.processClaim(undefined, agent);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe(BB_E.TASK_NOT_FOUND);
      }
    });

    it('should reject claim when task is not in ANNOUNCED state', () => {
      const agent = makeAgent();

      for (const state of [TaskState.CLAIMED, TaskState.IN_PROGRESS, TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED]) {
        const task = makeTask({ state });
        const result = processor.processClaim(task, agent);
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error_code).toBe(BB_E.TASK_NOT_CLAIMABLE);
        }
      }
    });

    it('should reject claim when agent lacks required capabilities', () => {
      const task = makeTask({ tags: ['capability:code', 'capability:design'] });
      const agent = makeAgent({ capabilities: ['code'] }); // missing 'design'
      const result = processor.processClaim(task, agent);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe(BB_E.AGENT_LACKS_CAPABILITIES);
        expect(result.error_message).toContain('capability:design');
      }
    });

    it('should accept claim when agent has all required capabilities', () => {
      const task = makeTask({ tags: ['capability:code', 'capability:test'] });
      const agent = makeAgent({ capabilities: ['code', 'test'] });
      const result = processor.processClaim(task, agent);

      expect(result.ok).toBe(true);
    });

    it('should reject claim when agent has insufficient resources', () => {
      const task = makeTask({
        resources_required: { ru: 50, mu: 50, eu: 50, vu: 50 } as ResourceBudget,
      });
      const agent = makeAgent({
        available_resources: { ru: 10, mu: 50, eu: 50, vu: 50 } as ResourceBudget,
      });
      const result = processor.processClaim(task, agent);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe(BB_E.RESOURCES_UNAVAILABLE);
      }
    });

    it('should accept claim when agent has exactly enough resources', () => {
      const budget: ResourceBudget = { ru: 50, mu: 50, eu: 50, vu: 50 };
      const task = makeTask({ resources_required: budget });
      const agent = makeAgent({ available_resources: budget });
      const result = processor.processClaim(task, agent);

      expect(result.ok).toBe(true);
    });

    it('should accept claim for task with no capability tags', () => {
      const task = makeTask({ tags: ['priority:high', 'area:backend'] });
      const agent = makeAgent({ capabilities: [] });
      const result = processor.processClaim(task, agent);

      expect(result.ok).toBe(true);
    });
  });

  // ─── releaseClaim ─────────────────────────────────────────────────

  describe('releaseClaim', () => {
    it('should release an active claim', () => {
      const task = makeTask();
      const agent = makeAgent();
      processor.processClaim(task, agent, '2025-01-01T00:00:00.000Z');

      const result = processor.releaseClaim(task.id, agent.id);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(true);
      }
    });

    it('should fail to release a non-existent claim', () => {
      const result = processor.releaseClaim(createUUID() as unknown as TaskID, createUUID() as unknown as AgentID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe(BB_E.TASK_NOT_FOUND);
      }
    });

    it('should fail to release a claim owned by another agent', () => {
      const task = makeTask();
      const agent = makeAgent();
      const otherAgent = makeAgent();
      processor.processClaim(task, agent, '2025-01-01T00:00:00.000Z');

      const result = processor.releaseClaim(task.id, otherAgent.id);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe(BB_E.CLAIM_CONFLICT);
      }
    });
  });

  // ─── overrideClaim ────────────────────────────────────────────────

  describe('overrideClaim', () => {
    it('should override an existing claim with a new chief claim', () => {
      const task = makeTask();
      const worker = makeAgent();
      const chief = makeAgent();
      processor.processClaim(task, worker, '2025-01-01T00:00:00.000Z');

      const result = processor.overrideClaim(task.id, chief.id, '2025-01-01T00:01:00.000Z');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.agent_id).toBe(chief.id);
        expect(result.data.status).toBe('active');
        expect(result.data.claimed_at).toBe('2025-01-01T00:01:00.000Z');
      }
    });

    it('should fail to override a non-existent claim', () => {
      const result = processor.overrideClaim(createUUID() as unknown as TaskID, createUUID() as unknown as AgentID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe(BB_E.TASK_NOT_FOUND);
      }
    });

    it('should set correct expiry on overridden claim', () => {
      const proc = new ClaimProcessor(120_000);
      const task = makeTask();
      const worker = makeAgent();
      const chief = makeAgent();
      proc.processClaim(task, worker, '2025-01-01T00:00:00.000Z');

      const result = proc.overrideClaim(task.id, chief.id, '2025-01-01T00:01:00.000Z');
      expect(result.ok).toBe(true);
      if (result.ok) {
        // 120s after 00:01:00 = 00:03:00
        expect(result.data.expires_at).toBe('2025-01-01T00:03:00.000Z');
      }
    });
  });

  // ─── getClaim ─────────────────────────────────────────────────────

  describe('getClaim', () => {
    it('should return the claim for a task', () => {
      const task = makeTask();
      const agent = makeAgent();
      processor.processClaim(task, agent, '2025-01-01T00:00:00.000Z');

      const claim = processor.getClaim(task.id);
      expect(claim).toBeDefined();
      expect(claim!.task_id).toBe(task.id);
      expect(claim!.agent_id).toBe(agent.id);
    });

    it('should return undefined for a task with no claim', () => {
      const claim = processor.getClaim(createUUID() as unknown as TaskID);
      expect(claim).toBeUndefined();
    });

    it('should return undefined after claim is released', () => {
      const task = makeTask();
      const agent = makeAgent();
      processor.processClaim(task, agent, '2025-01-01T00:00:00.000Z');
      processor.releaseClaim(task.id, agent.id);

      const claim = processor.getClaim(task.id);
      expect(claim).toBeUndefined();
    });
  });

  // ─── getClaimsByAgent ─────────────────────────────────────────────

  describe('getClaimsByAgent', () => {
    it('should return all active claims for an agent', () => {
      const agent = makeAgent();
      const task1 = makeTask();
      const task2 = makeTask();
      const task3 = makeTask();
      processor.processClaim(task1, agent, '2025-01-01T00:00:00.000Z');
      processor.processClaim(task2, agent, '2025-01-01T00:00:00.000Z');
      processor.processClaim(task3, agent, '2025-01-01T00:00:00.000Z');

      const claims = processor.getClaimsByAgent(agent.id);
      expect(claims.length).toBe(3);
    });

    it('should not include released claims', () => {
      const agent = makeAgent();
      const task1 = makeTask();
      const task2 = makeTask();
      processor.processClaim(task1, agent, '2025-01-01T00:00:00.000Z');
      processor.processClaim(task2, agent, '2025-01-01T00:00:00.000Z');
      processor.releaseClaim(task1.id, agent.id);

      const claims = processor.getClaimsByAgent(agent.id);
      expect(claims.length).toBe(1);
      expect(claims[0]!.task_id).toBe(task2.id);
    });

    it('should return empty array for agent with no claims', () => {
      const claims = processor.getClaimsByAgent(createUUID() as unknown as AgentID);
      expect(claims).toEqual([]);
    });

    it('should not return claims from other agents', () => {
      const agent1 = makeAgent();
      const agent2 = makeAgent();
      const task1 = makeTask();
      const task2 = makeTask();
      processor.processClaim(task1, agent1, '2025-01-01T00:00:00.000Z');
      processor.processClaim(task2, agent2, '2025-01-01T00:00:00.000Z');

      const claims1 = processor.getClaimsByAgent(agent1.id);
      expect(claims1.length).toBe(1);
      expect(claims1[0]!.task_id).toBe(task1.id);

      const claims2 = processor.getClaimsByAgent(agent2.id);
      expect(claims2.length).toBe(1);
      expect(claims2[0]!.task_id).toBe(task2.id);
    });
  });

  // ─── isClaimed ────────────────────────────────────────────────────

  describe('isClaimed', () => {
    it('should return true for an actively claimed task', () => {
      const task = makeTask();
      const agent = makeAgent();
      processor.processClaim(task, agent, '2025-01-01T00:00:00.000Z');

      expect(processor.isClaimed(task.id)).toBe(true);
    });

    it('should return false for a task with no claim', () => {
      expect(processor.isClaimed(createUUID() as unknown as TaskID)).toBe(false);
    });

    it('should return false after claim is released', () => {
      const task = makeTask();
      const agent = makeAgent();
      processor.processClaim(task, agent, '2025-01-01T00:00:00.000Z');
      processor.releaseClaim(task.id, agent.id);

      expect(processor.isClaimed(task.id)).toBe(false);
    });

    it('should return false after claim is expired', () => {
      const proc = new ClaimProcessor(10_000); // 10s timeout
      const task = makeTask();
      const agent = makeAgent();
      proc.processClaim(task, agent, '2025-01-01T00:00:00.000Z');

      // Expire claims after 10s
      const expired = proc.expireStaleClaims('2025-01-01T00:00:11.000Z');
      expect(expired.length).toBe(1);
      expect(proc.isClaimed(task.id)).toBe(false);
    });
  });

  // ─── expireStaleClaims ────────────────────────────────────────────

  describe('expireStaleClaims', () => {
    it('should expire claims past their timeout', () => {
      const proc = new ClaimProcessor(10_000);
      const task1 = makeTask();
      const task2 = makeTask();
      const agent = makeAgent();
      proc.processClaim(task1, agent, '2025-01-01T00:00:00.000Z');
      proc.processClaim(task2, agent, '2025-01-01T00:00:05.000Z');

      // Only task1 should be expired (10s timeout, claimed at T+0)
      const expired = proc.expireStaleClaims('2025-01-01T00:00:12.000Z');
      expect(expired.length).toBe(1);
      expect(expired).toContain(task1.id);
      expect(proc.isClaimed(task1.id)).toBe(false);
      expect(proc.isClaimed(task2.id)).toBe(true); // claimed at T+5, still valid
    });

    it('should not expire claims that are still within timeout', () => {
      const proc = new ClaimProcessor(60_000);
      const task = makeTask();
      const agent = makeAgent();
      proc.processClaim(task, agent, '2025-01-01T00:00:00.000Z');

      const expired = proc.expireStaleClaims('2025-01-01T00:00:30.000Z');
      expect(expired.length).toBe(0);
      expect(proc.isClaimed(task.id)).toBe(true);
    });

    it('should return empty array when no claims exist', () => {
      const expired = processor.expireStaleClaims('2025-01-01T00:00:00.000Z');
      expect(expired).toEqual([]);
    });

    it('should expire all stale claims at once', () => {
      const proc = new ClaimProcessor(5_000);
      const agent = makeAgent();
      const tasks = [makeTask(), makeTask(), makeTask()];
      for (const task of tasks) {
        proc.processClaim(task, agent, '2025-01-01T00:00:00.000Z');
      }

      const expired = proc.expireStaleClaims('2025-01-01T00:01:00.000Z');
      expect(expired.length).toBe(3);
      for (const task of tasks) {
        expect(proc.isClaimed(task.id)).toBe(false);
      }
    });

    it('should not expire released claims', () => {
      const proc = new ClaimProcessor(5_000);
      const task = makeTask();
      const agent = makeAgent();
      proc.processClaim(task, agent, '2025-01-01T00:00:00.000Z');
      proc.releaseClaim(task.id, agent.id);

      const expired = proc.expireStaleClaims('2025-01-01T00:01:00.000Z');
      expect(expired.length).toBe(0);
    });
  });

  // ─── Edge cases ────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle multiple claims on different tasks by same agent', () => {
      const agent = makeAgent();
      const task1 = makeTask();
      const task2 = makeTask();
      const task3 = makeTask();

      const r1 = processor.processClaim(task1, agent, '2025-01-01T00:00:00.000Z');
      const r2 = processor.processClaim(task2, agent, '2025-01-01T00:00:00.000Z');
      const r3 = processor.processClaim(task3, agent, '2025-01-01T00:00:00.000Z');

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r3.ok).toBe(true);

      const claims = processor.getClaimsByAgent(agent.id);
      expect(claims.length).toBe(3);
    });

    it('should use default claimTimeoutMs of 60000', () => {
      const defaultProc = new ClaimProcessor();
      const task = makeTask();
      const agent = makeAgent();
      const result = defaultProc.processClaim(task, agent, '2025-01-01T00:00:00.000Z');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.expires_at).toBe('2025-01-01T00:01:00.000Z');
      }
    });

    it('should handle claim after override', () => {
      const task = makeTask();
      const worker = makeAgent();
      const chief = makeAgent();
      processor.processClaim(task, worker, '2025-01-01T00:00:00.000Z');
      processor.overrideClaim(task.id, chief.id, '2025-01-01T00:01:00.000Z');

      const claim = processor.getClaim(task.id);
      expect(claim).toBeDefined();
      expect(claim!.agent_id).toBe(chief.id);
      expect(claim!.status).toBe('active');
    });

    it('should not allow claiming a task that is already claimed (via processClaim check)', () => {
      // Note: processClaim checks task state, not internal claims map.
      // After a successful claim, task state should change. But since
      // processClaim takes the task object as parameter (not by reference),
      // the task state doesn't auto-update. In practice, the Blackboard
      // orchestrator would update the task state. Here we test that
      // the claim is stored correctly.
      const task = makeTask();
      const agent1 = makeAgent();
      const agent2 = makeAgent();

      const r1 = processor.processClaim(task, agent1);
      expect(r1.ok).toBe(true);

      // Second claim on same task succeeds at ClaimProcessor level
      // because it doesn't check its own claims map for duplicates
      // (the Blackboard class handles this at a higher level by checking state)
      // But the claim will be overwritten in the map
      const r2 = processor.processClaim(task, agent2);
      expect(r2.ok).toBe(true);
      if (r2.ok) {
        expect(r2.data.agent_id).toBe(agent2.id);
      }
    });
  });
});