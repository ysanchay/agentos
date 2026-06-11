/**
 * @agentos/swarm — Mission Control Alpha
 * Live visibility dashboard for observing AgentOS as a living system.
 *
 * Provides:
 *   - Agent state overview (how many in each state)
 *   - ACP message traffic (messages per second, by type)
 *   - Blackboard ownership (which agents own which tasks)
 *   - Resource allocations (current usage vs capacity)
 *   - Event timeline (chronological event stream)
 *   - Workflow execution (goal → workstream → task progress)
 */

import type { AgentID, TaskID } from '@agentos/types';
import { AgentState, TaskState } from '@agentos/types';
import type { SwarmMetrics, MissionControlEvent } from './types.js';
import { SwarmMetricsCollector } from './swarm-metrics.js';
import type { SwarmAgent } from './swarm-agent.js';
import type { ChiefAgent } from './chief-agent.js';
import type { ManagerAgent } from './manager-agent.js';
import type { WorkerAgent } from './worker-agent.js';
import type { ValidatorAgent } from './validator-agent.js';

// ─── Dashboard Data ────────────────────────────────────────────────────────

export interface AgentOverview {
  total: number;
  byType: Record<string, number>;
  byState: Record<string, number>;
  idleCount: number;
  activeCount: number;
  erroredCount: number;
  terminatedCount: number;
}

export interface TaskOverview {
  total: number;
  byState: Record<string, number>;
  completionRate: number;
  averageLatencyMs: number;
  duplicateClaims: number;
}

export interface ResourceOverview {
  allocated: { ru: number; mu: number; eu: number; vu: number };
  consumed: { ru: number; mu: number; eu: number; vu: number };
  utilizationPercent: number;
}

export interface MessageTraffic {
  totalMessages: number;
  messagesPerSecond: number;
  byType: Record<string, number>;
  recentEvents: MissionControlEvent[];
}

export interface WorkflowProgress {
  goals: Array<{
    id: string;
    title: string;
    status: string;
    workstreams: Array<{
      id: string;
      title: string;
      status: string;
      taskProgress: { completed: number; total: number };
    }>;
  }>;
}

export interface MissionControlSnapshot {
  timestamp: number;
  agents: AgentOverview;
  tasks: TaskOverview;
  resources: ResourceOverview;
  messages: MessageTraffic;
  workflows: WorkflowProgress;
  deadlocks: { detected: number; resolved: number };
  validation: { requests: number; approvals: number; rejections: number; accuracy: number };
}

// ─── Mission Control ───────────────────────────────────────────────────────

export class MissionControl {
  private metrics: SwarmMetricsCollector;
  private agents: SwarmAgent[];
  private chief: ChiefAgent | null = null;
  private managers: ManagerAgent[] = [];
  private workers: WorkerAgent[] = [];
  private validators: ValidatorAgent[] = [];

  constructor(
    metrics: SwarmMetricsCollector,
    agents: SwarmAgent[],
    chief?: ChiefAgent,
    managers: ManagerAgent[] = [],
    workers: WorkerAgent[] = [],
    validators: ValidatorAgent[] = [],
  ) {
    this.metrics = metrics;
    this.agents = agents;
    this.chief = chief ?? null;
    this.managers = managers;
    this.workers = workers;
    this.validators = validators;
  }

  // ─── Snapshot ─────────────────────────────────────────────────────────────

  /**
   * Take a snapshot of the current swarm state.
   */
  snapshot(): MissionControlSnapshot {
    const computedMetrics = this.metrics.compute();

    return {
      timestamp: Date.now(),
      agents: this.getAgentOverview(),
      tasks: this.getTaskOverview(computedMetrics),
      resources: this.getResourceOverview(computedMetrics),
      messages: this.getMessageTraffic(computedMetrics),
      workflows: this.getWorkflowProgress(),
      deadlocks: {
        detected: computedMetrics.deadlockCount,
        resolved: computedMetrics.deadlockCount > 0 ? computedMetrics.recoverySuccessRate * computedMetrics.deadlockCount : 0,
      },
      validation: {
        requests: computedMetrics.validationRequests,
        approvals: computedMetrics.validationApprovals,
        rejections: computedMetrics.validationRejections,
        accuracy: computedMetrics.validationAccuracy,
      },
    };
  }

