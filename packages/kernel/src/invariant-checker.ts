/**
 * @agentos/kernel — Invariant Checker
 * Checks all 10 kernel invariants deterministically.
 * ZERO AI logic — pure assertion checks only.
 */

import type { AgentRegistry } from './agent-registry.js';
import type { TaskRegistry } from './task-registry.js';
import type { WorkspaceRegistry } from './workspace-registry.js';
import type { DependencyGraph } from './dependency-graph.js';
import type { PermissionEngine } from './permission-engine.js';
import type { EventBus } from './event-bus.js';
import { AgentState, TaskState, WorkspaceState, budgetGTE } from '@agentos/types';
import type { Agent, Task, Workspace } from '@agentos/types';

// ─── Invariant Types ─────────────────────────────────────────────────

export interface InvariantViolation {
  invariant: string;
  description: string;
  severity: 'critical' | 'warning';
  details?: unknown;
}

export interface InvariantReport {
  checked: number;
  passed: number;
  violations: InvariantViolation[];
  timestamp: string;
}

// ─── Invariant Checker ──────────────────────────────────────────────

export class InvariantChecker {
  private agentRegistry: AgentRegistry;
  private taskRegistry: TaskRegistry;
  private workspaceRegistry: WorkspaceRegistry;
  private dependencyGraph: DependencyGraph;
  private permissionEngine: PermissionEngine;
  private eventBus: EventBus;

  constructor(deps: {
    agentRegistry: AgentRegistry;
    taskRegistry: TaskRegistry;
    workspaceRegistry: WorkspaceRegistry;
    dependencyGraph: DependencyGraph;
    permissionEngine: PermissionEngine;
    eventBus: EventBus;
  }) {
    this.agentRegistry = deps.agentRegistry;
    this.taskRegistry = deps.taskRegistry;
    this.workspaceRegistry = deps.workspaceRegistry;
    this.dependencyGraph = deps.dependencyGraph;
    this.permissionEngine = deps.permissionEngine;
    this.eventBus = deps.eventBus;
  }

