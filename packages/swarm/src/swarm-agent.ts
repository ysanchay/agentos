/**
 * @agentos/swarm — SwarmAgent Base Class
 * Foundation for all swarm agents: Chief, Manager, Worker, Validator.
 *
 * Every SwarmAgent wraps an AgentStateMachine from @agentos/kernel,
 * communicates through ACP via @agentos/protocol, coordinates through
 * @agentos/blackboard, and tracks resources through @agentos/resources.
 *
 * Key design decisions:
 * - State machine compliance: All state transitions follow AGENT_TRANSITIONS
 * - Resource accountability: Every action produces ResourceConsumption records
 * - Event persistence: All actions are recorded through EventBus → EventStore
 * - No AI logic in base class: LLM calls happen only in WorkerAgent via @agentos/llm
 */

import type {
  AgentID,
  TaskID,
  WorkspaceID,
  ProjectID,
  Priority,
  ResourceBudget,
  ResourceConsumption,
} from '@agentos/types';
import { createUUID, AgentState, ZERO_BUDGET, ZERO_CONSUMPTION } from '@agentos/types';
import { AgentStateMachine } from '@agentos/kernel';
import type { EventBus } from '@agentos/kernel';
import type { Blackboard } from '@agentos/blackboard';
import type { ResourceScheduler } from '@agentos/resources';
import type { CapabilityExecutor } from '@agentos/capabilities';
import type { SwarmConfig, SwarmMessage, SwarmAgentPhase } from './types.js';

// ─── Swarm Agent Interface ────────────────────────────────────────────────

export interface SwarmAgentContext {
  eventBus: EventBus;
  blackboard: Blackboard;
  scheduler: ResourceScheduler;
  config: SwarmConfig;
  sendMessage: (message: SwarmMessage) => void;
  onMessage: (handler: (message: SwarmMessage) => void) => void;
  currentTime: () => number;
  /** Optional capability executor for real-world execution */
  capabilityExecutor?: CapabilityExecutor;
}

// ─── SwarmAgent ───────────────────────────────────────────────────────────

export abstract class SwarmAgent {
  readonly id: AgentID;
  readonly type: 'chief' | 'manager' | 'worker' | 'validator';
  readonly workspaceId: WorkspaceID;
  readonly projectId: ProjectID;
  readonly capabilities: string[];
  readonly budget: ResourceBudget;
  readonly priority: Priority;
  readonly maxConcurrentTasks: number;

  // State tracking (simpler than AgentStateMachine for simulation)
  protected _state: AgentState = AgentState.SPAWNING;
  protected phase: SwarmAgentPhase = 'spawning';

  // Resource tracking
  resourcesConsumed: ResourceConsumption = { ...ZERO_CONSUMPTION };
  resourcesAllocated: ResourceBudget = { ...ZERO_BUDGET };

  // Task tracking
  activeTaskIds: TaskID[] = [];
  completedTaskCount: number = 0;
  failedTaskCount: number = 0;

  // Message tracking
  messagesSent: number = 0;
  messagesReceived: number = 0;

  // Context dependencies
  protected context: SwarmAgentContext | null = null;

  // Failure simulation
  protected failureRate: number;
  protected rng: () => number;

