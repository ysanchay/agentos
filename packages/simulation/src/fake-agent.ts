/**
 * @agentos/simulation — Fake Agent
 * A deterministic agent with no AI/LLM logic.
 * Simulates agent behavior: claiming tasks, doing work, reporting results.
 */

import type {
  AgentID,
  TaskID,
  WorkspaceID,
  Priority,
  ResourceBudget,
} from '@agentos/types';
import { createUUID, AgentState, ZERO_BUDGET } from '@agentos/types';

// ─── Agent Types ──────────────────────────────────────────────────────

export type FakeAgentRole = 'chief' | 'manager' | 'worker' | 'validator' | 'daemon';

export interface FakeAgentConfig {
  id: AgentID;
  role: FakeAgentRole;
  workspaceId: WorkspaceID;
  capabilities: string[];
  resources: ResourceBudget;
  priority: Priority;
  failureRate: number;
  maxConcurrentTasks: number;
}

// ─── Agent State Transitions ───────────────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  [AgentState.SPAWNING]: [AgentState.INITIALIZING],
  [AgentState.INITIALIZING]: [AgentState.READY, AgentState.ERRORED],
  [AgentState.READY]: [AgentState.RUNNING, AgentState.PAUSED, AgentState.TERMINATING],
  [AgentState.RUNNING]: [AgentState.PAUSED, AgentState.SUSPENDED, AgentState.ERRORED, AgentState.TERMINATING],
  [AgentState.PAUSED]: [AgentState.RUNNING, AgentState.TERMINATING],
  [AgentState.SUSPENDED]: [AgentState.RUNNING, AgentState.TERMINATING],
  [AgentState.ERRORED]: [AgentState.RECOVERING, AgentState.TERMINATING],
  [AgentState.RECOVERING]: [AgentState.READY, AgentState.ERRORED, AgentState.TERMINATING],
  [AgentState.TERMINATING]: [AgentState.TERMINATED],
  [AgentState.TERMINATED]: [],
};

// ─── FakeAgent ──────────────────────────────────────────────────────────

export class FakeAgent {
  readonly id: AgentID;
  readonly role: FakeAgentRole;
  readonly workspaceId: WorkspaceID;
  readonly capabilities: string[];
  readonly resources: ResourceBudget;
  readonly priority: Priority;

  state: AgentState = AgentState.SPAWNING;
  activeTaskIds: TaskID[] = [];
  completedTaskCount: number = 0;
  failedTaskCount: number = 0;

  private failureRate: number;
  private maxConcurrentTasks: number;
  private rng: () => number;

  constructor(config: FakeAgentConfig, rng?: () => number) {
    this.id = config.id;
    this.role = config.role;
    this.workspaceId = config.workspaceId;
    this.capabilities = config.capabilities;
    this.resources = config.resources;
    this.priority = config.priority;
    this.failureRate = config.failureRate;
    this.maxConcurrentTasks = config.maxConcurrentTasks;
    this.rng = rng ?? Math.random;
  }

  /**
   * Transition to a new state.
   */
  transition(newState: AgentState): boolean {
    const allowed = VALID_TRANSITIONS[this.state];
    if (!allowed || !allowed.includes(newState)) {
      return false;
    }
    this.state = newState;
    return true;
  }

  /**
   * Check if the agent can accept another task.
   */
  canAcceptTask(): boolean {
    return this.state === AgentState.READY &&
      this.activeTaskIds.length < this.maxConcurrentTasks;
  }

  /**
   * Start a task.
   */
  startTask(taskId: TaskID): boolean {
    if (!this.canAcceptTask()) return false;
    this.activeTaskIds.push(taskId);
    this.state = AgentState.RUNNING;
    return true;
  }

  /**
   * Complete a task successfully.
   */
  completeTask(taskId: TaskID): void {
    this.activeTaskIds = this.activeTaskIds.filter((id) => id !== taskId);
    this.completedTaskCount++;
    if (this.activeTaskIds.length === 0) {
      this.state = AgentState.READY;
    }
  }

  /**
   * Fail a task.
   */
  failTask(taskId: TaskID): void {
    this.activeTaskIds = this.activeTaskIds.filter((id) => id !== taskId);
    this.failedTaskCount++;
    if (this.activeTaskIds.length === 0) {
      this.state = AgentState.READY;
    }
  }

  /**
   * Decide whether to fail a task (based on failureRate).
   */
  shouldFail(): boolean {
    return this.rng() < this.failureRate;
  }