  /** Run all 10 invariant checks and return a report. */
  checkAll(): InvariantReport {
    const violations: InvariantViolation[] = [];
    let checked = 0;

    const checks: Array<{ name: string; fn: () => InvariantViolation | null }> = [
      { name: 'conservation', fn: () => this.checkConservationViolation() },
      { name: 'agentIsolation', fn: () => this.checkAgentIsolationViolation() },
      { name: 'terminalFinality', fn: () => this.checkTerminalFinalityViolation() },
      { name: 'auditCompleteness', fn: () => this.checkAuditCompletenessViolation() },
      { name: 'permissionEnforcement', fn: () => this.checkPermissionEnforcementViolation() },
      { name: 'dagAcyclicity', fn: () => this.checkDagAcyclicityViolation() },
      { name: 'workspaceIsolation', fn: () => this.checkWorkspaceIsolationViolation() },
      { name: 'budgetHardLimit', fn: () => this.checkBudgetHardLimitViolation() },
      { name: 'eventOrdering', fn: () => this.checkEventOrderingViolation() },
      { name: 'idempotency', fn: () => this.checkIdempotencyViolation() },
    ];

    for (const check of checks) {
      checked++;
      const violation = check.fn();
      if (violation) {
        violations.push(violation);
      }
    }

    return {
      checked,
      passed: checked - violations.length,
      violations,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Individual Invariant Checks ─────────────────────────────────

  /** Conservation: RU/MU/EU/VU don't exceed capacity */
  checkConservation(): boolean {
    return this.checkConservationViolation() === null;
  }

  private checkConservationViolation(): InvariantViolation | null {
    const workspaces = this.workspaceRegistry.list();
    for (const ws of workspaces) {
      if (!budgetGTE(ws.resource_quota, ws.resource_consumed)) {
        return {
          invariant: 'conservation',
          description: `Workspace "${ws.id}" resource consumption exceeds quota`,
          severity: 'critical',
          details: { workspace_id: ws.id, quota: ws.resource_quota, consumed: ws.resource_consumed },
        };
      }
    }

    // Also check agents
    const agents = this.agentRegistry.list();
    for (const agent of agents) {
      if (!budgetGTE(agent.resource_limits, agent.resources_consumed)) {
        return {
          invariant: 'conservation',
          description: `Agent "${agent.id}" resource consumption exceeds limits`,
          severity: 'critical',
          details: { agent_id: agent.id, limits: agent.resource_limits, consumed: agent.resources_consumed },
        };
      }
    }

    return null;
  }

  /** Agent Isolation: no cross-agent state access */
  checkAgentIsolation(): boolean {
    return this.checkAgentIsolationViolation() === null;
  }

  private checkAgentIsolationViolation(): InvariantViolation | null {
    // Check that no two agents share the same active tasks without being in the same workspace
    const agents = this.agentRegistry.list();
    const taskAssignments: Map<string, string[]> = new Map(); // taskId -> agentIds

    for (const agent of agents) {
      for (const taskId of agent.active_task_ids) {
        const existing = taskAssignments.get(taskId) ?? [];
        existing.push(agent.id);
        taskAssignments.set(taskId, existing);
      }
    }

    for (const [taskId, agentIds] of taskAssignments) {
      if (agentIds.length > 1) {
        // Check if all agents are in the same workspace
        const workspaces = new Set(
          agentIds.map((aid) => this.agentRegistry.get(aid as any)!.workspace_id),
        );
        if (workspaces.size > 1) {
          return {
            invariant: 'agentIsolation',
            description: `Task "${taskId}" is assigned to agents from different workspaces`,
            severity: 'critical',
            details: { task_id: taskId, agent_ids: agentIds },
          };
        }
      }
    }

    return null;
  }

  /** Terminal Finality: terminal states are final */
  checkTerminalFinality(): boolean {
    return this.checkTerminalFinalityViolation() === null;
  }

  private checkTerminalFinalityViolation(): InvariantViolation | null {
    // Check agents
    const agents = this.agentRegistry.list();
    for (const agent of agents) {
      if (agent.state === AgentState.TERMINATED) {
        // Check event history — no transitions after terminated
        const events = this.eventBus.getHistory(undefined, 1000);
        const postTerminal = events.filter((e) => {
          const data = e.data as Record<string, unknown> | undefined;
          return data?.['entity_id'] === agent.id &&
            data?.['from_state'] === 'terminated' &&
            data?.['action'] === 'transition';
        });
        if (postTerminal.length > 0) {
          return {
            invariant: 'terminalFinality',
            description: `Agent "${agent.id}" has transitions after terminal state`,
            severity: 'critical',
            details: { agent_id: agent.id, post_terminal_events: postTerminal.length },
          };
        }
      }
    }

    // Check tasks
    const tasks = this.taskRegistry.list();
    for (const task of tasks) {
      if (task.state === TaskState.COMPLETED || task.state === TaskState.CANCELLED) {
        const events = this.eventBus.getHistory(undefined, 1000);
        const postTerminal = events.filter((e) => {
          const data = e.data as Record<string, unknown> | undefined;
          return data?.['entity_id'] === task.id &&
            (data?.['from_state'] === 'completed' || data?.['from_state'] === 'cancelled') &&
            data?.['action'] === 'transition';
        });
        if (postTerminal.length > 0) {
          return {
            invariant: 'terminalFinality',
            description: `Task "${task.id}" has transitions after terminal state "${task.state}"`,
            severity: 'critical',
            details: { task_id: task.id, state: task.state },
          };
        }
      }
    }

    return null;
  }

  /** Audit Completeness: every transition has an event */
  checkAuditCompleteness(): boolean {
    return this.checkAuditCompletenessViolation() === null;
  }

  private checkAuditCompletenessViolation(): InvariantViolation | null {
    // All state machines record their transitions in the event bus.
    // If the event bus has events for all known entities, we're good.
    // This is a structural check — the kernel should always emit events.
    // For a simple check, verify that agents and tasks have at least one event each.
    const events = this.eventBus.getHistory();
    const entityIds = new Set(
      events
        .map((e) => (e.data as Record<string, unknown>)?.['entity_id'])
        .filter(Boolean) as string[],
    );

    const agents = this.agentRegistry.list();
    for (const agent of agents) {
      if (!entityIds.has(agent.id)) {
        return {
          invariant: 'auditCompleteness',
          description: `Agent "${agent.id}" has no audit events`,
          severity: 'warning',
          details: { agent_id: agent.id },
        };
      }
    }

    const tasks = this.taskRegistry.list();
    for (const task of tasks) {
      if (!entityIds.has(task.id)) {
        return {
          invariant: 'auditCompleteness',
          description: `Task "${task.id}" has no audit events`,
          severity: 'warning',
          details: { task_id: task.id },
        };
      }
    }

    return null;
  }

  /** Permission Enforcement: no unauthorized operations */
  checkPermissionEnforcement(): boolean {
    return this.checkPermissionEnforcementViolation() === null;
  }

  private checkPermissionEnforcementViolation(): InvariantViolation | null {
    // Structural check: all agents should have at least one permission
    // This is a lightweight check; deeper permission analysis requires operation context
    const agents = this.agentRegistry.list();
    for (const agent of agents) {
      if (agent.permissions.length === 0 && agent.state !== AgentState.SPAWNING) {
        return {
          invariant: 'permissionEnforcement',
          description: `Agent "${agent.id}" has no permissions assigned`,
          severity: 'warning',
          details: { agent_id: agent.id },
        };
      }
    }
    return null;
  }

  /** DAG Acyclicity: no cycles in task deps */
  checkDagAcyclicity(): boolean {
    return this.checkDagAcyclicityViolation() === null;
  }

  private checkDagAcyclicityViolation(): InvariantViolation | null {
    if (this.dependencyGraph.hasCycle()) {
      const cycle = this.dependencyGraph.detectCycle();
      return {
        invariant: 'dagAcyclicity',
        description: 'Task dependency graph contains a cycle',
        severity: 'critical',
        details: { cycle },
      };
    }
    return null;
  }

  /** Workspace Isolation: no cross-workspace data leaks */
  checkWorkspaceIsolation(): boolean {
    return this.checkWorkspaceIsolationViolation() === null;
  }

  private checkWorkspaceIsolationViolation(): InvariantViolation | null {
    // Check that tasks don't reference agents from different workspaces
    const tasks = this.taskRegistry.list();
    for (const task of tasks) {
      if (task.assignee_id) {
        const agent = this.agentRegistry.get(task.assignee_id);
        if (agent && agent.workspace_id !== task.workspace_id) {
          return {
            invariant: 'workspaceIsolation',
            description: `Task "${task.id}" is assigned to agent from different workspace`,
            severity: 'critical',
            details: {
              task_id: task.id,
              task_workspace: task.workspace_id,
              agent_id: task.assignee_id,
              agent_workspace: agent.workspace_id,
            },
          };
        }
      }
    }
    return null;
  }

  /** Budget Hard Limit: consumption <= allocation */
  checkBudgetHardLimit(): boolean {
    return this.checkBudgetHardLimitViolation() === null;
  }

  private checkBudgetHardLimitViolation(): InvariantViolation | null {
    const agents = this.agentRegistry.list();
    for (const agent of agents) {
      if (!budgetGTE(agent.resources_allocated, agent.resources_consumed)) {
        return {
          invariant: 'budgetHardLimit',
          description: `Agent "${agent.id}" consumption exceeds allocated budget`,
          severity: 'critical',
          details: {
            agent_id: agent.id,
            allocated: agent.resources_allocated,
            consumed: agent.resources_consumed,
          },
        };
      }
    }
    return null;
  }

  /** Event Ordering: events ordered per source */
  checkEventOrdering(): boolean {
    return this.checkEventOrderingViolation() === null;
  }

  private checkEventOrderingViolation(): InvariantViolation | null {
    const events = this.eventBus.getHistory();
    const sourceTimestamps: Map<string, string> = new Map();

    for (const event of events) {
      const lastTs = sourceTimestamps.get(event.source);
      if (lastTs && event.timestamp < lastTs) {
        return {
          invariant: 'eventOrdering',
          description: `Event from source "${event.source}" is out of order`,
          severity: 'warning',
          details: { event_id: event.id, source: event.source, timestamp: event.timestamp, last_timestamp: lastTs },
        };
      }
      sourceTimestamps.set(event.source, event.timestamp);
    }

    return null;
  }

  /** Idempotency: same key = same result */
  checkIdempotency(): boolean {
    return this.checkIdempotencyViolation() === null;
  }

  private checkIdempotencyViolation(): InvariantViolation | null {
    // Idempotency is enforced at the kernel level via idempotency key tracking.
    // This check verifies that duplicate entities don't exist.
    const agentIds = new Set<string>();
    const agents = this.agentRegistry.list();
    for (const agent of agents) {
      if (agentIds.has(agent.id)) {
        return {
          invariant: 'idempotency',
          description: `Duplicate agent ID "${agent.id}" detected`,
          severity: 'critical',
          details: { agent_id: agent.id },
        };
      }
      agentIds.add(agent.id);
    }

    const taskIds = new Set<string>();
    const tasks = this.taskRegistry.list();
    for (const task of tasks) {
      if (taskIds.has(task.id)) {
        return {
          invariant: 'idempotency',
          description: `Duplicate task ID "${task.id}" detected`,
          severity: 'critical',
          details: { task_id: task.id },
        };
      }
      taskIds.add(task.id);
    }

    return null;
  }

  /** Get all current violations. */
  getViolations(): InvariantViolation[] {
    return this.checkAll().violations;
  }

  /** Generate a report. */
  report(): InvariantReport {
    return this.checkAll();
  }
}