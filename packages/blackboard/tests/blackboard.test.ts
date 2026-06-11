/**
 * @agentos/blackboard — Blackboard Tests
 * Full lifecycle, 10-agent competition, zero double-claims
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Blackboard,
} from '../src/blackboard.js';
import {
  createUUID,
  asUUID,
  TaskState,
  TaskType,
  ZERO_BUDGET,
  type AgentID,
  type TaskID,
  type WorkspaceID,
  type BlackboardTask,
} from '@agentos/types';

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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('Blackboard', () => {
  let blackboard: Blackboard;
  const workspaceId = createUUID() as unknown as WorkspaceID;

  beforeEach(() => {
    blackboard = new Blackboard(workspaceId);
  });

  describe('task lifecycle', () => {
    it('should publish a task', () => {
      const task = makeTask();
      const result = blackboard.publishTask(task);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe(task.id);
      }
    });

    it('should not publish duplicate task', () => {
      const task = makeTask();
      blackboard.publishTask(task);
      const result = blackboard.publishTask(task);
      expect(result.ok).toBe(false);
    });

    it('should claim a task', () => {
      const task = makeTask();
      blackboard.publishTask(task);
      const agentId = createUUID() as unknown as AgentID;
      const result = blackboard.claimTask(task.id, agentId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.agent_id).toBe(agentId);
        expect(result.data.task_id).toBe(task.id);
      }
    });

    it('should update task state to claimed after claim', () => {
      const task = makeTask();
      blackboard.publishTask(task);
      const agentId = createUUID() as unknown as AgentID;
      blackboard.claimTask(task.id, agentId);
      const stored = blackboard.getTask(task.id);
      expect(stored?.state).toBe(TaskState.CLAIMED);
      expect(stored?.owner).toBe(agentId);
    });

    it('should not claim a non-existent task', () => {
      const agentId = createUUID() as unknown as AgentID;
      const result = blackboard.claimTask(createUUID() as unknown as TaskID, agentId);
      expect(result.ok).toBe(false);
    });

    it('should release a claim', () => {
      const task = makeTask();
      blackboard.publishTask(task);
      const agentId = createUUID() as unknown as AgentID;
      blackboard.claimTask(task.id, agentId);
      const result = blackboard.releaseClaim(task.id, agentId, 'done');
      expect(result.ok).toBe(true);
      const stored = blackboard.getTask(task.id);
      expect(stored?.state).toBe(TaskState.ANNOUNCED);
      expect(stored?.owner).toBeUndefined();
    });

    it('should track previous owners after release', () => {
      const task = makeTask();
      blackboard.publishTask(task);
      const agentId = createUUID() as unknown as AgentID;
      blackboard.claimTask(task.id, agentId);
      blackboard.releaseClaim(task.id, agentId, 'testing');
      const stored = blackboard.getTask(task.id);
      expect(stored?.previous_owners.length).toBe(1);
      expect(stored?.previous_owners[0]?.agent_id).toBe(agentId);
    });

    it('should override a claim', () => {
      const task = makeTask();
      blackboard.publishTask(task);
      const agentId = createUUID() as unknown as AgentID;
      const chiefId = createUUID() as unknown as AgentID;
      blackboard.claimTask(task.id, agentId);
      const result = blackboard.overrideClaim(task.id, chiefId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.agent_id).toBe(chiefId);
      }
    });
  });

  describe('result operations', () => {
    it('should submit a result', () => {
      const task = makeTask();
      blackboard.publishTask(task);
      const agentId = createUUID() as unknown as AgentID;
      blackboard.claimTask(task.id, agentId);

      const result = blackboard.submitResult({
        task_id: task.id,
        agent_id: agentId,
        output: { message: 'done' },
        confidence: 0.95,
        resources_consumed: ZERO_BUDGET,
        artifacts: [],
        duration_ms: 5000,
        completed_at: new Date().toISOString(),
      });
      expect(result.ok).toBe(true);
    });

    it('should validate a result', () => {
      const task = makeTask();
      blackboard.publishTask(task);
      const agentId = createUUID() as unknown as AgentID;
      const validatorId = createUUID() as unknown as AgentID;

      blackboard.claimTask(task.id, agentId);
      blackboard.submitResult({
        task_id: task.id,
        agent_id: agentId,
        output: 'done',
        confidence: 0.9,
        resources_consumed: ZERO_BUDGET,
        artifacts: [],
        duration_ms: 1000,
        completed_at: new Date().toISOString(),
      });

      const result = blackboard.validateResult(task.id, validatorId, true, 'looks good');
      expect(result.ok).toBe(true);

      const stored = blackboard.getTask(task.id);
      expect(stored?.state).toBe(TaskState.COMPLETED);
    });
  });

  describe('context operations', () => {
    it('should write and read context', () => {
      const agentId = createUUID() as unknown as AgentID;
      blackboard.writeContext({
        key: 'test-key',
        value: { data: 42 },
        source_agent: agentId,
        confidence: 0.9,
        scope: 'workspace',
        tags: [],
        updated_at: new Date().toISOString(),
        version: 1,
      });
      const entry = blackboard.readContext('test-key');
      expect(entry).toBeDefined();
      expect(entry?.value).toEqual({ data: 42 });
    });

    it('should soft delete context', () => {
      const agentId = createUUID() as unknown as AgentID;
      blackboard.writeContext({
        key: 'test-key',
        value: 'hello',
        source_agent: agentId,
        confidence: 1.0,
        scope: 'workspace',
        tags: [],
        updated_at: new Date().toISOString(),
        version: 1,
      });
      const result = blackboard.deleteContext('test-key');
      expect(result.ok).toBe(true);
      const entry = blackboard.readContext('test-key');
      expect(entry?.value).toBeNull();
    });

    it('should version context entries', () => {
      const agentId = createUUID() as unknown as AgentID;
      const base = {
        source_agent: agentId,
        confidence: 0.9,
        scope: 'workspace',
        tags: [],
        updated_at: new Date().toISOString(),
      };

      blackboard.writeContext({ key: 'v', value: 1, ...base, version: 1 });
      blackboard.writeContext({ key: 'v', value: 2, ...base, version: 1 });

      const entry = blackboard.readContext('v');
      expect(entry?.version).toBe(2);
      expect(entry?.value).toBe(2);
    });
  });

  describe('consensus operations', () => {
    it('should create, vote on, and resolve consensus', () => {
      const proposerId = createUUID() as unknown as AgentID;
      const voter1 = createUUID() as unknown as AgentID;
      const voter2 = createUUID() as unknown as AgentID;
      const consensusId = createUUID();

      const result = blackboard.createConsensus({
        id: consensusId as any,
        topic: 'Which approach?',
        proposer: proposerId,
        options: [
          { label: 'A', description: 'Option A' },
          { label: 'B', description: 'Option B' },
        ],
        votes: [],
        strategy: 'majority',
        status: 'voting',
        deadline: new Date(Date.now() + 60000).toISOString(),
        created_at: new Date().toISOString(),
      });
      expect(result.ok).toBe(true);

      blackboard.vote(consensusId, voter1, 'A');
      blackboard.vote(consensusId, voter2, 'A');

      const resolved = blackboard.resolveConsensus(consensusId);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.data.result).toBe('A');
        expect(resolved.data.status).toBe('resolved');
      }
    });
  });

  describe('query operations', () => {
    it('should get available tasks matching capabilities', () => {
      blackboard.publishTask(makeTask({ tags: ['capability:code', 'capability:test'] }));
      blackboard.publishTask(makeTask({ tags: ['capability:code'] }));
      blackboard.publishTask(makeTask({ tags: ['capability:design'] }));

      const available = blackboard.getAvailableTasks(['code', 'test']);
      expect(available.length).toBe(2);
    });

    it('should return all tasks with no capability requirements', () => {
      blackboard.publishTask(makeTask());
      blackboard.publishTask(makeTask());

      const available = blackboard.getAvailableTasks(['anything']);
      expect(available.length).toBe(2);
    });

    it('should get claims by agent', () => {
      const task1 = makeTask();
      const task2 = makeTask();
      const agentId = createUUID() as unknown as AgentID;
      blackboard.publishTask(task1);
      blackboard.publishTask(task2);
      blackboard.claimTask(task1.id, agentId);
      blackboard.claimTask(task2.id, agentId);

      const claims = blackboard.getClaimsByAgent(agentId);
      expect(claims.length).toBe(2);
    });
  });

  describe('audit chain', () => {
    it('should maintain audit log', () => {
      const task = makeTask();
      blackboard.publishTask(task);
      const agentId = createUUID() as unknown as AgentID;
      blackboard.claimTask(task.id, agentId);

      const log = blackboard.getAuditLog();
      expect(log.length).toBeGreaterThanOrEqual(2);
    });

    it('should verify audit chain integrity', () => {
      const task = makeTask();
      blackboard.publishTask(task);
      const agentId = createUUID() as unknown as AgentID;
      blackboard.claimTask(task.id, agentId);

      expect(blackboard.verifyAuditChain()).toBe(true);
    });

    it('should limit audit log results', () => {
      const task = makeTask();
      blackboard.publishTask(task);
      const agentId = createUUID() as unknown as AgentID;
      blackboard.claimTask(task.id, agentId);

      const log = blackboard.getAuditLog(1);
      expect(log.length).toBe(1);
    });
  });

  // CRITICAL TEST: Zero Double-Claims
  describe('zero double-claims (10 agents, 5 tasks)', () => {
    it('should never allow two agents to claim the same task', () => {
      // Create 5 announced tasks
      const tasks: BlackboardTask[] = [];
      for (let i = 0; i < 5; i++) {
        const task = makeTask({ title: `Task ${i}` });
        blackboard.publishTask(task);
        tasks.push(task);
      }

      // Create 10 agents that all try to claim all 5 tasks simultaneously
      const agents: AgentID[] = [];
      for (let i = 0; i < 10; i++) {
        agents.push(createUUID() as unknown as AgentID);
      }

      // All agents attempt to claim all tasks
      // In a single-threaded test, claims are processed sequentially,
      // but the first agent to claim wins and all subsequent agents fail
      const claimResults: Map<TaskID, AgentID[]> = new Map();

      for (const taskId of tasks.map((t) => t.id)) {
        claimResults.set(taskId, []);
      }

      for (const agentId of agents) {
        for (const task of tasks) {
          const result = blackboard.claimTask(task.id, agentId);
          if (result.ok) {
            const claimants = claimResults.get(task.id) ?? [];
            claimants.push(agentId);
            claimResults.set(task.id, claimants);
          }
        }
      }

      // Verify: each task is claimed by at most 1 agent
      for (const [taskId, claimants] of claimResults) {
        expect(claimants.length).toBeLessThanOrEqual(1);
      }

      // Verify: total claims equal number of tasks (5)
      const totalSuccessfulClaims = [...claimResults.values()]
        .reduce((sum, claimants) => sum + claimants.length, 0);
      expect(totalSuccessfulClaims).toBe(5);
    });

    it('should handle concurrent claim attempts on the same task', () => {
      const task = makeTask();
      blackboard.publishTask(task);

      const agents: AgentID[] = [];
      for (let i = 0; i < 10; i++) {
        agents.push(createUUID() as unknown as AgentID);
      }

      // All 10 agents try to claim the same task
      let successfulClaims = 0;
      let failedClaims = 0;

      for (const agentId of agents) {
        const result = blackboard.claimTask(task.id, agentId);
        if (result.ok) {
          successfulClaims++;
        } else {
          failedClaims++;
        }
      }

      // Exactly 1 successful claim, 9 failures
      expect(successfulClaims).toBe(1);
      expect(failedClaims).toBe(9);

      // Task should be in claimed state
      const storedTask = blackboard.getTask(task.id);
      expect(storedTask?.state).toBe(TaskState.CLAIMED);
    });
  });
});