/**
 * @agentos/swarm — WorkerAgent
 * Claims tasks from the Blackboard, acquires resource allocations from the
 * Resource Scheduler, executes assigned work using capabilities and LLM
 * integrations when required, publishes results, and reports status through ACP.
 *
 * Responsibilities:
 *   1. Scan Blackboard for available tasks matching capabilities
 *   2. Claim tasks and acquire resource allocations
 *   3. Execute work (simulate or call LLM via @agentos/llm)
 *   4. Publish results to the Blackboard
 *   5. Report status updates through ACP messages
 *
 * In simulation mode (llmMode = 'none'), work is simulated deterministically.
 * In live mode (llmMode = 'live'), WorkerAgent uses LLMClient for reasoning tasks.
 */

import type {
  AgentID,
  TaskID,
  WorkspaceID,
  ProjectID,
  Priority,
  ResourceBudget,
  ResourceConsumption,
  CapabilityPath,
  ResolutionRequest,
} from '@agentos/types';
import { createUUID, TaskState, ZERO_BUDGET, ZERO_CONSUMPTION } from '@agentos/types';
import type { CapabilityExecutor } from '@agentos/capabilities';
import type { SwarmConfig, SwarmMessage, WorkerResult } from './types.js';
import { SwarmAgent, type SwarmAgentContext } from './swarm-agent.js';

// ─── Worker Capabilities ───────────────────────────────────────────────────

const WORKER_CAPABILITIES = [
  'execute', 'implement', 'test', 'review',
  'create.code', 'create.code.typescript', 'create.code.python',
  'reason.infer.text',
];

const WORKER_BUDGET: ResourceBudget = {
  ru: 500,
  mu: 200,
  eu: 100,
  vu: 50,
};

// ─── WorkerAgent Config ────────────────────────────────────────────────────

export interface WorkerAgentConfig {
  id?: AgentID;
  workspaceId: WorkspaceID;
  projectId: ProjectID;
  priority?: Priority;
  failureRate?: number;
  budget?: ResourceBudget;
  maxConcurrentTasks?: number;
  managerId?: AgentID;
  capabilities?: string[];
}

// ─── WorkerAgent ───────────────────────────────────────────────────────────

export class WorkerAgent extends SwarmAgent {
  // Manager assignment
  private managerId: AgentID | null = null;

  // Task execution tracking
  private taskResults: Map<TaskID, WorkerResult> = new Map();
  private taskStartTimes: Map<TaskID, number> = new Map();

  // LLM integration (only used in live mode)
  private llmClient: any = null; // LLMClient, imported dynamically

  // Work simulation
  private workDurationRange: { min: number; max: number } = { min: 100, max: 800 };

