/**
 * @agentos/kernel — Top-Level Kernel Orchestrator
 * Ties all subsystems together. The deterministic heart of AgentOS.
 * ZERO AI logic — all operations are explicit and deterministic.
 */

import {
  ok,
  err,
  KER,
  AgentState,
  AgentType,
  TaskState,
  TaskType,
  TaskPriority,
  WorkspaceState,
  PermissionScope,
  EventDomain,
  createUUID,
  ZERO_BUDGET,
  ZERO_CONSUMPTION,
  AGENT_MAX_RETRIES,
  MAX_TASK_RETRIES,
  TASK_PRIORITY_NORMAL,
} from '@agentos/types';
import type {
  Outcome,
  Agent,
  Task,
  Workspace,
  Permission,
  AgentID,
  TaskID,
  WorkspaceID,
  ProjectID,
  UserID,
  PermissionID,
  CapabilityID,
  ResourceBudget,
  Event,
} from '@agentos/types';
import type { IEventStore } from '@agentos/eventstore';
import { AgentStateMachine, type AgentTransitionContext } from './agent-lifecycle.js';
import { TaskStateMachine, type TaskTransitionContext } from './task-lifecycle.js';
import { WorkspaceStateMachine, type WorkspaceTransitionContext } from './workspace-lifecycle.js';
import { AgentRegistry } from './agent-registry.js';
import { TaskRegistry } from './task-registry.js';
import { WorkspaceRegistry } from './workspace-registry.js';
import { DependencyGraph } from './dependency-graph.js';
import { PermissionEngine } from './permission-engine.js';
import { EventBus } from './event-bus.js';
import { InvariantChecker, type InvariantReport, type InvariantViolation } from './invariant-checker.js';

// ─── Agent State Machine Map ─────────────────────────────────────────

// Each agent gets its own state machine instance
const agentStateMachines: Map<string, AgentStateMachine> = new Map();
const taskStateMachines: Map<string, TaskStateMachine> = new Map();
const workspaceStateMachines: Map<string, WorkspaceStateMachine> = new Map();

// ─── Idempotency Key Tracking ────────────────────────────────────────

const idempotencyResults: Map<string, Outcome<unknown>> = new Map();

// ─── Kernel ──────────────────────────────────────────────────────────

export class Kernel {
  public readonly agentRegistry: AgentRegistry;
  public readonly taskRegistry: TaskRegistry;
  public readonly workspaceRegistry: WorkspaceRegistry;
  public readonly dependencyGraph: DependencyGraph;
  public readonly permissionEngine: PermissionEngine;
  public readonly eventBus: EventBus;
  public readonly invariantChecker: InvariantChecker;

  constructor(deps?: { eventStore?: IEventStore }) {
    this.agentRegistry = new AgentRegistry();
    this.taskRegistry = new TaskRegistry();
    this.workspaceRegistry = new WorkspaceRegistry();
    this.dependencyGraph = new DependencyGraph();
    this.permissionEngine = new PermissionEngine();
    this.eventBus = new EventBus(deps?.eventStore);
    this.invariantChecker = new InvariantChecker({
      agentRegistry: this.agentRegistry,
      taskRegistry: this.taskRegistry,
      workspaceRegistry: this.workspaceRegistry,
      dependencyGraph: this.dependencyGraph,
      permissionEngine: this.permissionEngine,
      eventBus: this.eventBus,
    });
  }

  // ─── Agent Operations ────────────────────────────────────────────

