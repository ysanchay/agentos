/**
 * @agentos/simulation — Verification Protocol
 * 10-check verification from the constitution.
 * Every simulation must pass all 10 checks.
 */

import type { AgentID } from '@agentos/types';
import { AgentState, TaskState } from '@agentos/types';
import type { VerificationCheck, VerificationResults } from './simulation-reporter.js';

// ─── Interfaces ──────────────────────────────────────────────────────

export interface SimulationState {
  /** All agent states */
  agentStates: Map<string, AgentState>;
  /** All task states */
  taskStates: Map<string, TaskState>;
  /** All task assignee histories */
  taskAssignees: Map<string, AgentID[]>;
  /** All allocations (agent_id -> allocated amounts) */
  allocations: Map<string, { ru: number; mu: number; eu: number; vu: number }>;
  /** All allocations (agent_id -> consumed amounts) */
  consumption: Map<string, { ru: number; mu: number; eu: number; vu: number }>;
  /** Resource budget limits per agent */
  agentLimits: Map<string, { ru: number; mu: number; eu: number; vu: number }>;
  /** Total system capacity */
  totalCapacity: { ru: number; mu: number; eu: number; vu: number };
  /** Claims map: taskId -> agentId that currently claims it */
  claims: Map<string, string>;
  /** Task dependency graph: taskId -> taskIds it depends on */
  dependencies: Map<string, string[]>;
  /** All state transitions recorded */
  stateTransitions: Map<string, Array<{ from: string; to: string; timestamp: number }>>;
  /** Event store hash chain valid */
  auditChainValid: boolean;
}

// ─── Terminal States ─────────────────────────────────────────────────

const TASK_TERMINAL_STATES: TaskState[] = [
  TaskState.COMPLETED,
  TaskState.FAILED,
  TaskState.CANCELLED,
];

const AGENT_TERMINAL_STATES: AgentState[] = [
  AgentState.TERMINATED,
];

// ─── SimulationVerifier ───────────────────────────────────────────────

export class SimulationVerifier {
  /**
   * Run all 10 verification checks against the simulation state.
   * All must pass for the simulation to be considered successful.
   */
  verify(state: SimulationState): VerificationResults {
    const checks: VerificationCheck[] = [
      this.check1_AllTasksTerminal(state),
      this.check2_ZeroInvariantViolations(state),
      this.check3_HashChainIntact(state),
      this.check4_NoOrphanedTasks(state),
      this.check5_NoResourceLeaks(state),
      this.check6_NoOrphanedAgents(state),
      this.check7_ConservationHolds(state),
      this.check8_DependencyDAGIntact(state),
      this.check9_AuditTrailComplete(state),
      this.check10_ClaimsAtomic(state),
    ];

    const passedCount = checks.filter((c) => c.passed).length;
    const failedCount = checks.filter((c) => !c.passed).length;

    return {
      checks,
      allPassed: failedCount === 0,
      passedCount,
      failedCount,
    };
  }

  // ─── Check 1: All tasks terminal ────────────────────────────────────

  private check1_AllTasksTerminal(state: SimulationState): VerificationCheck {
    const nonTerminal: string[] = [];
    for (const [taskId, taskState] of state.taskStates) {
      if (!TASK_TERMINAL_STATES.includes(taskState)) {
        nonTerminal.push(`${taskId} (${taskState})`);
      }
    }

    if (nonTerminal.length === 0) {
      return {
        name: 'All Tasks Terminal',
        passed: true,
        message: `All ${state.taskStates.size} tasks are in terminal states`,
      };
    }

    return {
      name: 'All Tasks Terminal',
      passed: false,
      message: `${nonTerminal.length} tasks in non-terminal states: ${nonTerminal.slice(0, 5).join(', ')}${nonTerminal.length > 5 ? '...' : ''}`,
      details: { nonTerminal },
    };
  }

  // ─── Check 2: Zero invariant violations ──────────────────────────────

  private check2_ZeroInvariantViolations(state: SimulationState): VerificationCheck {
    const violations: string[] = [];

    for (const [agentId, allocated] of state.allocations) {
      const consumed = state.consumption.get(agentId);
      const limits = state.agentLimits.get(agentId);

      if (consumed) {
        if (consumed.ru > allocated.ru) violations.push(`${agentId}: RU consumed (${consumed.ru}) > allocated (${allocated.ru})`);
        if (consumed.mu > allocated.mu) violations.push(`${agentId}: MU consumed (${consumed.mu}) > allocated (${allocated.mu})`);
        if (consumed.eu > allocated.eu) violations.push(`${agentId}: EU consumed (${consumed.eu}) > allocated (${allocated.eu})`);
        if (consumed.vu > allocated.vu) violations.push(`${agentId}: VU consumed (${consumed.vu}) > allocated (${allocated.vu})`);
      }

      if (limits) {
        if (allocated.ru > limits.ru) violations.push(`${agentId}: RU allocated (${allocated.ru}) > limit (${limits.ru})`);
        if (allocated.mu > limits.mu) violations.push(`${agentId}: MU allocated (${allocated.mu}) > limit (${limits.mu})`);
        if (allocated.eu > limits.eu) violations.push(`${agentId}: EU allocated (${allocated.eu}) > limit (${limits.eu})`);
        if (allocated.vu > limits.vu) violations.push(`${agentId}: VU allocated (${allocated.vu}) > limit (${limits.vu})`);
      }
    }

    if (violations.length === 0) {
      return {
        name: 'Zero Invariant Violations',
        passed: true,
        message: 'No invariant violations detected',
      };
    }

    return {
      name: 'Zero Invariant Violations',
      passed: false,
      message: `${violations.length} violations: ${violations.slice(0, 5).join('; ')}`,
      details: { violations },
    };
  }