  constructor(config: WorkerAgentConfig, rng?: () => number) {
    super({
      id: config.id,
      type: 'worker',
      workspaceId: config.workspaceId,
      projectId: config.projectId,
      capabilities: config.capabilities ?? WORKER_CAPABILITIES,
      budget: config.budget ?? WORKER_BUDGET,
      priority: config.priority ?? (3 as Priority),
      maxConcurrentTasks: config.maxConcurrentTasks ?? 3,
      failureRate: config.failureRate ?? 0.05,
    }, rng);
    this.managerId = config.managerId ?? null;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  protected onInitialize(): void {
    // Worker is ready to claim tasks
  }

  // ─── LLM Integration ────────────────────────────────────────────────────

  /**
   * Set the LLM client for live mode execution.
   */
  setLLMClient(client: any): void {
    this.llmClient = client;
  }

  // ─── Task Claiming ───────────────────────────────────────────────────────

  /**
   * Scan the Blackboard for available tasks and claim one.
   */
  claimAvailableTask(): TaskID | null {
    if (!this.context) return null;
    if (!this.canAcceptTask()) return null;

    const blackboard = this.context.blackboard;
    const availableTasks = blackboard.getAvailableTasks(this.capabilities);

    for (const task of availableTasks) {
      const claimResult = blackboard.claimTask(task.id, this.id, {
        id: this.id,
        capabilities: this.capabilities,
        available_resources: this.budget,
        role: 'worker',
      });

      if (claimResult.ok) {
        this.startTask(task.id);
        this.taskStartTimes.set(task.id, this.context.currentTime());

        this.sendMessage({
          type: 'task.claim',
          recipient: '*',
          payload: { taskId: task.id, capabilities: this.capabilities },
        });

        this.emitEvent('task.claimed', { taskId: task.id });
        return task.id;
      }
    }

    return null;
  }

  // ─── Task Execution ──────────────────────────────────────────────────────

  /**
   * Execute a claimed task.
   * 3-tier execution priority:
   *   1. CapabilityExecutor — real execution via resolved provider
   *   2. LLMClient — direct LLM calls (existing)
   *   3. Simulated — deterministic simulation (existing)
   */
  async executeTask(taskId: TaskID): Promise<WorkerResult | null> {
    if (!this.context) return null;

    const startTime = this.taskStartTimes.get(taskId) ?? this.context.currentTime();

    // Check for simulated failure
    if (this.shouldFail()) {
      return this.failTaskExecution(taskId, 'Simulated failure');
    }

    // Tier 1: CapabilityExecutor (real execution)
    const capabilityPath = this.resolveCapabilityFromTask(taskId);
    if (capabilityPath && this.context.capabilityExecutor) {
      return this.executeWithCapabilities(taskId, startTime, capabilityPath);
    }

    // Tier 2: LLMClient (live mode)
    if (this.llmClient && this.context.config.llmMode === 'live') {
      return this.executeWithLLM(taskId, startTime);
    }

    // Tier 3: Simulated (default)
    return this.executeSimulated(taskId, startTime);
  }

  /**
   * Simulate task execution (deterministic, no LLM calls).
   */
  executeSimulated(taskId: TaskID, startTime: number): WorkerResult {
    if (!this.context) {
      return this.createResult(taskId, { simulated: true }, 0.8 + this.rng() * 0.2);
    }

    const durationMs = this.workDurationRange.min +
      Math.floor(this.rng() * (this.workDurationRange.max - this.workDurationRange.min));

    // Simulate resource consumption
    const consumed: ResourceConsumption = {
      ru: Math.ceil(this.budget.ru * durationMs / 3_600_000) || 1,
      mu: Math.ceil(this.budget.mu * durationMs / 3_600_000) || 1,
      eu: 1,
      vu: 1,
    };

    this.trackConsumption(consumed);

    const confidence = 0.7 + this.rng() * 0.3;

    return this.createResult(taskId, { simulated: true, durationMs }, confidence, consumed, durationMs);
  }

  /**
   * Execute a task using the LLM (live mode).
   */
  private async executeWithLLM(taskId: TaskID, startTime: number): Promise<WorkerResult | null> {
    if (!this.llmClient || !this.context) return null;

    try {
      // Determine capability path based on task metadata
      const capabilityPath = this.inferCapabilityPath(taskId);

      const response = await this.llmClient.complete(
        [{ role: 'user', content: `Execute task ${taskId}` }],
        { capabilityPath },
      );

      const consumed: ResourceConsumption = response.resourcesConsumed ?? {
        ru: 1, mu: 1, eu: 1, vu: 0,
      };

      this.trackConsumption(consumed);

      const durationMs = this.context.currentTime() - startTime;

      return this.createResult(
        taskId,
        { llmOutput: response.content, model: response.model },
        0.7 + this.rng() * 0.3,
        consumed,
        durationMs,
      );
    } catch (error) {
      return this.failTaskExecution(taskId, `LLM error: ${(error as Error).message}`);
    }
  }

  /**
   * Infer the capability path for LLM routing from task metadata.
   */
  private inferCapabilityPath(taskId: TaskID): string {
    // First check for explicit capability tag
    const capPath = this.resolveCapabilityFromTask(taskId);
    if (capPath) return capPath;
    // Default to coding — most worker tasks are code execution
    return 'create.code.typescript';
  }

  /**
   * Resolve a capability path from task metadata.
   * Looks for tags with the `cap:` prefix (e.g., `cap:actuate.shell.exec`).
   */
  resolveCapabilityFromTask(taskId: TaskID): CapabilityPath | null {
    if (!this.context) return null;

    // getTask may not be available in mock/test contexts
    if (typeof this.context.blackboard.getTask !== 'function') return null;
    const task = this.context.blackboard.getTask(taskId);
    if (!task) return null;

    // Check task tags for capability path markers
    const tags = (task as any).tags ?? [];
    for (const tag of tags) {
      if (typeof tag === 'string' && tag.startsWith('cap:')) {
        return tag.slice(4) as CapabilityPath;
      }
    }

    // Check task metadata for capability_path
    const metadata = (task as any).metadata ?? {};
    if (metadata.capability_path && typeof metadata.capability_path === 'string') {
      return metadata.capability_path as CapabilityPath;
    }

    return null;
  }

  /**
   * Execute a task using the CapabilityExecutor (Tier 1).
   * Real execution through the resolved capability provider.
   */
  private async executeWithCapabilities(
    taskId: TaskID,
    startTime: number,
    capabilityPath: CapabilityPath,
  ): Promise<WorkerResult | null> {
    if (!this.context?.capabilityExecutor) return null;

    try {
      const request: ResolutionRequest = {
        capability_path: capabilityPath,
        context: {
          workspace_id: this.workspaceId,
          project_id: this.projectId,
          agent_id: this.id,
          task_id: taskId,
        },
        constraints: {},
        preferences: {
          optimize_for: 'balanced',
        },
      };

      const input = this.inferTaskInput(taskId, capabilityPath);

      const result = await this.context.capabilityExecutor.invoke(
        request,
        input,
        {
          agentId: this.id,
          taskId,
          workspaceId: this.workspaceId,
        },
        { timeoutMs: 30_000, priority: this.priority as number, retryOnFailure: true },
      );

      if (!result.ok) {
        const error = result as any;
        return this.failTaskExecution(taskId, `Capability error: ${error.error_message ?? 'Unknown'}`);
      }

      const invocationResult = result.data;
      const consumed: ResourceConsumption = invocationResult.resources_consumed ?? { ru: 1, mu: 1, eu: 1, vu: 0 };
      this.trackConsumption(consumed);

      const durationMs = this.context ? this.context.currentTime() - startTime : invocationResult.duration_ms;

      return this.createResult(
        taskId,
        { capabilityOutput: invocationResult.output, capabilityPath },
        0.8 + this.rng() * 0.2,
        consumed,
        durationMs,
      );
    } catch (error) {
      return this.failTaskExecution(taskId, `Capability execution error: ${(error as Error).message}`);
    }
  }

  /**
   * Infer task input from task metadata based on capability path.
   */
  private inferTaskInput(taskId: TaskID, capabilityPath: CapabilityPath): unknown {
    if (!this.context) return {};
    const task = this.context.blackboard.getTask(taskId);
    const metadata = (task as any)?.metadata ?? {};

    // Check for explicit input in metadata
    if (metadata.capability_input) return metadata.capability_input;

    // Provide sensible defaults based on capability root
    if (capabilityPath.startsWith('actuate.shell')) {
      return { command: metadata.command ?? 'echo', args: metadata.args ?? ['hello'] };
    }
    if (capabilityPath.startsWith('actuate.filesystem')) {
      return { path: metadata.path ?? '/tmp/agentos-task.txt', content: metadata.content ?? '' };
    }
    if (capabilityPath.startsWith('communicate.http')) {
      return { url: metadata.url ?? 'http://localhost:8080/health', method: metadata.method ?? 'GET' };
    }
    if (capabilityPath.startsWith('reason.model')) {
      return { prompt: metadata.prompt ?? 'Execute task', capabilityPath };
    }

    return metadata.input ?? {};
  }

  // ─── Task Completion ─────────────────────────────────────────────────────

  /**
   * Submit a completed task result to the Blackboard.
   */
  submitResult(result: WorkerResult): boolean {
    if (!this.context) return false;

    const blackboard = this.context.blackboard;

    const submitResult = blackboard.submitResult({
      task_id: result.taskId,
      agent_id: result.agentId,
      output: result.output,
      confidence: result.confidence,
      resources_consumed: result.resourcesConsumed,
      artifacts: [],
      duration_ms: result.durationMs,
      completed_at: this.context.currentTime().toString(),
    });

    if (submitResult.ok) {
      // Auto-validate in simulation (real validation by ValidatorAgent)
      blackboard.validateResult(result.taskId, result.agentId, true, 'worker-completed');

      this.completeTask(result.taskId);

      this.sendMessage({
        type: 'task.complete',
        recipient: '*',
        payload: {
          taskId: result.taskId,
          confidence: result.confidence,
          resourcesConsumed: result.resourcesConsumed,
        },
      });

      return true;
    }

    return false;
  }

  // ─── Failure Handling ────────────────────────────────────────────────────

  private failTaskExecution(taskId: TaskID, reason: string): WorkerResult {
    this.failTask(taskId);

    this.sendMessage({
      type: 'task.fail',
      recipient: '*',
      payload: { taskId, reason },
    });

    return this.createResult(taskId, { error: reason }, 0, ZERO_CONSUMPTION, 0);
  }

  // ─── Result Helper ───────────────────────────────────────────────────────

  private createResult(
    taskId: TaskID,
    output: unknown,
    confidence: number,
    resourcesConsumed: ResourceConsumption = ZERO_CONSUMPTION,
    durationMs: number = 0,
  ): WorkerResult {
    const result: WorkerResult = {
      taskId,
      agentId: this.id,
      output,
      confidence,
      resourcesConsumed,
      durationMs,
      llmCallsUsed: this.llmClient ? 1 : 0,
      capabilityPath: this.inferCapabilityPath(taskId),
    };

    this.taskResults.set(taskId, result);
    return result;
  }

  // ─── Message Handling ────────────────────────────────────────────────────

  handleMessage(message: SwarmMessage): void {
    switch (message.type) {
      case 'task.announce':
        // New task available — try to claim it
        this.claimAvailableTask();
        break;
      case 'validation.reject':
        // Our work was rejected — need to retry
        const rejectPayload = message.payload as any;
        this.emitEvent('task.rejected', { taskId: rejectPayload.taskId });
        break;
      case 'resource.allocate':
        // Resource allocation notification
        break;
      default:
        break;
    }
  }

  // ─── Tick ────────────────────────────────────────────────────────────────

  tick(): void {
    if (this.state !== 'ready' as any && this.state !== 'running' as any) return;

    // Try to claim available tasks
    if (this.canAcceptTask()) {
      this.claimAvailableTask();
    }

    // Process active tasks
    for (const taskId of this.activeTaskIds) {
      const result = this.executeSimulated(taskId, this.taskStartTimes.get(taskId) ?? 0);
      if (result.confidence > 0) {
        this.submitResult(result);
      }
    }
  }

  // ─── Accessors ───────────────────────────────────────────────────────────

  getTaskResults(): WorkerResult[] {
    return Array.from(this.taskResults.values());
  }

  setManagerId(managerId: AgentID): void {
    this.managerId = managerId;
  }
}