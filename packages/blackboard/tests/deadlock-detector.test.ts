/**
 * @agentos/blackboard — DeadlockDetector Tests
 * Full coverage of detectDeadlocks and resolveDeadlock
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DeadlockDetector } from '../src/deadlock-detector.js';
import type { AgentID } from '@agentos/types';
import type { LockEntry } from '../src/lock-manager.js';
import { createUUID } from '@agentos/types';

describe('DeadlockDetector', () => {
  let detector: DeadlockDetector;

  beforeEach(() => {
    detector = new DeadlockDetector();
  });

  // ─── detectDeadlocks ──────────────────────────────────────────────

  describe('detectDeadlocks', () => {
    it('should return no deadlocks for an empty graph', () => {
      const deadlocks = detector.detectDeadlocks([]);
      expect(deadlocks).toEqual([]);
    });

    it('should return no deadlocks for a graph with no cycles', () => {
      // A -> B -> C (no cycle)
      const agentA = createUUID() as unknown as AgentID;
      const agentB = createUUID() as unknown as AgentID;
      const agentC = createUUID() as unknown as AgentID;

      const edges: [AgentID, string, AgentID][] = [
        [agentA, 'res-1', agentB],
        [agentB, 'res-2', agentC],
      ];

      const deadlocks = detector.detectDeadlocks(edges);
      expect(deadlocks).toEqual([]);
    });

    it('should detect a simple two-agent deadlock cycle', () => {
      // A waits for B, B waits for A
      const agentA = createUUID() as unknown as AgentID;
      const agentB = createUUID() as unknown as AgentID;

      const edges: [AgentID, string, AgentID][] = [
        [agentA, 'res-1', agentB],
        [agentB, 'res-2', agentA],
      ];

      const deadlocks = detector.detectDeadlocks(edges, '2025-01-01T00:00:00.000Z');
      expect(deadlocks.length).toBe(1);

      const cycle = deadlocks[0]!.cycle;
      expect(cycle.length).toBe(2);
      // The cycle should contain both agents
      expect(cycle).toContain(agentA);
      expect(cycle).toContain(agentB);
      expect(deadlocks[0]!.detected_at).toBe('2025-01-01T00:00:00.000Z');
    });

    it('should detect a three-agent deadlock cycle', () => {
      // A waits for B, B waits for C, C waits for A
      const agentA = createUUID() as unknown as AgentID;
      const agentB = createUUID() as unknown as AgentID;
      const agentC = createUUID() as unknown as AgentID;

      const edges: [AgentID, string, AgentID][] = [
        [agentA, 'res-1', agentB],
        [agentB, 'res-2', agentC],
        [agentC, 'res-3', agentA],
      ];

      const deadlocks = detector.detectDeadlocks(edges);
      expect(deadlocks.length).toBe(1);

      const cycle = deadlocks[0]!.cycle;
      expect(cycle.length).toBe(3);
      expect(cycle).toContain(agentA);
      expect(cycle).toContain(agentB);
      expect(cycle).toContain(agentC);

      // Check resource IDs are captured
      expect(deadlocks[0]!.resource_ids.length).toBeGreaterThan(0);
    });

    it('should detect resource IDs in the deadlock cycle', () => {
      const agentA = createUUID() as unknown as AgentID;
      const agentB = createUUID() as unknown as AgentID;

      const edges: [AgentID, string, AgentID][] = [
        [agentA, 'res-1', agentB],
        [agentB, 'res-2', agentA],
      ];

      const deadlocks = detector.detectDeadlocks(edges);
      expect(deadlocks.length).toBe(1);
      // Two edges in cycle = two resource IDs
      expect(deadlocks[0]!.resource_ids).toContain('res-1');
      expect(deadlocks[0]!.resource_ids).toContain('res-2');
    });

    it('should handle a graph with a cycle and non-cycle edges', () => {
      const agentA = createUUID() as unknown as AgentID;
      const agentB = createUUID() as unknown as AgentID;
      const agentC = createUUID() as unknown as AgentID;

      const edges: [AgentID, string, AgentID][] = [
        [agentA, 'res-1', agentB], // A waits for B
        [agentB, 'res-2', agentA], // B waits for A (cycle!)
        [agentA, 'res-3', agentC], // A also waits for C (non-cycle)
      ];

      const deadlocks = detector.detectDeadlocks(edges);
      expect(deadlocks.length).toBe(1);
      expect(deadlocks[0]!.cycle).toContain(agentA);
      expect(deadlocks[0]!.cycle).toContain(agentB);
    });

    it('should detect multiple separate deadlock cycles', () => {
      // Cycle 1: A <-> B
      const agentA = createUUID() as unknown as AgentID;
      const agentB = createUUID() as unknown as AgentID;
      // Cycle 2: C <-> D
      const agentC = createUUID() as unknown as AgentID;
      const agentD = createUUID() as unknown as AgentID;

      const edges: [AgentID, string, AgentID][] = [
        [agentA, 'res-1', agentB],
        [agentB, 'res-2', agentA],
        [agentC, 'res-3', agentD],
        [agentD, 'res-4', agentC],
      ];

      const deadlocks = detector.detectDeadlocks(edges);
      // DFS may find the cycles in different orders; just check we found 2
      expect(deadlocks.length).toBe(2);
    });

    it('should use default timestamp when now is not provided', () => {
      const agentA = createUUID() as unknown as AgentID;
      const agentB = createUUID() as unknown as AgentID;

      const edges: [AgentID, string, AgentID][] = [
        [agentA, 'res-1', agentB],
        [agentB, 'res-2', agentA],
      ];

      const deadlocks = detector.detectDeadlocks(edges);
      expect(deadlocks.length).toBe(1);
      // Should have a valid ISO timestamp
      expect(deadlocks[0]!.detected_at).toBeTruthy();
    });
  });

  // ─── resolveDeadlock ──────────────────────────────────────────────

  describe('resolveDeadlock', () => {
    it('should select the agent with lowest priority as victim', () => {
      const agentA = createUUID() as unknown as AgentID;
      const agentB = createUUID() as unknown as AgentID;

      const deadlock = {
        cycle: [agentA, agentB],
        resource_ids: ['res-1', 'res-2'],
        detected_at: '2025-01-01T00:00:00.000Z',
      };

      const priorities = new Map<AgentID, number>([
        [agentA, 1], // high priority (lower number = higher priority)
        [agentB, 5], // low priority
      ]);

      const locks: LockEntry[] = [
        { resource_id: 'res-1', agent_id: agentA, lock_type: 'write', acquired_at: '2025-01-01T00:00:00.000Z', expires_at: '2025-01-01T00:05:00.000Z' },
        { resource_id: 'res-2', agent_id: agentB, lock_type: 'write', acquired_at: '2025-01-01T00:00:00.000Z', expires_at: '2025-01-01T00:05:00.000Z' },
      ];

      const result = detector.resolveDeadlock(deadlock, priorities, locks);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Agent B has lower priority (5 > 1), so B should be the victim
        expect(result.data).toBe(agentB);
      }
    });

    it('should select the agent with youngest lock when priorities are equal', () => {
      const agentA = createUUID() as unknown as AgentID;
      const agentB = createUUID() as unknown as AgentID;

      const deadlock = {
        cycle: [agentA, agentB],
        resource_ids: ['res-1', 'res-2'],
        detected_at: '2025-01-01T00:00:00.000Z',
      };

      const priorities = new Map<AgentID, number>([
        [agentA, 3],
        [agentB, 3],
      ]);

      const locks: LockEntry[] = [
        { resource_id: 'res-1', agent_id: agentA, lock_type: 'write', acquired_at: '2025-01-01T00:00:00.000Z', expires_at: '2025-01-01T00:05:00.000Z' },
        { resource_id: 'res-2', agent_id: agentB, lock_type: 'write', acquired_at: '2025-01-01T00:00:01.000Z', expires_at: '2025-01-01T00:05:01.000Z' },
      ];

      const result = detector.resolveDeadlock(deadlock, priorities, locks);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Agent B's lock was acquired later, so B is the victim
        expect(result.data).toBe(agentB);
      }
    });

    it('should default to priority 5 for agents not in the priorities map', () => {
      const agentA = createUUID() as unknown as AgentID;
      const agentB = createUUID() as unknown as AgentID;

      const deadlock = {
        cycle: [agentA, agentB],
        resource_ids: ['res-1'],
        detected_at: '2025-01-01T00:00:00.000Z',
      };

      // Only agentA has a priority
      const priorities = new Map<AgentID, number>([
        [agentA, 1],
      ]);

      const locks: LockEntry[] = [
        { resource_id: 'res-1', agent_id: agentA, lock_type: 'write', acquired_at: '2025-01-01T00:00:00.000Z', expires_at: '2025-01-01T00:05:00.000Z' },
        { resource_id: 'res-2', agent_id: agentB, lock_type: 'write', acquired_at: '2025-01-01T00:00:00.000Z', expires_at: '2025-01-01T00:05:00.000Z' },
      ];

      const result = detector.resolveDeadlock(deadlock, priorities, locks);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // AgentB defaults to priority 5, which is lower priority, so B is victim
        expect(result.data).toBe(agentB);
      }
    });

    it('should return error when no locks found for cycle agents', () => {
      const agentA = createUUID() as unknown as AgentID;
      const agentB = createUUID() as unknown as AgentID;

      const deadlock = {
        cycle: [agentA, agentB],
        resource_ids: ['res-1'],
        detected_at: '2025-01-01T00:00:00.000Z',
      };

      const priorities = new Map<AgentID, number>();
      const locks: LockEntry[] = []; // No locks

      const result = detector.resolveDeadlock(deadlock, priorities, locks);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('BB-E008'); // DEADLOCK_DETECTED
      }
    });

    it('should consider only locks held by cycle agents', () => {
      const agentA = createUUID() as unknown as AgentID;
      const agentB = createUUID() as unknown as AgentID;
      const agentC = createUUID() as unknown as AgentID; // not in cycle

      const deadlock = {
        cycle: [agentA, agentB],
        resource_ids: ['res-1', 'res-2'],
        detected_at: '2025-01-01T00:00:00.000Z',
      };

      const priorities = new Map<AgentID, number>([
        [agentA, 2],
        [agentB, 4],
        [agentC, 5], // lowest priority but not in cycle
      ]);

      const locks: LockEntry[] = [
        { resource_id: 'res-1', agent_id: agentA, lock_type: 'write', acquired_at: '2025-01-01T00:00:00.000Z', expires_at: '2025-01-01T00:05:00.000Z' },
        { resource_id: 'res-2', agent_id: agentB, lock_type: 'write', acquired_at: '2025-01-01T00:00:00.000Z', expires_at: '2025-01-01T00:05:00.000Z' },
        { resource_id: 'res-3', agent_id: agentC, lock_type: 'write', acquired_at: '2025-01-01T00:00:00.000Z', expires_at: '2025-01-01T00:05:00.000Z' },
      ];

      const result = detector.resolveDeadlock(deadlock, priorities, locks);
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Agent B has lower priority among cycle agents (4 > 2), so B is victim
        expect(result.data).toBe(agentB);
      }
    });

    it('should handle single-agent self-deadlock', () => {
      const agentA = createUUID() as unknown as AgentID;

      const deadlock = {
        cycle: [agentA],
        resource_ids: ['res-1'],
        detected_at: '2025-01-01T00:00:00.000Z',
      };

      const priorities = new Map<AgentID, number>([
        [agentA, 3],
      ]);

      const locks: LockEntry[] = [
        { resource_id: 'res-1', agent_id: agentA, lock_type: 'upgrade', acquired_at: '2025-01-01T00:00:00.000Z', expires_at: '2025-01-01T00:05:00.000Z' },
      ];

      const result = detector.resolveDeadlock(deadlock, priorities, locks);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(agentA);
      }
    });
  });
});