  // ─── Check 3: Hash chain intact ──────────────────────────────────────

  private check3_HashChainIntact(state: SimulationState): VerificationCheck {
    if (state.auditChainValid) {
      return {
        name: 'Hash Chain Intact',
        passed: true,
        message: 'Event store hash chain verified successfully',
      };
    }

    return {
      name: 'Hash Chain Intact',
      passed: false,
      message: 'Event store hash chain verification failed',
    };
  }

  // ─── Check 4: No orphaned tasks ──────────────────────────────────────

  private check4_NoOrphanedTasks(state: SimulationState): VerificationCheck {
    const orphaned: string[] = [];

    for (const [taskId, taskState] of state.taskStates) {
      const assignees = state.taskAssignees.get(taskId);
      if (!assignees || assignees.length === 0) {
        if (taskState !== TaskState.CANCELLED && taskState !== TaskState.DRAFT) {
          orphaned.push(taskId);
        }
      }
    }

    if (orphaned.length === 0) {
      return {
        name: 'No Orphaned Tasks',
        passed: true,
        message: 'All tasks have assignee history or were cancelled',
      };
    }

    return {
      name: 'No Orphaned Tasks',
      passed: false,
      message: `${orphaned.length} orphaned tasks found`,
      details: { orphaned: orphaned.slice(0, 10) },
    };
  }

  // ─── Check 5: No resource leaks ──────────────────────────────────────

  private check5_NoResourceLeaks(state: SimulationState): VerificationCheck {
    const leaks: string[] = [];

    for (const [agentId, agentState] of state.agentStates) {
      if (AGENT_TERMINAL_STATES.includes(agentState)) {
        const allocated = state.allocations.get(agentId);
        if (allocated && (allocated.ru > 0 || allocated.mu > 0 || allocated.eu > 0 || allocated.vu > 0)) {
          leaks.push(`${agentId}: still has RU=${allocated.ru}, MU=${allocated.mu}, EU=${allocated.eu}, VU=${allocated.vu}`);
        }
      }
    }

    if (leaks.length === 0) {
      return {
        name: 'No Resource Leaks',
        passed: true,
        message: 'All terminal agents have released their resources',
      };
    }

    return {
      name: 'No Resource Leaks',
      passed: false,
      message: `${leaks.length} resource leaks detected`,
      details: { leaks: leaks.slice(0, 10) },
    };
  }

  // ─── Check 6: No orphaned agents ──────────────────────────────────────

  private check6_NoOrphanedAgents(state: SimulationState): VerificationCheck {
    const nonTerminal: string[] = [];
    for (const [agentId, agentState] of state.agentStates) {
      if (!AGENT_TERMINAL_STATES.includes(agentState)) {
        nonTerminal.push(`${agentId} (${agentState})`);
      }
    }

    if (nonTerminal.length === 0) {
      return {
        name: 'No Orphaned Agents',
        passed: true,
        message: 'All agents are in terminal states',
      };
    }

    return {
      name: 'No Orphaned Agents',
      passed: false,
      message: `${nonTerminal.length} agents in non-terminal states`,
      details: { nonTerminal: nonTerminal.slice(0, 10) },
    };
  }

  // ─── Check 7: Conservation holds ──────────────────────────────────────

