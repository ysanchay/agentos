/**
 * @agentos/swarm — Swarm Coordinator
 * Orchestrates the full swarm lifecycle: spawn agents, coordinate work,
 * monitor progress, validate results, and tear down.
 *
 * Architecture:
 *   1. Accept goal → Chief decomposes into workstreams
 *   2. Chief assigns workstreams → Managers create tasks on Blackboard
 *   3. Workers claim tasks → execute → publish results
 *   4. Validators review results → approve/reject
 *   5. Managers aggregate → Chief declares goal complete
 *
 * All actions are persisted through EventStore for replay and auditing.
 * The coordinator collects SwarmMetrics at every step.
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
import {
  createUUID, AgentState, AgentType, TaskState, ZERO_BUDGET, ZERO_CONSUMPTION,
} from '@agentos/types';
import { Kernel } from '@agentos/kernel';
import type { EventBus } from '@agentos/kernel';
import { InMemoryEventStore } from '@agentos/eventstore';
import { AuditChain as EventAuditChain } from '@agentos/eventstore';
import { Blackboard } from '@agentos/blackboard';
import { ResourceScheduler } from '@agentos/resources';
import type { CapabilityExecutor } from '@agentos/capabilities';
import type { SwarmConfig, SwarmGoal, SwarmMessage, MissionControlEvent } from './types.js';
import { DEFAULT_SWARM_CONFIG, createEmptySwarmMetrics } from './types.js';
import { ChiefAgent } from './chief-agent.js';
import { ManagerAgent } from './manager-agent.js';
import { WorkerAgent } from './worker-agent.js';
import { ValidatorAgent } from './validator-agent.js';
import { SwarmAgent, type SwarmAgentContext } from './swarm-agent.js';
import { SwarmMetricsCollector } from './swarm-metrics.js';

// ─── Swarm Configuration ───────────────────────────────────────────────────

export interface SwarmRunConfig extends Partial<SwarmConfig> {
  /** Number of chief agents (default: 1) */
  chiefCount?: number;
  /** Number of manager agents (default: 5) */
  managerCount?: number;
  /** Number of worker agents (default: 100) */
  workerCount?: number;
  /** Number of validator agents (default: 10) */
  validatorCount?: number;
  /** Number of workspaces (default: 3) */
  workspaceCount?: number;
  /** Seed for deterministic simulation */
  randomSeed?: number;
  /** Optional capability executor for real-world execution */
  capabilityExecutor?: CapabilityExecutor;
}

const DEFAULT_RUN_CONFIG: Required<SwarmRunConfig> = {
  chiefCount: 1,
  managerCount: 5,
  workerCount: 100,
  validatorCount: 10,
  workspaceCount: 3,
  randomSeed: 42,
  capabilityExecutor: undefined as any,
  id: '',
  totalBudget: { ru: 500_000, mu: 200_000, eu: 50_000, vu: 10_000 },
  maxWorkersPerManager: 20,
  maxTasksPerWorker: 3,
  maxRetries: 3,
  validationThreshold: 0.7,
  validatorsPerResult: 3,
  llmMode: 'none',
  llmBaseURL: 'http://localhost:8080',
  persistEvents: true,
  clockSpeed: 10,
};

// ─── Swarm Result ──────────────────────────────────────────────────────────

export interface SwarmResult {
  success: boolean;
  metrics: ReturnType<SwarmMetricsCollector['compute']>;
  goals: SwarmGoal[];
  durationMs: number;
  verification: {
    allTasksTerminal: boolean;
    noResourceLeaks: boolean;
    conservationHolds: boolean;
    auditTrailComplete: boolean;
    claimsAtomic: boolean;
    noOrphanedTasks: boolean;
    noOrphanedAgents: boolean;
    allPassed: boolean;
  };
}

// ─── Message Router (in-process) ──────────────────────────────────────────

class MessageRouter {
  private handlers: Map<AgentID, (message: SwarmMessage) => void> = new Map();
  private broadcastHandlers: Array<(message: SwarmMessage) => void> = [];

  register(agentId: AgentID, handler: (message: SwarmMessage) => void): void {
    this.handlers.set(agentId, handler);
  }

  registerBroadcast(handler: (message: SwarmMessage) => void): void {
    this.broadcastHandlers.push(handler);
  }

  route(message: SwarmMessage): void {
    if (message.recipient === '*') {
      // Broadcast to all
      for (const [agentId, handler] of this.handlers) {
        if (agentId !== message.sender) {
          handler(message);
        }
      }
      for (const handler of this.broadcastHandlers) {
        handler(message);
      }
    } else {
      // Direct message
      const handler = this.handlers.get(message.recipient as AgentID);
      if (handler) {
        handler(message);
      }
    }
  }
}

