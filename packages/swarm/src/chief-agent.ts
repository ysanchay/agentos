/**
 * @agentos/swarm — ChiefAgent
 * The orchestrator-in-chief. Accepts user goals, decomposes them into
 * workstreams, allocates budgets, creates managers, and monitors overall execution.
 *
 * Responsibilities:
 *   1. Goal acceptance → decomposition into workstreams
 *   2. Budget allocation across workstreams
 *   3. Manager creation and assignment
 *   4. Progress monitoring and escalation
 *   5. Final goal completion or failure declaration
 *
 * ChiefAgents do NOT execute tasks directly — they coordinate Managers.
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
import { createUUID, AgentType, ZERO_BUDGET } from '@agentos/types';
import type { SwarmConfig, SwarmGoal, Workstream, SwarmMessage } from './types.js';
import { SwarmAgent, type SwarmAgentContext } from './swarm-agent.js';

// ─── Chief Agent Capabilities ─────────────────────────────────────────────

const CHIEF_CAPABILITIES = [
  'decompose', 'assign', 'review', 'approve', 'manage', 'coordinate',
  'reason.infer.text', 'reason.decide', 'coordinate.plan',
];

const CHIEF_BUDGET: ResourceBudget = {
  ru: 2000,
  mu: 1000,
  eu: 500,
  vu: 200,
};

// ─── ChiefAgent Config ─────────────────────────────────────────────────────

export interface ChiefAgentConfig {
  id?: AgentID;
  workspaceId: WorkspaceID;
  projectId: ProjectID;
  priority?: Priority;
  failureRate?: number;
  budget?: ResourceBudget;
}

// ─── ChiefAgent ────────────────────────────────────────────────────────────

export class ChiefAgent extends SwarmAgent {
  // Goal & workstream tracking
  private goals: Map<string, SwarmGoal> = new Map();
  private workstreams: Map<string, Workstream> = new Map();
  private managerIds: AgentID[] = [];

  // Workstream decomposition strategy
  private decompositionStrategy: 'sequential' | 'parallel' | 'mixed' = 'mixed';

  constructor(config: ChiefAgentConfig, rng?: () => number) {
    super({
      id: config.id,
      type: 'chief',
      workspaceId: config.workspaceId,
      projectId: config.projectId,
      capabilities: CHIEF_CAPABILITIES,
      budget: config.budget ?? CHIEF_BUDGET,
      priority: config.priority ?? (1 as Priority),
      maxConcurrentTasks: 5,
      failureRate: config.failureRate ?? 0.02,
    }, rng);
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  protected onInitialize(): void {
    // Chief initializes with no active tasks — waiting for goals
  }

  // ─── Goal Management ────────────────────────────────────────────────────

  /**
   * Accept a user goal and decompose it into workstreams.
   */
  submitGoal(goal: Omit<SwarmGoal, 'id' | 'status' | 'workstreamIds' | 'createdAt'>): SwarmGoal {
    const swarmGoal: SwarmGoal = {
      ...goal,
      id: createUUID(),
      status: 'pending',
      workstreamIds: [],
      createdAt: this.context?.currentTime()?.toString() ?? new Date().toISOString(),
    };

    this.goals.set(swarmGoal.id, swarmGoal);

    // Decompose goal into workstreams
    this.decomposeGoal(swarmGoal);

    this.sendMessage({
      type: 'goal.submit',
      recipient: '*',
      payload: { goalId: swarmGoal.id, title: swarmGoal.title },
    });

    return swarmGoal;
  }

  /**
   * Decompose a goal into workstreams based on strategy.
   *
   * In simulation mode (no LLM), this uses deterministic decomposition.
   * In live mode, this would call the LLM for intelligent decomposition.
   */
  private decomposeGoal(goal: SwarmGoal): void {
    goal.status = 'decomposing';
    this.emitEvent('goal.decomposing', { goalId: goal.id });

    // Deterministic decomposition: split budget evenly across N workstreams
    const workstreamCount = this.calculateWorkstreamCount(goal);
    const budgetPerWorkstream = this.allocateBudget(goal.budget, workstreamCount);

    for (let i = 0; i < workstreamCount; i++) {
      const workstream: Workstream = {
        id: createUUID(),
        goalId: goal.id,
        title: `${goal.title} — Workstream ${i + 1}`,
        description: `Part ${i + 1} of ${workstreamCount} for goal: ${goal.title}`,
        priority: goal.priority,
        budget: budgetPerWorkstream[i]!,
        status: 'pending',
        taskIds: [],
        createdAt: this.context?.currentTime()?.toString() ?? new Date().toISOString(),
      };

      this.workstreams.set(workstream.id, workstream);
      goal.workstreamIds.push(workstream.id);
    }

    goal.status = 'in_progress';
    this.emitEvent('goal.decomposed', {
      goalId: goal.id,
      workstreamCount,
    });
  }

  /**
   * Calculate how many workstreams a goal should be decomposed into.
   */
  private calculateWorkstreamCount(goal: SwarmGoal): number {
    // Heuristic: budget determines workstream count
    // More budget → more parallel workstreams
    const totalBudget = goal.budget.ru + goal.budget.mu;
    if (totalBudget > 10000) return 5;
    if (totalBudget > 5000) return 3;
    if (totalBudget > 1000) return 2;
    return 1;
  }

  /**
   * Allocate budget across workstreams.
   */
  private allocateBudget(totalBudget: ResourceBudget, count: number): ResourceBudget[] {
    const perWorkstream: ResourceBudget = {
      ru: Math.floor(totalBudget.ru / count),
      mu: Math.floor(totalBudget.mu / count),
      eu: Math.floor(totalBudget.eu / count),
      vu: Math.floor(totalBudget.vu / count),
    };

    // Give remainder to first workstream
    const remainder: ResourceBudget = {
      ru: totalBudget.ru - perWorkstream.ru * count,
      mu: totalBudget.mu - perWorkstream.mu * count,
      eu: totalBudget.eu - perWorkstream.eu * count,
      vu: totalBudget.vu - perWorkstream.vu * count,
    };

    return Array.from({ length: count }, (_, i) => ({
      ru: perWorkstream.ru + (i === 0 ? remainder.ru : 0),
      mu: perWorkstream.mu + (i === 0 ? remainder.mu : 0),
      eu: perWorkstream.eu + (i === 0 ? remainder.eu : 0),
      vu: perWorkstream.vu + (i === 0 ? remainder.vu : 0),
    }));
  }

  // ─── Manager Assignment ─────────────────────────────────────────────────

  /**
   * Assign a manager to a workstream.
   */
  assignWorkstream(workstreamId: string, managerId: AgentID): boolean {
    const workstream = this.workstreams.get(workstreamId);
    if (!workstream) return false;

    workstream.managerId = managerId;
    workstream.status = 'assigned';

    if (!this.managerIds.includes(managerId)) {
      this.managerIds.push(managerId);
    }

    this.sendMessage({
      type: 'workstream.assign',
      recipient: managerId,
      payload: { workstreamId, goalId: workstream.goalId },
    });

    this.emitEvent('workstream.assigned', { workstreamId, managerId });
    return true;
  }

  /**
   * Register a manager agent with the chief.
   */
  registerManager(managerId: AgentID): void {
    if (!this.managerIds.includes(managerId)) {
      this.managerIds.push(managerId);
    }
  }

  // ─── Progress Monitoring ─────────────────────────────────────────────────

  /**
   * Get the overall progress of a goal.
   */
  getGoalProgress(goalId: string): {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    pending: number;
  } {
    const goal = this.goals.get(goalId);
    if (!goal) return { total: 0, completed: 0, failed: 0, inProgress: 0, pending: 0 };

    let completed = 0;
    let failed = 0;
    let inProgress = 0;

    for (const wsId of goal.workstreamIds) {
      const ws = this.workstreams.get(wsId);
      if (!ws) continue;
      switch (ws.status) {
        case 'completed': completed++; break;
        case 'failed': failed++; break;
        case 'in_progress': case 'assigned': inProgress++; break;
      }
    }

    return {
      total: goal.workstreamIds.length,
      completed,
      failed,
      inProgress,
      pending: goal.workstreamIds.length - completed - failed - inProgress,
    };
  }

  /**
   * Mark a workstream as completed.
   */
  completeWorkstream(workstreamId: string): void {
    const workstream = this.workstreams.get(workstreamId);
    if (!workstream) return;

    workstream.status = 'completed';
    workstream.completedAt = this.context?.currentTime()?.toString() ?? new Date().toISOString();

    // Check if all workstreams for the goal are complete
    const goal = this.goals.get(workstream.goalId);
    if (!goal) return;

    const allComplete = goal.workstreamIds.every((wsId) => {
      const ws = this.workstreams.get(wsId);
      return ws?.status === 'completed' || ws?.status === 'failed';
    });

    if (allComplete) {
      const anyFailed = goal.workstreamIds.some((wsId) => {
        const ws = this.workstreams.get(wsId);
        return ws?.status === 'failed';
      });

      goal.status = anyFailed ? 'failed' : 'completed';
      goal.completedAt = this.context?.currentTime()?.toString() ?? new Date().toISOString();

      this.sendMessage({
        type: anyFailed ? 'goal.failed' : 'goal.completed',
        recipient: '*',
        payload: { goalId: goal.id, status: goal.status },
      });
    }

    this.emitEvent('workstream.completed', { workstreamId });
  }

  /**
   * Mark a workstream as failed.
   */
  failWorkstream(workstreamId: string, reason: string): void {
    const workstream = this.workstreams.get(workstreamId);
    if (!workstream) return;

    workstream.status = 'failed';
    workstream.completedAt = this.context?.currentTime()?.toString() ?? new Date().toISOString();

    this.sendMessage({
      type: 'workstream.failed',
      recipient: '*',
      payload: { workstreamId, goalId: workstream.goalId, reason },
    });

    this.emitEvent('workstream.failed', { workstreamId, reason });
  }

  // ─── Message Handling ────────────────────────────────────────────────────

  handleMessage(message: SwarmMessage): void {
    switch (message.type) {
      case 'workstream.progress':
        this.handleWorkstreamProgress(message);
        break;
      case 'workstream.completed':
        this.completeWorkstream(message.payload as any);
        break;
      case 'workstream.failed':
        this.failWorkstream((message.payload as any).workstreamId, (message.payload as any).reason);
        break;
      case 'agent.ready':
        // New agent registered — could assign to workstream
        break;
      case 'resource.exhausted':
        this.handleResourceExhausted(message);
        break;
      default:
        // Unknown message type — ignore
        break;
    }
  }

  private handleWorkstreamProgress(message: SwarmMessage): void {
    const { workstreamId, progress } = message.payload as any;
    const workstream = this.workstreams.get(workstreamId);
    if (workstream && progress >= 1.0) {
      workstream.status = 'completed';
      this.completeWorkstream(workstreamId);
    }
  }

  private handleResourceExhausted(message: SwarmMessage): void {
    // Escalate — could re-allocate budgets or pause workstreams
    this.emitEvent('resource.exhausted', { agentId: message.sender });
  }

  // ─── Tick ────────────────────────────────────────────────────────────────

  tick(): void {
    if (this.state !== 'ready' as any && this.state !== 'running' as any) return;

    // Chief monitors: check for stuck workstreams, rebalance if needed
    for (const [wsId, ws] of this.workstreams) {
      if (ws.status === 'pending') {
        // Unassigned workstream — could auto-assign
        if (this.managerIds.length > 0) {
          const managerId = this.managerIds[0]!;
          this.assignWorkstream(wsId, managerId);
        }
      }
    }
  }

  // ─── Accessors ───────────────────────────────────────────────────────────

  getGoals(): SwarmGoal[] {
    return Array.from(this.goals.values());
  }

  getWorkstreams(): Workstream[] {
    return Array.from(this.workstreams.values());
  }

  getManagerIds(): AgentID[] {
    return [...this.managerIds];
  }

  getActiveGoalCount(): number {
    return Array.from(this.goals.values()).filter(
      (g) => g.status === 'in_progress' || g.status === 'decomposing',
    ).length;
  }
}