  /** Spawn a new agent: creates agent, transitions spawning -> initializing -> ready. */
  spawnAgent(spec: {
    name: string;
    type: AgentType;
    workspace_id: WorkspaceID;
    project_id: ProjectID;
    owner_user_id: UserID;
    capabilities: string[];
    resource_limits: ResourceBudget;
    idempotencyKey?: string;
    metadata?: Record<string, string>;
    tags?: string[];
  }): Outcome<Agent> {
    // Idempotency check
    if (spec.idempotencyKey) {
      const existing = idempotencyResults.get(spec.idempotencyKey);
      if (existing) return existing as Outcome<Agent>;
    }

    // Check workspace exists
    const workspace = this.workspaceRegistry.get(spec.workspace_id);
    if (!workspace) {
      const result = err(KER.WORKSPACE_NOT_FOUND, `Workspace "${spec.workspace_id}" not found`, { retryable: false });
      if (spec.idempotencyKey) idempotencyResults.set(spec.idempotencyKey, result);
      return result;
    }

    const agentId = createUUID() as unknown as AgentID;
    const now = new Date().toISOString();

    const agent: Agent = {
      id: agentId,
      name: spec.name,
      type: spec.type,
      state: AgentState.SPAWNING,
      workspace_id: spec.workspace_id,
      project_id: spec.project_id,
      capabilities: spec.capabilities.map((c) => c as unknown as CapabilityID),
      permissions: [],
      resources_allocated: ZERO_BUDGET,
      resources_consumed: ZERO_CONSUMPTION,
      resource_limits: spec.resource_limits,
      parent_agent_id: undefined,
      child_agent_ids: [],
      active_task_ids: [],
      completed_task_count: 0,
      failed_task_count: 0,
      owner_user_id: spec.owner_user_id,
      public_key: '',
      metadata: spec.metadata ?? {},
      tags: spec.tags ?? [],
      created_at: now,
      updated_at: now,
    };

    // Register agent
    const regResult = this.agentRegistry.register(agent);
    if (!regResult.ok) {
      if (spec.idempotencyKey) idempotencyResults.set(spec.idempotencyKey, regResult as Outcome<Agent>);
      return regResult as Outcome<Agent>;
    }

    // Create state machine for agent
    const sm = new AgentStateMachine((from, to, ctx) => {
      this.emitAgentTransition(agentId, from, to, ctx);
    });
    agentStateMachines.set(agentId, sm);

    // Transition: spawning -> initializing
    const initResult = sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, {
      processCreated: true,
    });
    if (!initResult.ok) {
      if (spec.idempotencyKey) idempotencyResults.set(spec.idempotencyKey, initResult as Outcome<Agent>);
      return initResult as Outcome<Agent>;
    }

    // Update agent state
    this.agentRegistry.update(agentId, { state: AgentState.INITIALIZING, updated_at: new Date().toISOString() });

    // Transition: initializing -> ready
    const readyResult = sm.transition(AgentState.INITIALIZING, AgentState.READY, {
      capabilitiesLoaded: true,
    });
    if (!readyResult.ok) {
      if (spec.idempotencyKey) idempotencyResults.set(spec.idempotencyKey, readyResult as Outcome<Agent>);
      return readyResult as Outcome<Agent>;
    }

    // Update agent state
    const finalUpdate = this.agentRegistry.update(agentId, {
      state: AgentState.READY,
      updated_at: new Date().toISOString(),
    });

