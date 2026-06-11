/**
 * @agentos/simulation — Main Simulation Orchestrator
 * Sets up, runs, verifies, and tears down a full AgentOS simulation.
 *
 * ZERO AI logic — deterministic simulation of agent coordination.
 */

import type {
  AgentID,
  TaskID,
  WorkspaceID,
  Priority,
  ResourceBudget,
} from '@agentos/types';
import {
  createUUID, AgentState, TaskState, TaskType, ZERO_BUDGET, ZERO_CONSUMPTION,
} from '@agentos/types';
import { Kernel } from '@agentos/kernel';
import { InMemoryEventStore } from '@agentos/eventstore';
import { AuditChain as EventAuditChain } from '@agentos/eventstore';
import { Blackboard } from '@agentos/blackboard';
import { ResourceScheduler } from '@agentos/resources';
import type { SimulationConfig } from './simulation-config.js';
import { createConfig } from './simulation-config.js';
import { SimulationClock } from './simulation-clock.js';
import { SimulationReporter, type SimulationMetrics, type VerificationResults } from './simulation-reporter.js';
import { SimulationVerifier, type SimulationState } from './simulation-verifier.js';
import { FakeAgent, AgentFactory } from './fake-agent.js';
import { WorkloadGenerator, type GeneratedTask } from './workload-generator.js';

// ─── Simulation Result ─────────────────────────────────────────────────

export interface SimulationResult {
  success: boolean;
  metrics: SimulationMetrics;
  report: string;
  durationMs: number;
}

// ─── Simulation ──────────────────────────────────────────────────────────

export class Simulation {
  private config: SimulationConfig;
  private clock: SimulationClock;
  private reporter: SimulationReporter;
  private verifier: SimulationVerifier;
  private eventStore: InMemoryEventStore;
  private eventAuditChain: EventAuditChain;
  private kernel: Kernel;
  private blackboards: Map<string, Blackboard> = new Map();
  private scheduler: ResourceScheduler;
  private agents: FakeAgent[] = [];
  private tasks: GeneratedTask[] = [];
  private workspaceIds: WorkspaceID[] = [];
  private workloadGenerator: WorkloadGenerator;

  // Tracking for verification
  private agentStates: Map<string, AgentState> = new Map();
  private taskStates: Map<string, TaskState> = new Map();
  private taskAssignees: Map<string, AgentID[]> = new Map();
  private allocations: Map<string, ResourceBudget> = new Map();
  private consumption: Map<string, ResourceBudget> = new Map();
  private agentLimits: Map<string, ResourceBudget> = new Map();
  private claims: Map<string, string> = new Map();
  private dependencies: Map<string, string[]> = new Map();
  private stateTransitions: Map<string, Array<{ from: string; to: string; timestamp: number }>> = new Map();

  // Seeded RNG
  private rngState: number;

  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = createConfig(config);
    this.rngState = this.config.randomSeed;
    this.clock = new SimulationClock(this.config.clockSpeed);
    this.reporter = new SimulationReporter();
    this.verifier = new SimulationVerifier();