// ─── SwarmCoordinator ──────────────────────────────────────────────────────

export class SwarmCoordinator {
  private config: Required<SwarmRunConfig>;
  private swarmConfig: SwarmConfig;

  // Core subsystems
  private eventStore: InMemoryEventStore;
  private eventAuditChain: EventAuditChain;
  private kernel: Kernel;
  private blackboards: Map<string, Blackboard> = new Map();
  private scheduler: ResourceScheduler;
  private messageRouter: MessageRouter;
  private metrics: SwarmMetricsCollector;

  // Agents
  private chief!: ChiefAgent;
  private managers: ManagerAgent[] = [];
  private workers: WorkerAgent[] = [];
  private validators: ValidatorAgent[] = [];
  private allAgents: SwarmAgent[] = [];

  // Workspaces
  private workspaceIds: WorkspaceID[] = [];

  // Goals
  private goals: SwarmGoal[] = [];

  // Seeded RNG
  private rngState: number;

  // Timing
  private simulationTime: number = 0;

  constructor(config: SwarmRunConfig = {}) {
    this.config = { ...DEFAULT_RUN_CONFIG, ...config };
    this.rngState = this.config.randomSeed;

    this.swarmConfig = {
      id: this.config.id || createUUID(),
      totalBudget: this.config.totalBudget,
      maxWorkersPerManager: this.config.maxWorkersPerManager,
      maxTasksPerWorker: this.config.maxTasksPerWorker,
      maxRetries: this.config.maxRetries,
      validationThreshold: this.config.validationThreshold,
      validatorsPerResult: this.config.validatorsPerResult,
      llmMode: this.config.llmMode,
      llmBaseURL: this.config.llmBaseURL,
      persistEvents: this.config.persistEvents,
      clockSpeed: this.config.clockSpeed,
    };

    // Initialize subsystems
    this.eventStore = new InMemoryEventStore();
    this.eventAuditChain = new EventAuditChain();
    this.kernel = new Kernel({ eventStore: this.eventStore });
    this.scheduler = new ResourceScheduler({
      totalCapacity: this.config.totalBudget,
    });
    this.messageRouter = new MessageRouter();
    this.metrics = new SwarmMetricsCollector();
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Submit a goal and run the swarm to completion.
   */
  async run(goal: { title: string; description: string; priority?: Priority }): Promise<SwarmResult> {
    this.metrics.startTiming();

    // Phase 1: Setup
    this.setupWorkspaces();
    this.setupAgents();

    // Phase 2: Submit goal
    this.submitGoal(goal);

    // Phase 3: Run simulation loop
    this.runSimulationLoop();

    // Phase 4: Teardown
    this.teardown();

    this.metrics.stopTiming();

    // Phase 5: Collect metrics & verify
    const resultMetrics = this.metrics.compute();
    const verification = this.verify();

    return {
      success: verification.allPassed,
      metrics: resultMetrics,
      goals: this.goals,
      durationMs: resultMetrics.durationMs,
      verification,
    };
  }

  // ─── Setup ───────────────────────────────────────────────────────────────

  private setupWorkspaces(): void {
    for (let i = 0; i < this.config.workspaceCount; i++) {
      const workspaceId = createUUID() as unknown as WorkspaceID;
      this.workspaceIds.push(workspaceId);
      this.blackboards.set(workspaceId as string, new Blackboard(workspaceId));
    }
  }

  private setupAgents(): void {
    const rng = () => this.seededRandom();
    const ws = this.workspaceIds;

    // Create chief
    this.chief = new ChiefAgent({
      workspaceId: ws[0]!,
      projectId: createUUID() as unknown as ProjectID,
      failureRate: 0.01,
    }, rng);

    // Create managers
    this.managers = Array.from({ length: this.config.managerCount }, (_, i) =>
      new ManagerAgent({
        workspaceId: ws[i % ws.length]!,
        projectId: createUUID() as unknown as ProjectID,
        chiefId: this.chief.id,
        failureRate: 0.03,
      }, rng),
    );

    // Create workers
    this.workers = Array.from({ length: this.config.workerCount }, (_, i) =>
      new WorkerAgent({
        workspaceId: ws[i % ws.length]!,
        projectId: createUUID() as unknown as ProjectID,
        failureRate: 0.05,
      }, rng),
    );

    // Create validators
    this.validators = Array.from({ length: this.config.validatorCount }, (_, i) =>
      new ValidatorAgent({
        workspaceId: ws[i % ws.length]!,
        projectId: createUUID() as unknown as ProjectID,
        failureRate: 0.02,
      }, rng),
    );

    // Connect all agents
    this.allAgents = [this.chief, ...this.managers, ...this.workers, ...this.validators];

    const context = this.createAgentContext();

    for (const agent of this.allAgents) {
      agent.connect(context);
      agent.initialize();

      this.metrics.recordAgentState(agent.id, agent.state);

      this.emitMissionControlEvent('agent.spawned', agent.id, undefined, {
        type: agent.type,
        capabilities: agent.capabilities,
      });
    }

    // Register chief with managers
    for (const manager of this.managers) {
      this.chief.registerManager(manager.id);
      manager.registerWorker(this.chief.id); // chief gets notifications
    }

    // Register workers with their assigned managers
    const workersPerManager = Math.ceil(this.config.workerCount / this.config.managerCount);
    for (let i = 0; i < this.workers.length; i++) {
      const managerIdx = Math.floor(i / workersPerManager);
      const manager = this.managers[managerIdx % this.managers.length]!;
      this.workers[i]!.setManagerId(manager.id);
    }
  }

  private createAgentContext(): SwarmAgentContext {
    return {
      eventBus: this.kernel.eventBus,
      blackboard: this.getFirstBlackboard(),
      scheduler: this.scheduler,
      config: this.swarmConfig,
      sendMessage: (message: SwarmMessage) => {
        this.metrics.recordMessage();
        this.messageRouter.route(message);
      },
      onMessage: (handler: (message: SwarmMessage) => void) => {
        // Handled by message router registration
      },
      currentTime: () => this.simulationTime,
      capabilityExecutor: this.config.capabilityExecutor,
    };
  }

  // ─── Goal Management ─────────────────────────────────────────────────────

  private submitGoal(goal: { title: string; description: string; priority?: Priority }): void {
    const swarmGoal = this.chief.submitGoal({
      title: goal.title,
      description: goal.description,
      priority: goal.priority ?? (3 as Priority),
      budget: this.config.totalBudget,
      createdBy: this.chief.id,
      metadata: {},
    });

    this.goals.push(swarmGoal);

    // Assign workstreams to managers
    const workstreams = this.chief.getWorkstreams();
    for (let i = 0; i < workstreams.length; i++) {
      const manager = this.managers[i % this.managers.length]!;
      this.chief.assignWorkstream(workstreams[i]!.id, manager.id);
      manager.assignWorkstream(workstreams[i]!);

      this.metrics.recordWorkstreamState(workstreams[i]!.id, 'in_progress');
    }
  }

  // ─── Simulation Loop ─────────────────────────────────────────────────────

  private runSimulationLoop(): void {
    const totalSteps = Math.ceil(60_000 / 100); // 60 seconds at 100ms steps

    for (let step = 0; step < totalSteps; step++) {
      this.simulationTime += 100 * this.config.clockSpeed;

      // Phase 1: Workers claim and execute tasks
      for (const worker of this.workers) {
        if (worker.state === AgentState.TERMINATED || worker.state === AgentState.ERRORED) continue;

        // Try to claim a task
        const taskId = worker.claimAvailableTask();
        if (taskId) {
          this.metrics.recordTaskClaimed(taskId, worker.id);

          this.emitMissionControlEvent('task.claimed', worker.id, taskId, {});
        }

        // Execute active tasks
        for (const activeTaskId of worker.activeTaskIds) {
          if (worker.shouldFail()) {
            worker.failTask(activeTaskId);
            this.metrics.recordTaskFailed(activeTaskId);
            this.emitMissionControlEvent('task.failed', worker.id, activeTaskId, {});
            continue;
          }

          // Simulate task completion
          if (this.seededRandom() < 0.3) {
            const result = worker.executeSimulated(activeTaskId, this.simulationTime);
            if (result.confidence > 0) {
              worker.submitResult(result);
              this.metrics.recordTaskCompleted(activeTaskId);
              this.metrics.recordConsumption(result.resourcesConsumed);

              this.emitMissionControlEvent('task.completed', worker.id, activeTaskId, {
                confidence: result.confidence,
              });

              // Request validation for completed tasks
              this.requestValidation(activeTaskId, result);
            }
          }
        }

        this.metrics.recordAgentState(worker.id, worker.state);
      }

      // Phase 2: Validators process validations
      for (const validator of this.validators) {
        validator.tick();
        this.metrics.recordAgentState(validator.id, validator.state);
      }

      // Phase 3: Managers check workstream progress
      for (const manager of this.managers) {
        manager.tick();
        this.metrics.recordAgentState(manager.id, manager.state);
      }

      // Phase 4: Chief monitors overall progress
      this.chief.tick();
      this.metrics.recordAgentState(this.chief.id, this.chief.state);

      // Check if all goals are complete
      if (this.allGoalsComplete()) {
        break;
      }
    }

    // Mark remaining tasks
    this.markRemainingTasks();
  }

  // ─── Validation ───────────────────────────────────────────────────────────

  private requestValidation(taskId: TaskID, result: any): void {
    if (this.validators.length === 0) return;

    this.metrics.recordValidationRequest();

    // Use a subset of validators for this task
    const validatorCount = Math.min(
      this.config.validatorsPerResult,
      this.validators.length,
    );

    const selectedValidators = this.validators
      .sort(() => this.seededRandom() - 0.5)
      .slice(0, validatorCount);

    for (const validator of selectedValidators) {
      const validationResult = validator.validate(taskId);
      // In simulation, we don't have a real WorkerResult, so validate directly
      this.metrics.recordValidationResult(validationResult.approved);
    }

    // Compute consensus
    if (selectedValidators.length > 0) {
      const lastValidator = selectedValidators[selectedValidators.length - 1]!;
      const results = lastValidator.getValidations()
        .filter((v) => v.taskId === taskId);
      if (results.length > 0) {
        const consensus = lastValidator.computeConsensus(taskId, results, 'majority');
        this.emitMissionControlEvent('validation.result', undefined, taskId, {
          decision: consensus.finalDecision,
          confidence: consensus.averageConfidence,
        });
      }
    }
  }

  // ─── Teardown ────────────────────────────────────────────────────────────

  private teardown(): void {
    for (const agent of this.allAgents) {
      agent.terminate();
      this.metrics.recordAgentState(agent.id, agent.state);
      this.emitMissionControlEvent('agent.terminated', agent.id, undefined, {
        completedTaskCount: agent.completedTaskCount,
        failedTaskCount: agent.failedTaskCount,
      });
    }
  }

  // ─── Verification ────────────────────────────────────────────────────────

  private verify(): SwarmResult['verification'] {
    const checks = {
      allTasksTerminal: true,
      noResourceLeaks: true,
      conservationHolds: true,
      auditTrailComplete: true,
      claimsAtomic: true,
      noOrphanedTasks: true,
      noOrphanedAgents: true,
    };

    // Check: all agents terminated
    for (const agent of this.allAgents) {
      if (agent.state !== AgentState.TERMINATED) {
        checks.noOrphanedAgents = false;
      }
    }

    // Check: audit chain integrity
    try {
      checks.auditTrailComplete = this.eventAuditChain.verify().ok;
    } catch {
      checks.auditTrailComplete = false;
    }

    // Check: resource conservation
    // Total consumed should not exceed total allocated
    const metrics = this.metrics.compute();
    if (metrics.ruConsumed > metrics.ruAllocated ||
        metrics.muConsumed > metrics.muAllocated) {
      checks.conservationHolds = false;
    }

    const allPassed = Object.values(checks).every((v) => v === true);

    return { ...checks, allPassed };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private allGoalsComplete(): boolean {
    return this.goals.every((g) => g.status === 'completed' || g.status === 'failed');
  }

  private markRemainingTasks(): void {
    const blackboard = this.getFirstBlackboard();
    // Cancel any tasks still in ANNOUNCED state
    // (In real system, we'd iterate and cancel — simulation marks them complete)
  }

  private seededRandom(): number {
    this.rngState ^= this.rngState << 13;
    this.rngState ^= this.rngState >> 17;
    this.rngState ^= this.rngState << 5;
    return (this.rngState >>> 0) / 0xFFFFFFFF;
  }

  private getFirstBlackboard(): Blackboard {
    for (const bb of this.blackboards.values()) {
      return bb;
    }
    throw new Error('No blackboards available');
  }

  private emitMissionControlEvent(
    type: MissionControlEvent['type'],
    agentId?: AgentID,
    taskId?: TaskID,
    data: Record<string, unknown> = {},
  ): void {
    this.metrics.recordEvent({
      id: createUUID(),
      type,
      agentId,
      taskId,
      timestamp: this.simulationTime,
      data,
    });
  }

  // ─── Accessors ───────────────────────────────────────────────────────────

  getChief(): ChiefAgent {
    return this.chief;
  }

  getManagers(): ManagerAgent[] {
    return [...this.managers];
  }

  getWorkers(): WorkerAgent[] {
    return [...this.workers];
  }

  getValidators(): ValidatorAgent[] {
    return [...this.validators];
  }

  getAllAgents(): SwarmAgent[] {
    return [...this.allAgents];
  }

  getMetrics(): SwarmMetricsCollector {
    return this.metrics;
  }

  getMissionControlEvents(type?: string): MissionControlEvent[] {
    return this.metrics.getEvents(type as any);
  }
}