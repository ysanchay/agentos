/**
 * @agentos/blackboard — ConflictResolver Tests
 * Full coverage of registerConflict, vote, resolveConflict
 * with all four strategies: first-wins, vote, chief-decides, merge
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictResolver } from '../src/conflict-resolver.js';
import {
  createUUID,
  BB_E,
} from '@agentos/types';
import type { AgentID, TaskID, TaskResult, ConflictStrategy, ResourceBudget } from '@agentos/types';

const ZERO_BUDGET: ResourceBudget = { ru: 0, mu: 0, eu: 0, vu: 0 };

function makeResult(overrides: Partial<TaskResult> = {}): TaskResult {
  return {
    task_id: createUUID() as unknown as TaskID,
    agent_id: createUUID() as unknown as AgentID,
    output: 'result data',
    confidence: 0.9,
    resources_consumed: { ru: 1, mu: 1, eu: 1, vu: 1 },
    artifacts: [],
    duration_ms: 1000,
    completed_at: '2025-01-01T00:00:01.000Z',
    ...overrides,
  };
}

describe('ConflictResolver', () => {
  let resolver: ConflictResolver;

  beforeEach(() => {
    resolver = new ConflictResolver();
  });

  // ─── registerConflict ─────────────────────────────────────────────

  describe('registerConflict', () => {
    it('should register a conflict with at least 2 results', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult();
      const result2 = makeResult();

      const result = resolver.registerConflict(taskId, [result1, result2], 'first-wins');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.task_id).toBe(taskId);
        expect(result.data.results.length).toBe(2);
        expect(result.data.strategy).toBe('first-wins');
        expect(result.data.resolved).toBe(false);
        expect(result.data.votes).toEqual([]);
      }
    });

    it('should reject conflict with fewer than 2 results', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult();

      const single = resolver.registerConflict(taskId, [result1], 'first-wins');
      expect(single.ok).toBe(false);
      if (!single.ok) {
        expect(single.error_code).toBe(BB_E.VALIDATION_FAILED);
        expect(single.error_message).toContain('at least 2');
      }

      const empty = resolver.registerConflict(taskId, [], 'first-wins');
      expect(empty.ok).toBe(false);
    });

    it('should register conflict with all four strategy types', () => {
      const strategies: ConflictStrategy[] = ['first-wins', 'vote', 'chief-decides', 'merge'];
      for (const strategy of strategies) {
        const r = new ConflictResolver();
        const taskId = createUUID() as unknown as TaskID;
        const result = r.registerConflict(taskId, [makeResult(), makeResult()], strategy);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.strategy).toBe(strategy);
        }
      }
    });
  });

  // ─── vote ──────────────────────────────────────────────────────────

  describe('vote', () => {
    it('should cast a vote for a result in a conflict', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult();
      const result2 = makeResult();
      resolver.registerConflict(taskId, [result1, result2], 'vote');

      const voter = createUUID() as unknown as AgentID;
      const voteResult = resolver.vote(taskId, voter, result1.agent_id);

      expect(voteResult.ok).toBe(true);
      if (voteResult.ok) {
        expect(voteResult.data).toBe(true);
      }
    });

    it('should reject vote for a non-existent conflict', () => {
      const voter = createUUID() as unknown as AgentID;
      const result = resolver.vote(createUUID() as unknown as TaskID, voter, createUUID() as unknown as AgentID);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe(BB_E.TASK_NOT_FOUND);
      }
    });

    it('should reject duplicate vote from same agent', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult();
      const result2 = makeResult();
      resolver.registerConflict(taskId, [result1, result2], 'vote');

      const voter = createUUID() as unknown as AgentID;
      resolver.vote(taskId, voter, result1.agent_id);
      const duplicate = resolver.vote(taskId, voter, result1.agent_id);

      expect(duplicate.ok).toBe(false);
      if (!duplicate.ok) {
        expect(duplicate.error_code).toBe(BB_E.VALIDATION_FAILED);
        expect(duplicate.error_message).toContain('already voted');
      }
    });

    it('should allow different agents to vote', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult();
      const result2 = makeResult();
      resolver.registerConflict(taskId, [result1, result2], 'vote');

      const voter1 = createUUID() as unknown as AgentID;
      const voter2 = createUUID() as unknown as AgentID;

      expect(resolver.vote(taskId, voter1, result1.agent_id).ok).toBe(true);
      expect(resolver.vote(taskId, voter2, result2.agent_id).ok).toBe(true);
    });
  });

  // ─── resolveConflict ──────────────────────────────────────────────

  describe('resolveConflict — first-wins strategy', () => {
    it('should resolve with the earliest result', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult({ completed_at: '2025-01-01T00:00:01.000Z' });
      const result2 = makeResult({ completed_at: '2025-01-01T00:00:02.000Z' });
      resolver.registerConflict(taskId, [result1, result2], 'first-wins');

      const resolved = resolver.resolveConflict(taskId, 'first-wins');
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.data.agent_id).toBe(result1.agent_id);
      }
    });

    it('should pick the earlier result when results arrive in reverse order', () => {
      const taskId = createUUID() as unknown as TaskID;
      const earlier = makeResult({ completed_at: '2025-01-01T00:00:00.000Z' });
      const later = makeResult({ completed_at: '2025-01-01T00:00:05.000Z' });
      // Results are registered with later first
      resolver.registerConflict(taskId, [later, earlier], 'first-wins');

      const resolved = resolver.resolveConflict(taskId, 'first-wins');
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        // First-wins sorts by completion time, not array order
        expect(resolved.data.completed_at).toBe('2025-01-01T00:00:00.000Z');
      }
    });
  });

  describe('resolveConflict — vote strategy', () => {
    it('should resolve with majority vote winner', () => {
      const taskId = createUUID() as unknown as TaskID;
      const resultA = makeResult();
      const resultB = makeResult();
      resolver.registerConflict(taskId, [resultA, resultB], 'vote');

      const voter1 = createUUID() as unknown as AgentID;
      const voter2 = createUUID() as unknown as AgentID;
      const voter3 = createUUID() as unknown as AgentID;

      // 2 votes for A, 1 for B
      resolver.vote(taskId, voter1, resultA.agent_id);
      resolver.vote(taskId, voter2, resultA.agent_id);
      resolver.vote(taskId, voter3, resultB.agent_id);

      const resolved = resolver.resolveConflict(taskId, 'vote');
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.data.agent_id).toBe(resultA.agent_id);
      }
    });

    it('should fall back to first-wins when no majority', () => {
      const taskId = createUUID() as unknown as TaskID;
      const resultA = makeResult({ completed_at: '2025-01-01T00:00:01.000Z' });
      const resultB = makeResult({ completed_at: '2025-01-01T00:00:02.000Z' });
      resolver.registerConflict(taskId, [resultA, resultB], 'vote');

      // 1 vote each — no majority (>50% of 2 = need 2 votes)
      const voter1 = createUUID() as unknown as AgentID;
      const voter2 = createUUID() as unknown as AgentID;
      resolver.vote(taskId, voter1, resultA.agent_id);
      resolver.vote(taskId, voter2, resultB.agent_id);

      const resolved = resolver.resolveConflict(taskId, 'vote');
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        // Falls back to first-wins (earliest completion)
        expect(resolved.data.completed_at).toBe('2025-01-01T00:00:01.000Z');
      }
    });

    it('should return error when no votes are cast', () => {
      const taskId = createUUID() as unknown as TaskID;
      const resultA = makeResult();
      const resultB = makeResult();
      resolver.registerConflict(taskId, [resultA, resultB], 'vote');

      const resolved = resolver.resolveConflict(taskId, 'vote');
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) {
        expect(resolved.error_code).toBe(BB_E.VALIDATION_FAILED);
        expect(resolved.error_message).toContain('No votes cast');
      }
    });
  });

  describe('resolveConflict — chief-decides strategy', () => {
    it('should pick the chief agent result when available', () => {
      const chiefId = createUUID() as unknown as AgentID;
      const taskId = createUUID() as unknown as TaskID;
      const chiefResult = makeResult({ agent_id: chiefId, confidence: 0.7 });
      const workerResult = makeResult({ confidence: 0.9 });
      resolver.registerConflict(taskId, [chiefResult, workerResult], 'chief-decides');

      const resolved = resolver.resolveConflict(taskId, 'chief-decides', chiefId);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.data.agent_id).toBe(chiefId);
      }
    });

    it('should pick highest confidence result when chief has no result', () => {
      const chiefId = createUUID() as unknown as AgentID;
      const taskId = createUUID() as unknown as TaskID;
      const lowConf = makeResult({ confidence: 0.5 });
      const highConf = makeResult({ confidence: 0.95 });
      resolver.registerConflict(taskId, [lowConf, highConf], 'chief-decides');

      const resolved = resolver.resolveConflict(taskId, 'chief-decides', chiefId);
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.data.confidence).toBe(0.95);
      }
    });

    it('should return error when chiefId is not provided', () => {
      const taskId = createUUID() as unknown as TaskID;
      const resultA = makeResult();
      const resultB = makeResult();
      resolver.registerConflict(taskId, [resultA, resultB], 'chief-decides');

      const resolved = resolver.resolveConflict(taskId, 'chief-decides');
      expect(resolved.ok).toBe(false);
      if (!resolved.ok) {
        expect(resolved.error_code).toBe(BB_E.PERMISSION_DENIED);
        expect(resolved.error_message).toContain('Chief agent ID required');
      }
    });
  });

  describe('resolveConflict — merge strategy', () => {
    it('should merge array outputs', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult({
        output: [1, 2],
        confidence: 0.9,
        artifacts: [{ type: 'file' as const, uri: 'file1', checksum: 'abc' }],
      });
      const result2 = makeResult({
        output: [3, 4],
        confidence: 0.8,
        artifacts: [{ type: 'file' as const, uri: 'file2', checksum: 'def' }],
      });
      resolver.registerConflict(taskId, [result1, result2], 'merge');

      const resolved = resolver.resolveConflict(taskId, 'merge');
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(Array.isArray(resolved.data.output)).toBe(true);
        expect(resolved.data.output).toEqual([1, 2, 3, 4]);
        // Confidence should be minimum of the two
        expect(resolved.data.confidence).toBe(0.8);
        // Artifacts should be merged
        expect(resolved.data.artifacts.length).toBe(2);
      }
    });

    it('should merge object outputs', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult({
        output: { a: 1, b: 2 },
        confidence: 0.9,
        artifacts: [],
      });
      const result2 = makeResult({
        output: { c: 3 },
        confidence: 0.7,
        artifacts: [],
      });
      resolver.registerConflict(taskId, [result1, result2], 'merge');

      const resolved = resolver.resolveConflict(taskId, 'merge');
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.data.output).toEqual({ a: 1, b: 2, c: 3 });
        expect(resolved.data.confidence).toBe(0.7);
      }
    });

    it('should fall back to first-wins when outputs cannot be merged', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult({
        output: 'string output',
        confidence: 0.9,
        completed_at: '2025-01-01T00:00:01.000Z',
      });
      const result2 = makeResult({
        output: 42,
        confidence: 0.8,
        completed_at: '2025-01-01T00:00:02.000Z',
      });
      resolver.registerConflict(taskId, [result1, result2], 'merge');

      const resolved = resolver.resolveConflict(taskId, 'merge');
      expect(resolved.ok).toBe(true);
      // Falls back to first-wins: earlier completion time wins
      if (resolved.ok) {
        expect(resolved.data.completed_at).toBe('2025-01-01T00:00:01.000Z');
      }
    });

    it('should fall back to first-wins for mixed array and non-array outputs', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult({
        output: [1, 2],
        completed_at: '2025-01-01T00:00:01.000Z',
      });
      const result2 = makeResult({
        output: 'not an array',
        completed_at: '2025-01-01T00:00:02.000Z',
      });
      resolver.registerConflict(taskId, [result1, result2], 'merge');

      const resolved = resolver.resolveConflict(taskId, 'merge');
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        // Falls back to first-wins
        expect(resolved.data.completed_at).toBe('2025-01-01T00:00:01.000Z');
      }
    });
  });

  // ─── resolveConflict — error cases ────────────────────────────────

  describe('resolveConflict — error cases', () => {
    it('should return error for unregistered task', () => {
      const result = resolver.resolveConflict(createUUID() as unknown as TaskID, 'first-wins');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe(BB_E.TASK_NOT_FOUND);
      }
    });

    it('should return cached result when resolving already-resolved conflict', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult({ completed_at: '2025-01-01T00:00:01.000Z' });
      const result2 = makeResult({ completed_at: '2025-01-01T00:00:02.000Z' });
      resolver.registerConflict(taskId, [result1, result2], 'first-wins');

      const first = resolver.resolveConflict(taskId, 'first-wins');
      expect(first.ok).toBe(true);

      // Resolve again — should return the same cached winner
      const second = resolver.resolveConflict(taskId, 'first-wins');
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(second.data.agent_id).toBe(first.ok ? first.data.agent_id : '');
      }
    });

    it('should return error for unknown strategy', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult();
      const result2 = makeResult();
      resolver.registerConflict(taskId, [result1, result2], 'first-wins');

      // @ts-expect-error — testing invalid strategy
      const result = resolver.resolveConflict(taskId, 'unknown-strategy');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe(BB_E.VALIDATION_FAILED);
        expect(result.error_message).toContain('Unknown conflict strategy');
      }
    });
  });

  // ─── getConflict ──────────────────────────────────────────────────

  describe('getConflict', () => {
    it('should return the conflict state for a registered task', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult();
      const result2 = makeResult();
      resolver.registerConflict(taskId, [result1, result2], 'vote');

      const state = resolver.getConflict(taskId);
      expect(state).toBeDefined();
      expect(state!.task_id).toBe(taskId);
      expect(state!.results.length).toBe(2);
      expect(state!.strategy).toBe('vote');
      expect(state!.resolved).toBe(false);
    });

    it('should return undefined for non-existent conflict', () => {
      const state = resolver.getConflict(createUUID() as unknown as TaskID);
      expect(state).toBeUndefined();
    });

    it('should reflect votes in conflict state', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult();
      const result2 = makeResult();
      resolver.registerConflict(taskId, [result1, result2], 'vote');

      const voter = createUUID() as unknown as AgentID;
      resolver.vote(taskId, voter, result1.agent_id);

      const state = resolver.getConflict(taskId);
      expect(state!.votes.length).toBe(1);
      expect(state!.votes[0]!.agent_id).toBe(voter);
      expect(state!.votes[0]!.result_id).toBe(result1.agent_id);
    });

    it('should mark conflict as resolved after resolution', () => {
      const taskId = createUUID() as unknown as TaskID;
      const result1 = makeResult({ completed_at: '2025-01-01T00:00:01.000Z' });
      const result2 = makeResult({ completed_at: '2025-01-01T00:00:02.000Z' });
      resolver.registerConflict(taskId, [result1, result2], 'first-wins');

      resolver.resolveConflict(taskId, 'first-wins');

      const state = resolver.getConflict(taskId);
      expect(state!.resolved).toBe(true);
      expect(state!.winner).toBeDefined();
      expect(state!.winner!.agent_id).toBe(result1.agent_id);
    });
  });
});