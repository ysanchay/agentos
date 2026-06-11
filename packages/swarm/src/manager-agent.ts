/**
 * @agentos/swarm — ManagerAgent
 * Translates workstreams into executable tasks, publishes them to the
 * Blackboard, monitors completion progress, detects failures, retries
 * work when appropriate, and aggregates results.
 *
 * Responsibilities:
 *   1. Accept workstream assignment from Chief
 *   2. Decompose workstream into tasks (BlackboardTask objects)
 *   3. Publish tasks to the Blackboard for Workers to claim
 *   4. Monitor task completion progress
 *   5. Detect failures and retry or escalate
 *   6. Aggregate results and report to Chief
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
import { createUUID, TaskType, TaskState, ZERO_BUDGET } from '@agentos/types';
import type { Workstream, SwarmMessage, ValidationResult } from './types.js';
import { SwarmAgent, type SwarmAgentContext } from './swarm-agent.js';

// ─── Manager Capabilities ──────────────────────────────────────────────────

const MANAGER_CAPABILITIES = [
  'track', 'assign', 'coordinate', 'review', 'manage',
  'reason.infer.text', 'coordinate.plan',
];

const MANAGER_BUDGET: ResourceBudget = {
  ru: 1000,
  mu: 500,
  eu: 200,
  vu: 100,
};

// ─── Manager Task Template ─────────────────────────────────────────────────

interface TaskTemplate {
  title: string;
  description: string;
  type: TaskType;
  priority: Priority;
  capabilities: string[];
  resourcesRequired: ResourceBudget;
  dependsOn: string[]; // Template IDs of dependencies
}

// ─── ManagerAgent Config ───────────────────────────────────────────────────

export interface ManagerAgentConfig {
  id?: AgentID;
  workspaceId: WorkspaceID;
  projectId: ProjectID;
  priority?: Priority;
  failureRate?: number;
  budget?: ResourceBudget;
  chiefId?: AgentID;
}

// ─── ManagerAgent ──────────────────────────────────────────────────────────

export class ManagerAgent extends SwarmAgent {
  // Workstream ownership
  private assignedWorkstreams: Map<string, Workstream> = new Map();
  private taskTemplates: Map<string, TaskTemplate> = new Map();
  private publishedTaskIds: TaskID[] = [];
  private chiefId: AgentID | null = null;

  // Retry tracking
  private retryAttempts: Map<TaskID, number> = new Map();
  private maxRetries: number = 3;

  // Worker management
  private workerIds: AgentID[] = [];

  constructor(config: ManagerAgentConfig, rng?: () => number) {
    super({
      id: config.id,
      type: 'manager',
      workspaceId: config.workspaceId,
      projectId: config.projectId,
      capabilities: MANAGER_CAPABILITIES,
      budget: config.budget ?? MANAGER_BUDGET,
      priority: config.priority ?? (2 as Priority),
      maxConcurrentTasks: 4,
      failureRate: config.failureRate ?? 0.03,
    }, rng);
    this.chiefId = config.chiefId ?? null;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  protected onInitialize(): void {
    // Manager is ready to receive workstream assignments
  }

  // ─── Workstream Assignment ─────────────────────────────────────────────

  /**
   * Accept a workstream from the Chief.
   * Decomposes it into tasks and publishes them to the Blackboard.
   */
  assignWorkstream(workstream: Workstream): void {
    workstream.status = 'in_progress';
    this.assignedWorkstreams.set(workstream.id, workstream);

    this.emitEvent('workstream.started', {
      workstreamId: workstream.id,
      goalId: workstream.goalId,
    });

    // Decompose workstream into tasks
    const tasks = this.decomposeWorkstream(workstream);

    // Publish each task to the Blackboard
    for (const task of tasks) {
      this.publishTask(task, workstream);
    }
  }

  /**
   * Decompose a workstream into task templates.
   * In simulation mode, this is deterministic.
   */
  private decomposeWorkstream(workstream: Workstream): TaskTemplate[] {
    const templates: TaskTemplate[] = [];

    // Calculate how many tasks based on budget
    const totalBudget = workstream.budget.ru + workstream.budget.mu;
    const taskCount = Math.max(3, Math.min(10, Math.ceil(totalBudget / 500)));

    const taskTypes: TaskType[] = [TaskType.OBJECTIVE, TaskType.STEP, TaskType.ACTION];
    const capabilitySets = [
      ['execute', 'implement'],
      ['execute', 'test'],
      ['execute', 'review'],
      ['implement'],
      ['test'],
    ];

    for (let i = 0; i < taskCount; i++) {
      const templateId = `task-${workstream.id}-${i}`;
      const taskType = taskTypes[i % taskTypes.length]!;
      const capabilities = capabilitySets[i % capabilitySets.length]!;

      // Distribute budget across tasks
      const taskBudget: ResourceBudget = {
        ru: Math.ceil(workstream.budget.ru / taskCount),
        mu: Math.ceil(workstream.budget.mu / taskCount),
        eu: Math.ceil(workstream.budget.eu / taskCount),
        vu: Math.ceil(workstream.budget.vu / taskCount),
      };

      const template: TaskTemplate = {
        title: `${workstream.title} — Task ${i + 1}`,
        description: `Execute task ${i + 1} of ${taskCount} for workstream: ${workstream.title}`,
        type: taskType,
        priority: workstream.priority,
        capabilities,
        resourcesRequired: taskBudget,
        dependsOn: i > 0 ? [`task-${workstream.id}-${i - 1}`] : [],
      };

      this.taskTemplates.set(templateId, template);
      templates.push(template);
    }

    return templates;
  }

  /**
   * Publish a task to the Blackboard.
   */
  private publishTask(template: TaskTemplate, workstream: Workstream): void {
    if (!this.context) return;

    const taskId = createUUID() as unknown as TaskID;
    const blackboard = this.context.blackboard;

    const result = blackboard.publishTask({
      id: taskId,
      title: template.title,
      description: template.description,
      type: template.type,
      priority: template.priority as any,
      state: TaskState.ANNOUNCED,
      owner: this.id,
      owner_since: this.context.currentTime().toString(),
      previous_owners: [],
      depends_on: [],
      blocks: [],
      resources_required: template.resourcesRequired,
      retry_count: 0,
      max_retries: this.maxRetries,
      tags: template.capabilities.map((c) => `capability:${c}`),
      created_at: this.context.currentTime().toString(),
      updated_at: this.context.currentTime().toString(),
    });

    if (result.ok) {
      this.publishedTaskIds.push(taskId);
      workstream.taskIds.push(taskId);

      this.sendMessage({
        type: 'task.announce',
        recipient: '*',
        payload: {
          taskId,
          workstreamId: workstream.id,
          capabilities: template.capabilities,
          priority: template.priority,
        },
      });
    }
  }

  // ─── Progress Monitoring ─────────────────────────────────────────────────

  /**
   * Get progress for a workstream.
   */
  getWorkstreamProgress(workstreamId: string): {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    pending: number;
  } {
    const workstream = this.assignedWorkstreams.get(workstreamId);
    if (!workstream || !this.context) return { total: 0, completed: 0, failed: 0, inProgress: 0, pending: 0 };

    const blackboard = this.context.blackboard;
    let completed = 0;
    let failed = 0;
    let inProgress = 0;

    for (const taskId of workstream.taskIds) {
      const task = blackboard.getTask(taskId);
      if (!task) continue;

      switch (task.state) {
        case TaskState.COMPLETED: completed++; break;
        case TaskState.FAILED: failed++; break;
        case TaskState.IN_PROGRESS:
        case TaskState.CLAIMED: inProgress++; break;
      }
    }

    return {
      total: workstream.taskIds.length,
      completed,
      failed,
      inProgress,
      pending: workstream.taskIds.length - completed - failed - inProgress,
    };
  }

  /**
   * Check all workstreams for completion.
   */
  checkWorkstreamCompletion(): void {
    for (const [wsId, ws] of this.assignedWorkstreams) {
      if (ws.status !== 'in_progress') continue;

      const progress = this.getWorkstreamProgress(wsId);

      // All tasks done?
      if (progress.completed + progress.failed === progress.total) {
        if (progress.failed > 0 && progress.failed > progress.total * 0.5) {
          // More than half failed — mark workstream as failed
          ws.status = 'failed';
          this.sendMessage({
            type: 'workstream.failed',
            recipient: this.chiefId ?? '*',
            payload: { workstreamId: wsId, goalId: ws.goalId, reason: `${progress.failed}/${progress.total} tasks failed` },
          });
        } else {
          // Enough tasks completed — mark as success
          ws.status = 'completed';
          this.sendMessage({
            type: 'workstream.completed',
            recipient: this.chiefId ?? '*',
            payload: { workstreamId: wsId, goalId: ws.goalId },
          });
        }
      }

      // Report progress
      this.sendMessage({
        type: 'workstream.progress',
        recipient: this.chiefId ?? '*',
        payload: {
          workstreamId: wsId,
          progress: progress.total > 0 ? progress.completed / progress.total : 0,
          completed: progress.completed,
          total: progress.total,
        },
      });
    }
  }

  // ─── Failure Detection & Retry ───────────────────────────────────────────

  /**
   * Handle a failed task — retry or escalate.
   */
  handleFailedTask(taskId: TaskID): void {
    const attempts = this.retryAttempts.get(taskId) ?? 0;

    if (attempts < this.maxRetries) {
      // Retry: re-announce the task
      this.retryAttempts.set(taskId, attempts + 1);

      if (this.context) {
        const blackboard = this.context.blackboard;
        const task = blackboard.getTask(taskId);

        if (task && task.state === TaskState.FAILED) {
          // Re-announce the task (reset to ANNOUNCED for another worker)
          blackboard.publishTask({
            ...task,
            state: TaskState.ANNOUNCED,
            owner: undefined,
            owner_since: undefined,
            retry_count: attempts + 1,
            updated_at: this.context.currentTime().toString(),
          });

          this.sendMessage({
            type: 'task.retry',
            recipient: '*',
            payload: { taskId, attempt: attempts + 1 },
          });

          this.emitEvent('task.retried', { taskId, attempt: attempts + 1 });
        }
      }
    } else {
      // Max retries exceeded — escalate to Chief
      this.sendMessage({
        type: 'workstream.failed',
        recipient: this.chiefId ?? '*',
        payload: {
          taskId,
          reason: `Task ${taskId} failed after ${this.maxRetries} retries`,
        },
      });
    }
  }

  // ─── Worker Registration ─────────────────────────────────────────────────

  /**
   * Register a worker with this manager.
   */
  registerWorker(workerId: AgentID): void {
    if (!this.workerIds.includes(workerId)) {
      this.workerIds.push(workerId);
    }
  }

  // ─── Message Handling ────────────────────────────────────────────────────

  handleMessage(message: SwarmMessage): void {
    switch (message.type) {
      case 'workstream.assign':
        this.handleWorkstreamAssignment(message);
        break;
      case 'task.complete':
        this.handleTaskComplete(message);
        break;
      case 'task.fail':
        this.handleTaskFail(message);
        break;
      case 'validation.result':
        this.handleValidationResult(message);
        break;
      case 'agent.ready':
        // Could be a worker registering
        break;
      default:
        break;
    }
  }

  private handleWorkstreamAssignment(message: SwarmMessage): void {
    const { workstreamId } = message.payload as any;
    // Chief assigned a workstream — we'd look it up and process it
    // In practice, the coordinator passes the full workstream object
    this.emitEvent('workstream.assigned', { workstreamId });
  }

  private handleTaskComplete(message: SwarmMessage): void {
    const { taskId } = message.payload as any;
    this.emitEvent('task.completed', { taskId });
    this.checkWorkstreamCompletion();
  }

  private handleTaskFail(message: SwarmMessage): void {
    const { taskId } = message.payload as any;
    this.handleFailedTask(taskId);
  }

  private handleValidationResult(message: SwarmMessage): void {
    const result = message.payload as ValidationResult;
    if (!result.approved) {
      this.emitEvent('validation.rejected', { taskId: result.taskId });
    }
  }

  // ─── Tick ────────────────────────────────────────────────────────────────

  tick(): void {
    if (this.state !== 'ready' as any && this.state !== 'running' as any) return;

    // Monitor workstream progress
    this.checkWorkstreamCompletion();
  }

  // ─── Accessors ───────────────────────────────────────────────────────────

  getWorkstreams(): Workstream[] {
    return Array.from(this.assignedWorkstreams.values());
  }

  getPublishedTaskIds(): TaskID[] {
    return [...this.publishedTaskIds];
  }

  getWorkerIds(): AgentID[] {
    return [...this.workerIds];
  }
}