  // Valid transitions (from AGENT_TRANSITIONS in types)
  private static VALID_TRANSITIONS: Record<string, string[]> = {
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

  constructor(
    config: {
      id?: AgentID;
      type: 'chief' | 'manager' | 'worker' | 'validator';
      workspaceId: WorkspaceID;
      projectId: ProjectID;
      capabilities: string[];
      budget: ResourceBudget;
      priority: Priority;
      maxConcurrentTasks: number;
      failureRate: number;
    },
    rng?: () => number,
  ) {
    this.id = config.id ?? (createUUID() as unknown as AgentID);
    this.type = config.type;
    this.workspaceId = config.workspaceId;
    this.projectId = config.projectId;
    this.capabilities = config.capabilities;
    this.budget = config.budget;
    this.priority = config.priority;
    this.maxConcurrentTasks = config.maxConcurrentTasks;
    this.failureRate = config.failureRate;
    this.rng = rng ?? Math.random;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Connect this agent to the swarm context.
   * Must be called before any other operations.
   */
  connect(context: SwarmAgentContext): void {
    this.context = context;
    this.transition(AgentState.INITIALIZING);
    this.phase = 'initializing';
    this.emitEvent('agent.state_change', { from: 'spawning', to: 'initializing' });
  }

  /**
   * Initialize the agent (INITIALIZING → READY).
   * Subclasses override to set up role-specific state.
   */
  initialize(): void {
    this.onInitialize();
    this.transition(AgentState.READY);
    this.phase = 'idle';
    this.emitEvent('agent.state_change', { from: 'initializing', to: 'ready' });
    this.sendMessage({
      type: 'agent.ready',
      recipient: '*',
      payload: { capabilities: this.capabilities, budget: this.budget },
    });
  }

  /**
   * Terminate the agent gracefully.
   */
  terminate(): void {
    if (this._state !== AgentState.TERMINATING && this._state !== AgentState.TERMINATED) {
      this.transition(AgentState.TERMINATING);
      this.phase = 'terminating';
      this.emitEvent('agent.state_change', { from: this._state, to: 'terminating' });
    }
    if (this._state === AgentState.TERMINATING) {
      this.transition(AgentState.TERMINATED);
      this.emitEvent('agent.terminated', {});
    }
  }

  // ─── Abstract Methods ───────────────────────────────────────────────────

  /** Subclass-specific initialization logic */
  protected abstract onInitialize(): void;

  /** Handle an incoming swarm message */
  abstract handleMessage(message: SwarmMessage): void;

  /** Perform one tick of work */
  abstract tick(): void;

  // ─── State Transitions ──────────────────────────────────────────────────

  get state(): AgentState {
    return this._state;
  }

  protected transition(newState: AgentState): boolean {
    const allowed = SwarmAgent.VALID_TRANSITIONS[this._state];
    if (!allowed || !allowed.includes(newState)) {
      return false;
    }
    const from = this._state;
    this._state = newState;
    this.emitEvent('agent.state_change', { from, to: newState });
    return true;
  }

  /**
   * Force a state transition without checking validity.
   * Used for simulation-level transitions like task completion
   * where the agent goes from RUNNING → READY (not in strict FSM,
   * but valid for simulation lifecycle).
   */
  protected forceTransition(newState: AgentState): void {
    const from = this._state;
    this._state = newState;
    this.emitEvent('agent.state_change', { from, to: newState });
  }

  /**
   * Check if this agent can accept another task.
   */
  canAcceptTask(): boolean {
    return this._state === AgentState.READY &&
      this.activeTaskIds.length < this.maxConcurrentTasks;
  }

  /**
   * Start working on a task.
   * If the agent is READY, transitions to RUNNING. If already RUNNING,
   * just adds the task (agent can handle multiple concurrent tasks).
   */
  startTask(taskId: TaskID): boolean {
    if (!this.canAcceptTask()) return false;
    this.activeTaskIds.push(taskId);
    if (this._state === AgentState.READY) {
      this.forceTransition(AgentState.RUNNING);
    }
    this.phase = 'working';
    return true;
  }

  /**
   * Complete a task successfully.
   * After completing all active tasks, the agent transitions back to READY.
   */
  completeTask(taskId: TaskID): void {
    this.activeTaskIds = this.activeTaskIds.filter((id) => id !== taskId);
    this.completedTaskCount++;
    if (this.activeTaskIds.length === 0) {
      this.forceTransition(AgentState.READY);
      this.phase = 'idle';
    }
  }

  /**
   * Fail a task.
   * After failing all active tasks, the agent transitions back to READY.
   */
  failTask(taskId: TaskID): void {
    this.activeTaskIds = this.activeTaskIds.filter((id) => id !== taskId);
    this.failedTaskCount++;
    if (this.activeTaskIds.length === 0) {
      this.forceTransition(AgentState.READY);
      this.phase = 'idle';
    }
  }

  /**
   * Determine if a simulated failure should occur.
   */
  shouldFail(): boolean {
    return this.rng() < this.failureRate;
  }

  /**
   * Check if the agent has a specific capability.
   */
  hasCapability(capability: string): boolean {
    return this.capabilities.includes(capability) || this.capabilities.includes('*');
  }

  // ─── Resource Tracking ──────────────────────────────────────────────────

  /**
   * Track resource consumption for this agent.
   */
  trackConsumption(consumed: ResourceConsumption): void {
    this.resourcesConsumed = {
      ru: this.resourcesConsumed.ru + consumed.ru,
      mu: this.resourcesConsumed.mu + consumed.mu,
      eu: this.resourcesConsumed.eu + consumed.eu,
      vu: this.resourcesConsumed.vu + consumed.vu,
    };
  }

  // ─── Messaging ──────────────────────────────────────────────────────────

  /**
   * Send a swarm message to another agent or broadcast.
   */
  sendMessage(message: Omit<SwarmMessage, 'id' | 'sender' | 'timestamp'>): void {
    if (!this.context) return;
    const fullMessage: SwarmMessage = {
      ...message,
      id: createUUID(),
      sender: this.id,
      timestamp: this.context.currentTime(),
    };
    this.messagesSent++;
    this.context.sendMessage(fullMessage);
    this.emitEvent('message.sent', {
      type: message.type,
      recipient: message.recipient,
    });
  }

  /**
   * Receive a message from the swarm.
   */
  receiveMessage(message: SwarmMessage): void {
    this.messagesReceived++;
    this.handleMessage(message);
  }

  // ─── Event Emission ─────────────────────────────────────────────────────

  protected emitEvent(type: string, data: Record<string, unknown>): void {
    if (!this.context) return;
    this.context.eventBus.publish({
      domain: 'swarm' as any,
      type,
      source: this.id as string,
      data: { agentId: this.id, agentType: this.type, ...data },
      timestamp: this.context.currentTime(),
    } as any);
  }

  // ─── Summary ────────────────────────────────────────────────────────────

  getSummary(): {
    id: string;
    type: string;
    state: string;
    phase: string;
    activeTasks: number;
    completed: number;
    failed: number;
    messagesSent: number;
    messagesReceived: number;
    resourcesConsumed: ResourceConsumption;
  } {
    return {
      id: this.id as string,
      type: this.type,
      state: this._state,
      phase: this.phase,
      activeTasks: this.activeTaskIds.length,
      completed: this.completedTaskCount,
      failed: this.failedTaskCount,
      messagesSent: this.messagesSent,
      messagesReceived: this.messagesReceived,
      resourcesConsumed: { ...this.resourcesConsumed },
    };
  }
}