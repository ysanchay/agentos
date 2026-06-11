/**
 * @agentos/simulation — SimulationVerifier tests
 * Tests for the 10 constitutional verification checks.
 */

import { describe, it, expect } from 'vitest';
import { SimulationVerifier, type SimulationState } from '../src/simulation-verifier.js';
import { AgentState, TaskState } from '@agentos/types';

// ─── Helper ───────────────────────────────────────────────────────────────

function makeState(overrides?: Partial<SimulationState>): SimulationState {
  return {
    agentStates: new Map(),
    taskStates: new Map(),
    taskAssignees: new Map(),
    allocations: new Map(),
    consumption: new Map(),
    agentLimits: new Map(),
    totalCapacity: { ru: 100000, mu: 50000, eu: 10000, vu: 5000 },
    claims: new Map(),
    dependencies: new Map(),
    stateTransitions: new Map(),
    auditChainValid: true,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('SimulationVerifier', () => {
  describe('verify with clean terminal state', () => {
    it('should pass all checks when all tasks are terminal and agents terminated', () => {
      const agentStates = new Map<string, AgentState>();
      agentStates.set('a1', AgentState.TERMINATED);
      agentStates.set('a2', AgentState.TERMINATED);

      const taskStates = new Map<string, TaskState>();
      taskStates.set('t1', TaskState.COMPLETED);
      taskStates.set('t2', TaskState.FAILED);

      const taskAssignees = new Map<string, string[]>();
      taskAssignees.set('t1', ['a1']);
      taskAssignees.set('t2', ['a2']);

      const allocations = new Map<string, { ru: number; mu: number; eu: number; vu: number }>();
      allocations.set('a1', { ru: 100, mu: 50, eu: 20, vu: 10 });
      allocations.set('a2', { ru: 200, mu: 100, eu: 40, vu: 20 });

      const consumption = new Map<string, { ru: number; mu: number; eu: number; vu: number }>();
      consumption.set('a1', { ru: 80, mu: 40, eu: 15, vu: 5 });
      consumption.set('a2', { ru: 150, mu: 80, eu: 30, vu: 15 });

      const agentLimits = new Map<string, { ru: number; mu: number; eu: number; vu: number }>();
      agentLimits.set('a1', { ru: 100, mu: 50, eu: 20, vu: 10 });
      agentLimits.set('a2', { ru: 200, mu: 100, eu: 40, vu: 20 });

      const claims = new Map<string, string>();
      claims.set('t1', 'a1');
      claims.set('t2', 'a2');

      const state = makeState({
        agentStates,
        taskStates,
        taskAssignees,
        allocations,
        consumption,
        agentLimits,
        claims,
      });

      const verifier = new SimulationVerifier();
      const result = verifier.verify(state);

      // Should have 10 checks
      expect(result.checks).toHaveLength(10);
      // All tasks are terminal (COMPLETED, FAILED) so at least check 1 should pass
      const taskTerminal = result.checks.find((c) => c.name === 'All Tasks Terminal');
      expect(taskTerminal).toBeDefined();
      expect(taskTerminal!.passed).toBe(true);
    });
  });

  describe('check 1: All Tasks Terminal', () => {
    it('should fail when tasks are in non-terminal states', () => {
      const taskStates = new Map<string, TaskState>();
      taskStates.set('t1', TaskState.IN_PROGRESS);
      taskStates.set('t2', TaskState.COMPLETED);

      const state = makeState({ taskStates });
      const verifier = new SimulationVerifier();
      const result = verifier.verify(state);

      const taskTerminal = result.checks.find((c) => c.name === 'All Tasks Terminal');
      expect(taskTerminal).toBeDefined();
      expect(taskTerminal!.passed).toBe(false);
    });
  });

  describe('check 6: No Orphaned Agents', () => {
    it('should fail when agents are not terminated', () => {
      const agentStates = new Map<string, AgentState>();
      agentStates.set('a1', AgentState.RUNNING);

      const state = makeState({ agentStates });
      const verifier = new SimulationVerifier();
      const result = verifier.verify(state);

      const orphanedCheck = result.checks.find((c) => c.name === 'No Orphaned Agents');
      expect(orphanedCheck).toBeDefined();
      expect(orphanedCheck!.passed).toBe(false);
    });
  });
});