  // ─── Agent Overview ──────────────────────────────────────────────────────

  private getAgentOverview(): AgentOverview {
    const byType: Record<string, number> = {};
    const byState: Record<string, number> = {};
    let idleCount = 0;
    let activeCount = 0;
    let erroredCount = 0;
    let terminatedCount = 0;

    for (const agent of this.agents) {
      const type = agent.type;
      const state = agent.state as string;

      byType[type] = (byType[type] ?? 0) + 1;
      byState[state] = (byState[state] ?? 0) + 1;

      switch (agent.state) {
        case AgentState.READY: idleCount++; break;
        case AgentState.RUNNING: activeCount++; break;
        case AgentState.ERRORED: erroredCount++; break;
        case AgentState.TERMINATED: terminatedCount++; break;
      }
    }

    return {
      total: this.agents.length,
      byType,
      byState,
      idleCount,
      activeCount,
      erroredCount,
      terminatedCount,
    };
  }

  // ─── Task Overview ───────────────────────────────────────────────────────

  private getTaskOverview(metrics: SwarmMetrics): TaskOverview {
    return {
      total: metrics.totalTasks,
      byState: {
        completed: metrics.completedTasks,
        failed: metrics.failedTasks,
        cancelled: metrics.cancelledTasks,
        pending: metrics.pendingTasks,
      },
      completionRate: metrics.completionRate,
      averageLatencyMs: metrics.averageTaskLatencyMs,
      duplicateClaims: metrics.taskDuplication,
    };
  }

  // ─── Resource Overview ────────────────────────────────────────────────────

  private getResourceOverview(metrics: SwarmMetrics): ResourceOverview {
    return {
      allocated: {
        ru: metrics.ruAllocated,
        mu: metrics.muAllocated,
        eu: metrics.euAllocated,
        vu: metrics.vuAllocated,
      },
      consumed: {
        ru: metrics.ruConsumed,
        mu: metrics.muConsumed,
        eu: metrics.euConsumed,
        vu: metrics.vuConsumed,
      },
      utilizationPercent: Math.round(metrics.resourceUtilization * 100),
    };
  }

  // ─── Message Traffic ──────────────────────────────────────────────────────

  private getMessageTraffic(metrics: SwarmMetrics): MessageTraffic {
    const byType: Record<string, number> = {};
    const events = this.metrics.getEvents();

    for (const event of events) {
      byType[event.type] = (byType[event.type] ?? 0) + 1;
    }

    return {
      totalMessages: metrics.messagesSent,
      messagesPerSecond: metrics.messagesPerSecond,
      byType,
      recentEvents: events.slice(-20),
    };
  }

  // ─── Workflow Progress ────────────────────────────────────────────────────