  /**
   * Simulate work for a given duration.
   * Returns the amount of resources consumed.
   */
  simulateWork(durationMs: number): ResourceBudget {
    const ruPerMs = this.resources.ru / 3_600_000;
    const muPerMs = this.resources.mu / 3_600_000;
    const euPerMs = this.resources.eu / 3_600_000;
    const vuPerMs = this.resources.vu / 3_600_000;

    return {
      ru: Math.ceil(ruPerMs * durationMs) || 1,
      mu: Math.ceil(muPerMs * durationMs) || 1,
      eu: Math.ceil(euPerMs * durationMs) || 1,
      vu: Math.ceil(vuPerMs * durationMs) || 1,
    };
  }

  /**
   * Check if the agent has a specific capability.
   */
  hasCapability(capability: string): boolean {
    return this.capabilities.includes(capability) || this.capabilities.includes('*');
  }

  /**
   * Initialize the agent (SPAWNING → INITIALIZING → READY).
   */
  initialize(): void {
    this.transition(AgentState.INITIALIZING);
    this.transition(AgentState.READY);
  }

  /**
   * Terminate the agent (→ TERMINATING → TERMINATED).
   */
  terminate(): void {
    if (this.state !== AgentState.TERMINATING && this.state !== AgentState.TERMINATED) {
      this.transition(AgentState.TERMINATING);
    }
    if (this.state === AgentState.TERMINATING) {
      this.transition(AgentState.TERMINATED);
    }
  }

  /**
   * Get a summary of the agent's state.
   */
  getSummary(): {
    id: string;
    role: string;
    state: string;
    activeTasks: number;
    completed: number;
    failed: number;
  } {
    return {
      id: this.id as string,
      role: this.role,
      state: this.state,
      activeTasks: this.activeTaskIds.length,
      completed: this.completedTaskCount,
      failed: this.failedTaskCount,
    };
  }
}

// ─── Agent Factory ─────────────────────────────────────────────────────

export class AgentFactory {
  /**
   * Create a fake agent of the specified role.
   */
  static create(
    role: FakeAgentRole,
    workspaceId: WorkspaceID,
    priority: Priority,
    failureRate: number = 0.05,
    maxConcurrentTasks: number = 3,
    rng?: () => number,
  ): FakeAgent {
    const capabilities = AGENT_CAPABILITIES[role];
    const resources = AGENT_RESOURCES[role];

    return new FakeAgent({
      id: createUUID() as unknown as AgentID,
      role,
      workspaceId,
      capabilities,
      resources,
      priority,
      failureRate,
      maxConcurrentTasks,
    }, rng);
  }

  /**
   * Create a set of agents for a simulation.
   */
  static createSimulationSet(
    count: number,
    workspaceIds: WorkspaceID[],
    chiefCount: number,
    managerCount: number,
    failureRate: number = 0.05,
    rng?: () => number,
  ): FakeAgent[] {
    const agents: FakeAgent[] = [];

    // Chiefs
    for (let i = 0; i < chiefCount; i++) {
      const ws = workspaceIds[i % workspaceIds.length]!;
      agents.push(AgentFactory.create('chief', ws, 1 as Priority, failureRate * 0.5, 5, rng));
    }

    // Managers
    for (let i = 0; i < managerCount; i++) {
      const ws = workspaceIds[(chiefCount + i) % workspaceIds.length]!;
      agents.push(AgentFactory.create('manager', ws, 2 as Priority, failureRate * 0.7, 4, rng));
    }

    // Workers
    const workerCount = count - chiefCount - managerCount;
    for (let i = 0; i < workerCount; i++) {
      const ws = workspaceIds[(chiefCount + managerCount + i) % workspaceIds.length]!;
      agents.push(AgentFactory.create('worker', ws, 3 as Priority, failureRate, 3, rng));
    }

    return agents;
  }
}

// ─── Default Capabilities & Resources ─────────────────────────────────

const AGENT_CAPABILITIES: Record<FakeAgentRole, string[]> = {
  chief: ['decompose', 'assign', 'review', 'approve', 'manage', '*'],
  manager: ['track', 'assign', 'coordinate', 'review', 'manage'],
  worker: ['execute', 'implement', 'test', 'review'],
  validator: ['validate', 'review', 'approve'],
  daemon: ['monitor', 'heartbeat', 'health'],
};

const AGENT_RESOURCES: Record<FakeAgentRole, ResourceBudget> = {
  chief: { ru: 2000, mu: 1000, eu: 500, vu: 200 },
  manager: { ru: 1000, mu: 500, eu: 200, vu: 100 },
  worker: { ru: 500, mu: 200, eu: 100, vu: 50 },
  validator: { ru: 200, mu: 100, eu: 50, vu: 25 },
  daemon: { ru: 100, mu: 50, eu: 25, vu: 10 },
};