    const result = finalUpdate.ok ? ok(finalUpdate.data) : ok({ ...agent, state: AgentState.READY });
    if (spec.idempotencyKey) idempotencyResults.set(spec.idempotencyKey, result);
    return result;
  }

  /** Terminate an agent: transitions to terminating -> terminated. */
  terminateAgent(agentId: AgentID): Outcome<true> {
    const agent = this.agentRegistry.get(agentId);
    if (!agent) {
      return err(KER.AGENT_NOT_FOUND, `Agent "${agentId}" not found`, { retryable: false });
    }

    const sm = agentStateMachines.get(agentId);
    if (!sm) {
      return err(KER.AGENT_NOT_FOUND, `No state machine for agent "${agentId}"`, { retryable: false });
    }

    // Transition to terminating
    const termResult = sm.transition(agent.state, AgentState.TERMINATING, {
      shutdownSignal: true,
    });
    if (!termResult.ok) return err(KER.INVALID_STATE_TRANSITION, termResult.error_message, { retryable: false });

    this.agentRegistry.update(agentId, { state: AgentState.TERMINATING, updated_at: new Date().toISOString() });

    // Transition to terminated
    const finalResult = sm.transition(AgentState.TERMINATING, AgentState.TERMINATED, {
      cleanupComplete: true,
    });
    if (!finalResult.ok) return err(KER.INVALID_STATE_TRANSITION, finalResult.error_message, { retryable: false });

    const now = new Date().toISOString();
    this.agentRegistry.update(agentId, {
      state: AgentState.TERMINATED,
      terminated_at: now,
      updated_at: now,
    });

    return ok(true);
  }

  /** Send a signal to an agent (pause/resume/kill/suspend). */
  signalAgent(agentId: AgentID, signal: 'pause' | 'resume' | 'kill' | 'suspend'): Outcome<AgentState> {
    const agent = this.agentRegistry.get(agentId);
    if (!agent) {
      return err(KER.AGENT_NOT_FOUND, `Agent "${agentId}" not found`, { retryable: false });
    }

    const sm = agentStateMachines.get(agentId);
    if (!sm) {
      return err(KER.AGENT_NOT_FOUND, `No state machine for agent "${agentId}"`, { retryable: false });
    }

    let result: Outcome<AgentState>;

    switch (signal) {
      case 'pause': {
        const ctx: AgentTransitionContext = { pauseSignal: true };
        result = sm.transition(agent.state, AgentState.PAUSED, ctx);
        break;
      }
      case 'resume': {
        const ctx: AgentTransitionContext = { resumeSignal: true, resourcesAvailable: true };
        result = sm.transition(agent.state, AgentState.RUNNING, ctx);
        break;
      }
      case 'kill': {
        const ctx: AgentTransitionContext = { killSignal: true };
        result = sm.transition(agent.state, AgentState.TERMINATING, ctx);
        break;
      }
      case 'suspend': {
        result = sm.suspend();
        break;
      }
      default:
        return err(KER.INVALID_ARGUMENT, `Unknown signal "${signal}"`, { retryable: false });
    }

    if (!result.ok) return result;

    this.agentRegistry.update(agentId, {
      state: result.data,
      updated_at: new Date().toISOString(),
    });

    return result;
  }

  // ─── Task Operations ─────────────────────────────────────────────

  /** Create a task in draft state. */
  createTask(spec: {
    title: string;
    description: string;
    type: TaskType;
    workspace_id: WorkspaceID;
    project_id: ProjectID;
    priority?: typeof TASK_PRIORITY_NORMAL;
    depends_on?: TaskID[];
    max_retries?: number;
    deadline?: string;
    metadata?: Record<string, string>;
    tags?: string[];
    idempotencyKey?: string;
  }): Outcome<Task> {
    // Idempotency check
    if (spec.idempotencyKey) {
      const existing = idempotencyResults.get(spec.idempotencyKey);
      if (existing) return existing as Outcome<Task>;
    }

    const taskId = createUUID() as unknown as TaskID;
    const now = new Date().toISOString();

    const task: Task = {
      id: taskId,
      title: spec.title,
      description: spec.description,
      type: spec.type,
      priority: spec.priority ?? TASK_PRIORITY_NORMAL,
      state: TaskState.DRAFT,
      workspace_id: spec.workspace_id,
      project_id: spec.project_id,
      assignee_id: undefined,
      claimed_by: undefined,
      claimed_at: undefined,
      parent_task_id: undefined,
      child_task_ids: [],
      depends_on: spec.depends_on ?? [],
      blocks: [],
      resources_required: ZERO_BUDGET,
      result: undefined,
      error: undefined,
      deadline: spec.deadline,
      retry_count: 0,
      max_retries: spec.max_retries ?? MAX_TASK_RETRIES,
      previous_assignees: [],
      tags: spec.tags ?? [],
      metadata: spec.metadata ?? {},
      created_at: now,
      updated_at: now,
    };

    // Add to dependency graph
    if (task.depends_on.length > 0) {
      const graphResult = this.dependencyGraph.addTask(taskId, task.depends_on);
      if (!graphResult.ok) {
        if (spec.idempotencyKey) idempotencyResults.set(spec.idempotencyKey, graphResult as Outcome<Task>);
        return graphResult as Outcome<Task>;
      }
    } else {
      // Add task with no dependencies
      this.dependencyGraph.addTask(taskId, []);
    }

    // Register task
    const regResult = this.taskRegistry.create(task);
    if (!regResult.ok) {
      if (spec.idempotencyKey) idempotencyResults.set(spec.idempotencyKey, regResult as Outcome<Task>);
      return regResult as Outcome<Task>;
    }

    // Create state machine for task
    const sm = new TaskStateMachine(task.retry_count, (from, to, ctx) => {
      this.emitTaskTransition(taskId, from, to, ctx);
    });
    taskStateMachines.set(taskId, sm);

    // Emit creation event
    this.eventBus.publish(this.eventBus.createEvent(EventDomain.TASK, 'task.created', 'kernel', {
      entity_type: 'task',
      entity_id: taskId,
      from_state: null,
      to_state: TaskState.DRAFT,
    }));

    const result = ok(task);
    if (spec.idempotencyKey) idempotencyResults.set(spec.idempotencyKey, result);
    return result;
  }

  /** Announce a task: transitions draft -> announced. */
  announceTask(taskId: TaskID): Outcome<Task> {
    const task = this.taskRegistry.get(taskId);
    if (!task) {
      return err(KER.TASK_NOT_FOUND, `Task "${taskId}" not found`, { retryable: false });
    }

    const sm = taskStateMachines.get(taskId);
    if (!sm) {
      return err(KER.TASK_NOT_FOUND, `No state machine for task "${taskId}"`, { retryable: false });
    }

    // Check dependencies are valid
    const depsValid = task.depends_on.every((depId) => this.dependencyGraph.has(depId));

    const ctx: TaskTransitionContext = {
      fullyDefined: task.title.length > 0 && task.description.length > 0,
      depsValid,
      creatorHasPermission: true, // Permission check is done at a higher level
    };

    const result = sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, ctx);
    if (!result.ok) return err(KER.INVALID_STATE_TRANSITION, result.error_message, { retryable: false });

    this.taskRegistry.update(taskId, { state: TaskState.ANNOUNCED, updated_at: new Date().toISOString() });
    return ok(this.taskRegistry.get(taskId)!);
  }

  /** Claim a task: transitions announced -> claimed. */
  claimTask(taskId: TaskID, agentId: AgentID): Outcome<Task> {
    const task = this.taskRegistry.get(taskId);
    if (!task) {
      return err(KER.TASK_NOT_FOUND, `Task "${taskId}" not found`, { retryable: false });
    }

    const sm = taskStateMachines.get(taskId);
    if (!sm) {
      return err(KER.TASK_NOT_FOUND, `No state machine for task "${taskId}"`, { retryable: false });
    }

    const ctx: TaskTransitionContext = { claimAccepted: true };
    const result = sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, ctx);
    if (!result.ok) return err(KER.INVALID_STATE_TRANSITION, result.error_message, { retryable: false });

    const now = new Date().toISOString();
    this.taskRegistry.update(taskId, {
      state: TaskState.CLAIMED,
      assignee_id: agentId,
      claimed_by: agentId,
      claimed_at: now,
      updated_at: now,
    });
    return ok(this.taskRegistry.get(taskId)!);
  }

  /** Start a task: transitions claimed -> in_progress. */
  startTask(taskId: TaskID): Outcome<Task> {
    const task = this.taskRegistry.get(taskId);
    if (!task) {
      return err(KER.TASK_NOT_FOUND, `Task "${taskId}" not found`, { retryable: false });
    }

    const sm = taskStateMachines.get(taskId);
    if (!sm) {
      return err(KER.TASK_NOT_FOUND, `No state machine for task "${taskId}"`, { retryable: false });
    }

    const ctx: TaskTransitionContext = { workStarted: true };
    const result = sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, ctx);
    if (!result.ok) return err(KER.INVALID_STATE_TRANSITION, result.error_message, { retryable: false });

    this.taskRegistry.update(taskId, { state: TaskState.IN_PROGRESS, updated_at: new Date().toISOString() });
    return ok(this.taskRegistry.get(taskId)!);
  }

  /** Complete a task: transitions in_progress -> completed (or review). */
  completeTask(taskId: TaskID, result?: unknown): Outcome<Task> {
    const task = this.taskRegistry.get(taskId);
    if (!task) {
      return err(KER.TASK_NOT_FOUND, `Task "${taskId}" not found`, { retryable: false });
    }

    const sm = taskStateMachines.get(taskId);
    if (!sm) {
      return err(KER.TASK_NOT_FOUND, `No state machine for task "${taskId}"`, { retryable: false });
    }

    // Try direct completion first
    let transitionResult: Outcome<TaskState>;
    const ctx: TaskTransitionContext = { resultAccepted: true };
    transitionResult = sm.transition(TaskState.IN_PROGRESS, TaskState.COMPLETED, ctx);

    if (!transitionResult.ok) {
      // Try review path
      const reviewCtx: TaskTransitionContext = { resultSubmitted: true };
      transitionResult = sm.transition(TaskState.IN_PROGRESS, TaskState.REVIEW, reviewCtx);
      if (!transitionResult.ok) {
        return err(KER.INVALID_STATE_TRANSITION, transitionResult.error_message, { retryable: false });
      }

      this.taskRegistry.update(taskId, {
        state: TaskState.REVIEW,
        result,
        updated_at: new Date().toISOString(),
      });
      return ok(this.taskRegistry.get(taskId)!);
    }

    const now = new Date().toISOString();
    this.taskRegistry.update(taskId, {
      state: TaskState.COMPLETED,
      result,
      completed_at: now,
      updated_at: now,
    });
    return ok(this.taskRegistry.get(taskId)!);
  }

  /** Fail a task: transitions in_progress -> failed. */
  failTask(taskId: TaskID, error: string): Outcome<Task> {
    const task = this.taskRegistry.get(taskId);
    if (!task) {
      return err(KER.TASK_NOT_FOUND, `Task "${taskId}" not found`, { retryable: false });
    }

    const sm = taskStateMachines.get(taskId);
    if (!sm) {
      return err(KER.TASK_NOT_FOUND, `No state machine for task "${taskId}"`, { retryable: false });
    }

    const ctx: TaskTransitionContext = { unrecoverableFailure: true };
    const result = sm.transition(task.state, TaskState.FAILED, ctx);
    if (!result.ok) return err(KER.INVALID_STATE_TRANSITION, result.error_message, { retryable: false });

    const now = new Date().toISOString();
    this.taskRegistry.update(taskId, {
      state: TaskState.FAILED,
      error,
      failed_at: now,
      retry_count: sm.getRetryCount(),
      updated_at: now,
    });
    return ok(this.taskRegistry.get(taskId)!);
  }

  /** Block a task: transitions in_progress -> blocked. */
  blockTask(taskId: TaskID, reason: string): Outcome<Task> {
    const task = this.taskRegistry.get(taskId);
    if (!task) {
      return err(KER.TASK_NOT_FOUND, `Task "${taskId}" not found`, { retryable: false });
    }

    const sm = taskStateMachines.get(taskId);
    if (!sm) {
      return err(KER.TASK_NOT_FOUND, `No state machine for task "${taskId}"`, { retryable: false });
    }

    const ctx: TaskTransitionContext = { missingDependency: true };
    const result = sm.transition(task.state, TaskState.BLOCKED, ctx);
    if (!result.ok) return err(KER.INVALID_STATE_TRANSITION, result.error_message, { retryable: false });

    this.taskRegistry.update(taskId, {
      state: TaskState.BLOCKED,
      error: reason,
      updated_at: new Date().toISOString(),
    });
    return ok(this.taskRegistry.get(taskId)!);
  }

  /** Unblock a task: transitions blocked -> in_progress. */
  unblockTask(taskId: TaskID): Outcome<Task> {
    const task = this.taskRegistry.get(taskId);
    if (!task) {
      return err(KER.TASK_NOT_FOUND, `Task "${taskId}" not found`, { retryable: false });
    }

    const sm = taskStateMachines.get(taskId);
    if (!sm) {
      return err(KER.TASK_NOT_FOUND, `No state machine for task "${taskId}"`, { retryable: false });
    }

    const ctx: TaskTransitionContext = { blockerResolved: true };
    const result = sm.transition(TaskState.BLOCKED, TaskState.IN_PROGRESS, ctx);
    if (!result.ok) return err(KER.INVALID_STATE_TRANSITION, result.error_message, { retryable: false });

    this.taskRegistry.update(taskId, {
      state: TaskState.IN_PROGRESS,
      error: undefined,
      updated_at: new Date().toISOString(),
    });
    return ok(this.taskRegistry.get(taskId)!);
  }

  /** Cancel a task. */
  cancelTask(taskId: TaskID): Outcome<Task> {
    const task = this.taskRegistry.get(taskId);
    if (!task) {
      return err(KER.TASK_NOT_FOUND, `Task "${taskId}" not found`, { retryable: false });
    }

    const sm = taskStateMachines.get(taskId);
    if (!sm) {
      return err(KER.TASK_NOT_FOUND, `No state machine for task "${taskId}"`, { retryable: false });
    }

    const ctx: TaskTransitionContext = { goalCancelled: true };
    const result = sm.transition(task.state, TaskState.CANCELLED, ctx);
    if (!result.ok) return err(KER.INVALID_STATE_TRANSITION, result.error_message, { retryable: false });

    this.taskRegistry.update(taskId, { state: TaskState.CANCELLED, updated_at: new Date().toISOString() });
    return ok(this.taskRegistry.get(taskId)!);
  }

  // ─── Workspace Operations ────────────────────────────────────────

  /** Create a workspace. */
  createWorkspace(spec: {
    name: string;
    description: string;
    project_id: ProjectID;
    owner_id: UserID;
    resource_quota: ResourceBudget;
    max_agents?: number;
    metadata?: Record<string, string>;
    tags?: string[];
  }): Outcome<Workspace> {
    const workspaceId = createUUID() as unknown as WorkspaceID;
    const now = new Date().toISOString();

    const workspace: Workspace = {
      id: workspaceId,
      name: spec.name,
      description: spec.description,
      state: WorkspaceState.CREATING,
      project_id: spec.project_id,
      owner_id: spec.owner_id,
      agent_ids: [],
      task_ids: [],
      resource_quota: spec.resource_quota,
      resource_consumed: ZERO_CONSUMPTION,
      max_agents: spec.max_agents ?? 10,
      memory_scope: 'workspace',
      default_priority: TASK_PRIORITY_NORMAL,
      auto_pause_on_budget_exhaustion: true,
      metadata: spec.metadata ?? {},
      tags: spec.tags ?? [],
      created_at: now,
      updated_at: now,
    };

    const regResult = this.workspaceRegistry.create(workspace);
    if (!regResult.ok) return regResult;

    // Create state machine
    const sm = new WorkspaceStateMachine((from, to, ctx) => {
      this.emitWorkspaceTransition(workspaceId, from, to, ctx);
    });
    workspaceStateMachines.set(workspaceId, sm);

    // Transition to active
    const activeResult = sm.transition(WorkspaceState.CREATING, WorkspaceState.ACTIVE, {
      agentsSpawned: true,
      resourcesAllocated: true,
    });
    if (!activeResult.ok) {
      return err(KER.INVALID_STATE_TRANSITION, activeResult.error_message, { retryable: false });
    }

    this.workspaceRegistry.update(workspaceId, { state: WorkspaceState.ACTIVE, updated_at: new Date().toISOString() });

    // Emit event
    this.eventBus.publish(this.eventBus.createEvent(EventDomain.WORKSPACE, 'workspace.created', 'kernel', {
      entity_type: 'workspace',
      entity_id: workspaceId,
      from_state: WorkspaceState.CREATING,
      to_state: WorkspaceState.ACTIVE,
    }));

    return ok(this.workspaceRegistry.get(workspaceId)!);
  }

  /** Destroy a workspace: transitions to deleting -> deleted. */
  destroyWorkspace(workspaceId: WorkspaceID): Outcome<true> {
    const workspace = this.workspaceRegistry.get(workspaceId);
    if (!workspace) {
      return err(KER.WORKSPACE_NOT_FOUND, `Workspace "${workspaceId}" not found`, { retryable: false });
    }

    const sm = workspaceStateMachines.get(workspaceId);
    if (!sm) {
      return err(KER.WORKSPACE_NOT_FOUND, `No state machine for workspace "${workspaceId}"`, { retryable: false });
    }

    // Transition to deleting (from whatever state is appropriate)
    if (workspace.state === WorkspaceState.ARCHIVED) {
      const delResult = sm.transition(WorkspaceState.ARCHIVED, WorkspaceState.DELETING, { deleteRequest: true });
      if (!delResult.ok) return err(KER.INVALID_STATE_TRANSITION, delResult.error_message, { retryable: false });
    } else if (workspace.state === WorkspaceState.ACTIVE) {
      // Must archive first, then delete
      const archResult = sm.transition(WorkspaceState.ACTIVE, WorkspaceState.ARCHIVING, { archiveRequest: true });
      if (!archResult.ok) return err(KER.INVALID_STATE_TRANSITION, archResult.error_message, { retryable: false });
      this.workspaceRegistry.update(workspaceId, { state: WorkspaceState.ARCHIVING, updated_at: new Date().toISOString() });

      const archivedResult = sm.transition(WorkspaceState.ARCHIVING, WorkspaceState.ARCHIVED, { agentsTerminated: true });
      if (!archivedResult.ok) return err(KER.INVALID_STATE_TRANSITION, archivedResult.error_message, { retryable: false });
      this.workspaceRegistry.update(workspaceId, { state: WorkspaceState.ARCHIVED, archived_at: new Date().toISOString(), updated_at: new Date().toISOString() });

      const delResult = sm.transition(WorkspaceState.ARCHIVED, WorkspaceState.DELETING, { deleteRequest: true });
      if (!delResult.ok) return err(KER.INVALID_STATE_TRANSITION, delResult.error_message, { retryable: false });
    } else {
      return err(KER.INVALID_STATE_TRANSITION, `Cannot destroy workspace in state "${workspace.state}"`, { retryable: false });
    }

    this.workspaceRegistry.update(workspaceId, { state: WorkspaceState.DELETING, updated_at: new Date().toISOString() });

    // Transition to deleted
    const finalResult = sm.transition(WorkspaceState.DELETING, WorkspaceState.DELETED);
    if (!finalResult.ok) return err(KER.INVALID_STATE_TRANSITION, finalResult.error_message, { retryable: false });

    const now = new Date().toISOString();
    this.workspaceRegistry.update(workspaceId, { state: WorkspaceState.DELETED, deleted_at: now, updated_at: now });

    return ok(true);
  }

  /** Pause a workspace. */
  pauseWorkspace(workspaceId: WorkspaceID): Outcome<true> {
    const workspace = this.workspaceRegistry.get(workspaceId);
    if (!workspace) {
      return err(KER.WORKSPACE_NOT_FOUND, `Workspace "${workspaceId}" not found`, { retryable: false });
    }

    const sm = workspaceStateMachines.get(workspaceId);
    if (!sm) {
      return err(KER.WORKSPACE_NOT_FOUND, `No state machine for workspace "${workspaceId}"`, { retryable: false });
    }

    const result = sm.transition(workspace.state, WorkspaceState.PAUSED, { adminPause: true });
    if (!result.ok) return err(KER.INVALID_STATE_TRANSITION, result.error_message, { retryable: false });

    this.workspaceRegistry.update(workspaceId, { state: WorkspaceState.PAUSED, updated_at: new Date().toISOString() });
    return ok(true);
  }

  /** Resume a workspace. */
  resumeWorkspace(workspaceId: WorkspaceID): Outcome<true> {
    const workspace = this.workspaceRegistry.get(workspaceId);
    if (!workspace) {
      return err(KER.WORKSPACE_NOT_FOUND, `Workspace "${workspaceId}" not found`, { retryable: false });
    }

    const sm = workspaceStateMachines.get(workspaceId);
    if (!sm) {
      return err(KER.WORKSPACE_NOT_FOUND, `No state machine for workspace "${workspaceId}"`, { retryable: false });
    }

    const result = sm.transition(workspace.state, WorkspaceState.ACTIVE, { budgetRestored: true });
    if (!result.ok) return err(KER.INVALID_STATE_TRANSITION, result.error_message, { retryable: false });

    this.workspaceRegistry.update(workspaceId, { state: WorkspaceState.ACTIVE, updated_at: new Date().toISOString() });
    return ok(true);
  }

  // ─── Permission Operations ───────────────────────────────────────

  /** Grant a permission. Also updates the agent's permissions array in the registry. */
  grantPermission(permission: Permission): Outcome<true> {
    const result = this.permissionEngine.grant(permission);
    if (!result.ok) return result;
    // Update the agent's permissions array so the invariant checker sees it
    if (permission.grantee_type === 'agent') {
      const agent = this.agentRegistry.get(permission.grantee_id as unknown as AgentID);
      if (agent) {
        this.agentRegistry.update(agent.id, {
          permissions: [...agent.permissions, permission.id],
        });
      }
    }
    return ok(true);
  }

  /** Revoke a permission. */
  revokePermission(permissionId: PermissionID): Outcome<true> {
    return this.permissionEngine.revoke(permissionId);
  }

  /** Check if an agent has a specific permission. */
  checkPermission(agentId: AgentID, capability: string, scope: PermissionScope): Outcome<true> {
    return this.permissionEngine.check(agentId, capability, scope);
  }

  // ─── Query Operations ────────────────────────────────────────────

  /** Get an agent by ID. */
  getAgent(id: AgentID): Agent | undefined {
    return this.agentRegistry.get(id);
  }

  /** Get a task by ID. */
  getTask(id: TaskID): Task | undefined {
    return this.taskRegistry.get(id);
  }

  /** Get a workspace by ID. */
  getWorkspace(id: WorkspaceID): Workspace | undefined {
    return this.workspaceRegistry.get(id);
  }

  /** List agents, optionally filtered. */
  listAgents(filter?: { workspace_id?: WorkspaceID; state?: AgentState; capability?: string }): Agent[] {
    return this.agentRegistry.list(filter);
  }

  /** List tasks, optionally filtered. */
  listTasks(filter?: { workspace_id?: WorkspaceID; state?: TaskState; assignee_id?: AgentID }): Task[] {
    return this.taskRegistry.list(filter);
  }

  /** Check all kernel invariants. */
  checkInvariants(): InvariantReport {
    return this.invariantChecker.checkAll();
  }

  // ─── Event Emission Helpers ──────────────────────────────────────

  private emitAgentTransition(
    agentId: AgentID,
    from: AgentState,
    to: AgentState,
    ctx?: AgentTransitionContext,
  ): void {
    const event = this.eventBus.createEvent(EventDomain.AGENT, 'agent.transition', 'kernel', {
      entity_type: 'agent',
      entity_id: agentId,
      from_state: from,
      to_state: to,
      action: 'transition',
      context: ctx,
    });
    this.eventBus.publish(event);
  }

  private emitTaskTransition(
    taskId: TaskID,
    from: TaskState,
    to: TaskState,
    ctx?: TaskTransitionContext,
  ): void {
    const event = this.eventBus.createEvent(EventDomain.TASK, 'task.transition', 'kernel', {
      entity_type: 'task',
      entity_id: taskId,
      from_state: from,
      to_state: to,
      action: 'transition',
      context: ctx,
    });
    this.eventBus.publish(event);
  }

  private emitWorkspaceTransition(
    workspaceId: WorkspaceID,
    from: WorkspaceState,
    to: WorkspaceState,
    ctx?: WorkspaceTransitionContext,
  ): void {
    const event = this.eventBus.createEvent(EventDomain.WORKSPACE, 'workspace.transition', 'kernel', {
      entity_type: 'workspace',
      entity_id: workspaceId,
      from_state: from,
      to_state: to,
      action: 'transition',
      context: ctx,
    });
    this.eventBus.publish(event);
  }
}