  private getWorkflowProgress(): WorkflowProgress {
    if (!this.chief) {
      return { goals: [] };
    }

    const goals = this.chief.getGoals();
    const workstreams = this.chief.getWorkstreams();

    return {
      goals: goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        workstreams: workstreams
          .filter((ws) => ws.goalId === goal.id)
          .map((ws) => {
            // Find manager for this workstream
            const manager = this.managers.find((m) =>
              m.getWorkstreams().some((mws) => mws.id === ws.id),
            );

            const taskProgress = manager
              ? manager.getWorkstreamProgress(ws.id)
              : { completed: 0, total: ws.taskIds.length };

            return {
              id: ws.id,
              title: ws.title,
              status: ws.status,
              taskProgress: {
                completed: taskProgress.completed,
                total: taskProgress.total || ws.taskIds.length,
              },
            };
          }),
      })),
    };
  }

  // ─── Formatted Output ─────────────────────────────────────────────────────

  /**
   * Render a formatted dashboard as a string.
   */
  render(): string {
    const snap = this.snapshot();
    const lines: string[] = [];

    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('                 MISSION CONTROL ALPHA                    ');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');

    // Agent overview
    lines.push('── AGENTS ──────────────────────────────────────────────');
    lines.push(`  Total: ${snap.agents.total}`);
    lines.push(`  Active: ${snap.agents.activeCount} | Idle: ${snap.agents.idleCount} | Errored: ${snap.agents.erroredCount} | Terminated: ${snap.agents.terminatedCount}`);
    for (const [type, count] of Object.entries(snap.agents.byType)) {
      lines.push(`  ${type}: ${count}`);
    }
    lines.push('');

    // Task overview
    lines.push('── TASKS ───────────────────────────────────────────────');
    lines.push(`  Total: ${snap.tasks.total}`);
    lines.push(`  Completed: ${snap.tasks.byState['completed']} | Failed: ${snap.tasks.byState['failed']} | Cancelled: ${snap.tasks.byState['cancelled']} | Pending: ${snap.tasks.byState['pending']}`);
    lines.push(`  Completion rate: ${(snap.tasks.completionRate * 100).toFixed(1)}%`);
    lines.push(`  Avg latency: ${snap.tasks.averageLatencyMs.toFixed(0)}ms`);
    lines.push(`  Duplicate claims: ${snap.tasks.duplicateClaims}`);
    lines.push('');

    // Resources
    lines.push('── RESOURCES ──────────────────────────────────────────');
    lines.push(`  RU: ${snap.resources.consumed.ru}/${snap.resources.allocated.ru} allocated`);
    lines.push(`  MU: ${snap.resources.consumed.mu}/${snap.resources.allocated.mu} allocated`);
    lines.push(`  EU: ${snap.resources.consumed.eu}/${snap.resources.allocated.eu} allocated`);
    lines.push(`  VU: ${snap.resources.consumed.vu}/${snap.resources.allocated.vu} allocated`);
    lines.push(`  Utilization: ${snap.resources.utilizationPercent}%`);
    lines.push('');

    // Validation
    lines.push('── VALIDATION ─────────────────────────────────────────');
    lines.push(`  Requests: ${snap.validation.requests}`);
    lines.push(`  Approved: ${snap.validation.approvals} | Rejected: ${snap.validation.rejections}`);
    lines.push(`  Accuracy: ${(snap.validation.accuracy * 100).toFixed(1)}%`);
    lines.push('');

    // Coordination
    lines.push('── COORDINATION ────────────────────────────────────────');
    lines.push(`  Messages sent: ${snap.messages.totalMessages}`);
    lines.push(`  Throughput: ${snap.messages.messagesPerSecond.toFixed(1)} msg/s`);
    lines.push(`  Deadlocks detected: ${snap.deadlocks.detected} | Resolved: ${snap.deadlocks.resolved}`);
    lines.push('');

    // Goals
    lines.push('── GOALS ────────────────────────────────────────────────');
    for (const goal of snap.workflows.goals) {
      lines.push(`  [${goal.status.toUpperCase()}] ${goal.title}`);
      for (const ws of goal.workstreams) {
        lines.push(`    ├─ [${ws.status.toUpperCase()}] ${ws.title} (${ws.taskProgress.completed}/${ws.taskProgress.total} tasks)`);
      }
    }
    lines.push('');

    // Recent events
    lines.push('── RECENT EVENTS ───────────────────────────────────────');
    for (const event of snap.messages.recentEvents.slice(-5)) {
      const agent = event.agentId ? `agent=${event.agentId.substring(0, 8)}…` : '';
      const task = event.taskId ? `task=${event.taskId.substring(0, 8)}…` : '';
      lines.push(`  ${event.type} ${agent} ${task}`);
    }
    lines.push('');

    lines.push('═══════════════════════════════════════════════════════════');

    return lines.join('\n');
  }

  /**
   * Render a compact single-line status.
   */
  renderCompact(): string {
    const snap = this.snapshot();
    return [
      `Agents:${snap.agents.activeCount}/${snap.agents.total}`,
      `Tasks:${snap.tasks.byState['completed']}/${snap.tasks.total}`,
      `Rate:${(snap.tasks.completionRate * 100).toFixed(0)}%`,
      `RU:${snap.resources.utilizationPercent}%`,
      `Msgs:${snap.messages.totalMessages}`,
    ].join(' | ');
  }
}