    // Initialize core subsystems
    this.eventStore = new InMemoryEventStore();
    this.eventAuditChain = new EventAuditChain();
    this.kernel = new Kernel({ eventStore: this.eventStore });
    this.scheduler = new ResourceScheduler({
      totalCapacity: this.config.totalCapacity,
    });
    this.workloadGenerator = new WorkloadGenerator(() => this.seededRandom());
  }

  // ─── Public API ────────────────────────────────────────────────────

  /**
   * Run the full simulation.
   */
  async run(): Promise<SimulationResult> {
    const startTime = Date.now();

    // Phase 1: Setup
    this.setupWorkspaces();
    this.setupAgents();
    this.setupTasks();

    // Phase 2: Run simulation loop
    this.runSimulationLoop();

    // Phase 3: Teardown — terminate all agents
    this.teardown();

    const durationMs = Date.now() - startTime;

    // Phase 4: Collect metrics
    this.collectMetrics(durationMs);

    // Phase 5: Verify
    const verificationResults = this.verify();
    this.reporter.setVerificationResults(verificationResults);

    // Phase 6: Generate report
    const metrics = this.reporter.generateReport();
    const report = this.reporter.printReport();

    return {
      success: verificationResults.allPassed,
      metrics,
      report,
      durationMs,
    };
  }

  // ─── Setup ──────────────────────────────────────────────────────────

  private setupWorkspaces(): void {
    for (let i = 0; i < this.config.workspaceCount; i++) {
      const workspaceId = createUUID() as unknown as WorkspaceID;
      this.workspaceIds.push(workspaceId);
      this.blackboards.set(workspaceId as string, new Blackboard(workspaceId));

      // Create workspace in kernel
      this.kernel.createWorkspace({
        name: `workspace-${i}`,
        description: `Simulation workspace ${i}`,
        project_id: createUUID() as unknown as any,
        owner_id: createUUID() as unknown as any,
        resource_quota: { ru: 20000, mu: 10000, eu: 2000, vu: 1000 },
      });
    }
  }

  private setupAgents(): void {
    this.agents = AgentFactory.createSimulationSet(
      this.config.agentCount,
      this.workspaceIds,
      this.config.chiefCount,
      this.config.managerCount,
      this.config.failureRate,
      () => this.seededRandom(),
    );

    // Register all agents with the kernel and track their state
    for (const agent of this.agents) {
      agent.initialize();
      this.agentStates.set(agent.id as string, agent.state);
      this.allocations.set(agent.id as string, { ...agent.resources });
      this.agentLimits.set(agent.id as string, { ...agent.resources });

      this.recordTransition(agent.id as string, AgentState.SPAWNING, AgentState.INITIALIZING);
      this.recordTransition(agent.id as string, AgentState.INITIALIZING, AgentState.READY);
    }
  }

  private setupTasks(): void {
    this.tasks = this.workloadGenerator.generateTasks(
      this.config.taskCount,
      this.workspaceIds,
    );

    // Track task states and dependencies
    for (const task of this.tasks) {
      this.taskStates.set(task.id as string, task.state);
      this.taskAssignees.set(task.id as string, []);
      this.dependencies.set(task.id as string, task.depends_on.map(id => id as string));
    }
  }

  // ─── Simulation Loop ────────────────────────────────────────────────

  private runSimulationLoop(): void {
    const totalSteps = Math.ceil(this.config.durationMs / 100);
    let completedTasks = 0;
    let failedTasks = 0;

    // Publish all tasks to blackboards
    for (const task of this.tasks) {
      const bb = this.getFirstBlackboard();
      if (bb) {
        const publishResult = bb.publishTask({
          id: task.id,
          title: task.title,
          description: task.description,
          type: task.type,
          priority: task.priority as any,
          state: TaskState.ANNOUNCED,
          owner: undefined,
          owner_since: undefined,
          previous_owners: [],
          depends_on: task.depends_on,
          blocks: [],
          resources_required: task.resources_required,
          retry_count: 0,
          max_retries: 3,
          tags: task.capabilities.map((c) => `capability:${c}`),
          created_at: task.created_at,
          updated_at: task.updated_at,
        });

        if (!publishResult.ok) {
          // Task already exists — skip
          continue;
        }
      }
    }

    // Main simulation loop
    for (let step = 0; step < totalSteps; step++) {
      this.clock.tick(100);

      // Each agent takes action
      for (const agent of this.agents) {
        if (agent.state === AgentState.TERMINATED || agent.state === AgentState.ERRORED) continue;

        // Check if agent should fail
        if (agent.shouldFail() && agent.state === AgentState.RUNNING) {
          const taskId = agent.activeTaskIds[0];
          if (taskId) {
            agent.failTask(taskId);
            this.taskStates.set(taskId as string, TaskState.FAILED);
            failedTasks++;
            this.recordTransition(taskId as string, TaskState.IN_PROGRESS, TaskState.FAILED);
          }
          continue;
        }

        // If agent is ready, try to claim a task
        if (agent.canAcceptTask()) {
          const bb = this.getFirstBlackboard();
          if (bb) {
            const available = bb.getAvailableTasks(agent.capabilities);
            for (const task of available) {
              const claimResult = bb.claimTask(task.id, agent.id, {
                id: agent.id,
                capabilities: agent.capabilities,
                available_resources: agent.resources,
                role: agent.role as 'worker' | 'manager' | 'chief',
              });

              if (claimResult.ok) {
                agent.startTask(task.id);
                this.claims.set(task.id as string, agent.id as string);
                this.taskStates.set(task.id as string, TaskState.CLAIMED);

                const assignees = this.taskAssignees.get(task.id as string) ?? [];
                assignees.push(agent.id);
                this.taskAssignees.set(task.id as string, assignees);

                this.recordTransition(task.id as string, TaskState.ANNOUNCED, TaskState.CLAIMED);
                break;
              }
            }
          }
        }

        // If agent is busy, simulate work progress
        if (agent.state === AgentState.RUNNING && agent.activeTaskIds.length > 0) {
          const taskId = agent.activeTaskIds[0]!;
          const workDuration = 100 + Math.floor(this.seededRandom() * 500);
          const consumed = agent.simulateWork(workDuration);

          // Track consumption
          const currentConsumption = this.consumption.get(agent.id as string) ?? { ...ZERO_BUDGET };
          currentConsumption.ru += consumed.ru;
          currentConsumption.mu += consumed.mu;
          currentConsumption.eu += consumed.eu;
          currentConsumption.vu += consumed.vu;
          this.consumption.set(agent.id as string, currentConsumption);

          // Randomly complete or continue
          if (this.seededRandom() < 0.3) {
            // Task completed
            const bb = this.getFirstBlackboard();
            if (bb) {
              bb.submitResult({
                task_id: taskId,
                agent_id: agent.id,
                output: { completed: true },
                confidence: 0.8 + this.seededRandom() * 0.2,
                resources_consumed: consumed,
                artifacts: [],
                duration_ms: workDuration,
                completed_at: this.clock.now(),
              });

              // Validate result (auto-approve for simulation)
              bb.validateResult(taskId, agent.id, true, 'auto-approved');
            }

            agent.completeTask(taskId);
            this.taskStates.set(taskId as string, TaskState.COMPLETED);
            completedTasks++;
            this.recordTransition(taskId as string, TaskState.CLAIMED, TaskState.COMPLETED);
          }
        }
      }
    }

    // Mark any remaining tasks
    for (const task of this.tasks) {
      const currentState = this.taskStates.get(task.id as string);
      if (currentState === TaskState.ANNOUNCED || currentState === TaskState.DRAFT) {
        this.taskStates.set(task.id as string, TaskState.CANCELLED);
      }
    }
  }

  // ─── Teardown ────────────────────────────────────────────────────────

  private teardown(): void {
    for (const agent of this.agents) {
      agent.terminate();
      this.agentStates.set(agent.id as string, agent.state);
      this.recordTransition(agent.id as string, agent.state, AgentState.TERMINATED);
    }

    // Release all remaining allocations
    for (const [agentId] of this.allocations) {
      this.allocations.set(agentId, { ru: 0, mu: 0, eu: 0, vu: 0 });
    }
  }

  // ─── Metrics & Verification ──────────────────────────────────────────

  private collectMetrics(durationMs: number): void {
    this.reporter.setDuration(durationMs);

    // Agent metrics
    const agentSummary = {
      total: this.agents.length,
      completed: this.agents.filter((a) => a.state === AgentState.TERMINATED).length,
      failed: this.agents.filter((a) => a.state === AgentState.ERRORED).length,
      active: this.agents.filter((a) => a.state !== AgentState.TERMINATED && a.state !== AgentState.ERRORED).length,
    };
    this.reporter.updateAgentMetrics(agentSummary);

    // Task metrics
    let completed = 0, failed = 0, cancelled = 0, pending = 0;
    for (const [, state] of this.taskStates) {
      switch (state) {
        case TaskState.COMPLETED: completed++; break;
        case TaskState.FAILED: failed++; break;
        case TaskState.CANCELLED: cancelled++; break;
        default: pending++; break;
      }
    }
    this.reporter.updateTaskMetrics({
      total: this.taskStates.size,
      completed,
      failed,
      cancelled,
      pending,
    });

    // Resource metrics
    let ruAllocated = 0, muAllocated = 0, euAllocated = 0, vuAllocated = 0;
    let ruConsumed = 0, muConsumed = 0, euConsumed = 0, vuConsumed = 0;
    for (const [, alloc] of this.allocations) {
      ruAllocated += alloc.ru; muAllocated += alloc.mu;
      euAllocated += alloc.eu; vuAllocated += alloc.vu;
    }
    for (const [, cons] of this.consumption) {
      ruConsumed += cons.ru; muConsumed += cons.mu;
      euConsumed += cons.eu; vuConsumed += cons.vu;
    }
    this.reporter.updateResourceMetrics({
      ruAllocated, ruConsumed,
      muAllocated, muConsumed,
      euAllocated, euConsumed,
      vuAllocated, vuConsumed,
    });
  }

  private verify(): VerificationResults {
    const state: SimulationState = {
      agentStates: this.agentStates,
      taskStates: this.taskStates,
      taskAssignees: this.taskAssignees,
      allocations: this.allocations,
      consumption: this.consumption,
      agentLimits: this.agentLimits,
      totalCapacity: this.config.totalCapacity,
      claims: this.claims,
      dependencies: this.dependencies,
      stateTransitions: this.stateTransitions,
      auditChainValid: this.eventAuditChain.verify().ok,
    };

    return this.verifier.verify(state);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────

  private seededRandom(): number {
    this.rngState ^= this.rngState << 13;
    this.rngState ^= this.rngState >> 17;
    this.rngState ^= this.rngState << 5;
    return (this.rngState >>> 0) / 0xFFFFFFFF;
  }

  private getFirstBlackboard(): Blackboard | undefined {
    for (const bb of this.blackboards.values()) {
      return bb;
    }
    return undefined;
  }

  private recordTransition(entityId: string, from: string, to: string): void {
    const transitions = this.stateTransitions.get(entityId) ?? [];
    transitions.push({ from, to, timestamp: Date.now() });
    this.stateTransitions.set(entityId, transitions);
  }
}