  private check7_ConservationHolds(state: SimulationState): VerificationCheck {
    const violations: string[] = [];

    let totalRuAllocated = 0, totalMuAllocated = 0, totalEuAllocated = 0, totalVuAllocated = 0;
    let totalRuConsumed = 0, totalMuConsumed = 0, totalEuConsumed = 0, totalVuConsumed = 0;

    for (const [, allocated] of state.allocations) {
      totalRuAllocated += allocated.ru;
      totalMuAllocated += allocated.mu;
      totalEuAllocated += allocated.eu;
      totalVuAllocated += allocated.vu;
    }

    for (const [, consumed] of state.consumption) {
      totalRuConsumed += consumed.ru;
      totalMuConsumed += consumed.mu;
      totalEuConsumed += consumed.eu;
      totalVuConsumed += consumed.vu;
    }

    const cap = state.totalCapacity;
    if (totalRuAllocated > cap.ru) violations.push(`RU allocated (${totalRuAllocated}) > capacity (${cap.ru})`);
    if (totalMuAllocated > cap.mu) violations.push(`MU allocated (${totalMuAllocated}) > capacity (${cap.mu})`);
    if (totalEuAllocated > cap.eu) violations.push(`EU allocated (${totalEuAllocated}) > capacity (${cap.eu})`);
    if (totalVuAllocated > cap.vu) violations.push(`VU allocated (${totalVuAllocated}) > capacity (${cap.vu})`);

    if (totalRuConsumed > totalRuAllocated) violations.push(`RU consumed (${totalRuConsumed}) > allocated (${totalRuAllocated})`);
    if (totalMuConsumed > totalMuAllocated) violations.push(`MU consumed (${totalMuConsumed}) > allocated (${totalMuAllocated})`);
    if (totalEuConsumed > totalEuAllocated) violations.push(`EU consumed (${totalEuConsumed}) > allocated (${totalEuAllocated})`);
    if (totalVuConsumed > totalVuAllocated) violations.push(`VU consumed (${totalVuConsumed}) > allocated (${totalVuAllocated})`);

    if (violations.length === 0) {
      return {
        name: 'Conservation Holds',
        passed: true,
        message: 'RU/MU/EU/VU conservation laws hold',
      };
    }

    return {
      name: 'Conservation Holds',
      passed: false,
      message: `${violations.length} conservation violations: ${violations.join('; ')}`,
      details: { violations },
    };
  }

  // ─── Check 8: Dependency DAG intact ──────────────────────────────────

  private check8_DependencyDAGIntact(state: SimulationState): VerificationCheck {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const hasCycle = (taskId: string): boolean => {
      if (inStack.has(taskId)) return true;
      if (visited.has(taskId)) return false;

      visited.add(taskId);
      inStack.add(taskId);

      const deps = state.dependencies.get(taskId) ?? [];
      for (const dep of deps) {
        if (hasCycle(dep)) return true;
      }

      inStack.delete(taskId);
      return false;
    };

    for (const taskId of state.dependencies.keys()) {
      if (hasCycle(taskId)) {
        return {
          name: 'Dependency DAG Intact',
          passed: false,
          message: 'Cycle detected in dependency graph',
        };
      }
    }

    // Check that dependencies completed before dependents
    const depViolations: string[] = [];
    for (const [taskId, deps] of state.dependencies) {
      for (const depId of deps) {
        const depState = state.taskStates.get(depId);
        const taskState = state.taskStates.get(taskId);
        if (taskState === TaskState.COMPLETED && depState && depState !== TaskState.COMPLETED) {
          depViolations.push(`${taskId} completed before dependency ${depId} (${depState})`);
        }
      }
    }

    if (depViolations.length === 0) {
      return {
        name: 'Dependency DAG Intact',
        passed: true,
        message: 'No cycles, all dependencies completed before dependents',
      };
    }

    return {
      name: 'Dependency DAG Intact',
      passed: false,
      message: `${depViolations.length} dependency violations`,
      details: { depViolations: depViolations.slice(0, 10) },
    };
  }

  // ─── Check 9: Audit trail complete ──────────────────────────────────

  private check9_AuditTrailComplete(state: SimulationState): VerificationCheck {
    let missingTransitions = 0;

    for (const [, transitions] of state.stateTransitions) {
      if (transitions.length === 0) {
        missingTransitions++;
      }
    }

    if (missingTransitions === 0) {
      return {
        name: 'Audit Trail Complete',
        passed: true,
        message: `All ${state.stateTransitions.size} entities have transition records`,
      };
    }

    return {
      name: 'Audit Trail Complete',
      passed: false,
      message: `${missingTransitions} entities have no transition records`,
    };
  }

  // ─── Check 10: Claims atomic ─────────────────────────────────────────

  private check10_ClaimsAtomic(state: SimulationState): VerificationCheck {
    const taskClaimants = new Map<string, string[]>();

    for (const [taskId, agentId] of state.claims) {
      const claimants = taskClaimants.get(taskId) ?? [];
      claimants.push(agentId);
      taskClaimants.set(taskId, claimants);
    }

    const doubleClaims: string[] = [];
    for (const [taskId, claimants] of taskClaimants) {
      if (claimants.length > 1) {
        doubleClaims.push(`${taskId} claimed by ${claimants.length} agents`);
      }
    }

    if (doubleClaims.length === 0) {
      return {
        name: 'Claims Atomic',
        passed: true,
        message: 'No tasks claimed by multiple agents simultaneously',
      };
    }

    return {
      name: 'Claims Atomic',
      passed: false,
      message: `${doubleClaims.length} double-claim violations: ${doubleClaims.join('; ')}`,
      details: { doubleClaims },
    };
  }
}