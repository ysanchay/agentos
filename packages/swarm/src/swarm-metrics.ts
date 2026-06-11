/**
 * @agentos/swarm — Swarm Metrics
 * Tracks completion rate, resource utilization, task duplication, task latency,
 * deadlock frequency, recovery success rate, validation accuracy, and message
 * throughput for the swarm runtime.
 *
 * All metrics are computed from in-memory state — no external dependencies.
 */

import type {
  AgentID,
  TaskID,
  ResourceBudget,
  ResourceConsumption,
} from '@agentos/types';
import { TaskState } from '@agentos/types';
import type { SwarmMetrics, MissionControlEvent, MissionControlEventType } from './types.js';

// ─── Swarm Metrics ─────────────────────────────────────────────────────────

export class SwarmMetricsCollector {
  // Task tracking
  private taskStartTimes: Map<TaskID, number> = new Map();
  private taskEndTimes: Map<TaskID, number> = new Map();
  private taskStates: Map<TaskID, TaskState> = new Map();
  private taskClaimAttempts: Map<TaskID, AgentID[]> = new Map();

  // Agent tracking
  private agentStates: Map<AgentID, string> = new Map();
  private agentErrors: Map<AgentID, number> = new Map();

  // Workstream tracking
  private workstreamStates: Map<string, string> = new Map();

  // Resource tracking
  private totalAllocated: ResourceBudget = { ru: 0, mu: 0, eu: 0, vu: 0 };
  private totalConsumed: ResourceBudget = { ru: 0, mu: 0, eu: 0, vu: 0 };

  // Validation tracking
  private validationRequests: number = 0;
  private validationApprovals: number = 0;
  private validationRejections: number = 0;

  // Coordination tracking
  private deadlockCount: number = 0;
  private deadlockResolutions: number = 0;
  private recoveryAttempts: number = 0;
  private recoverySuccesses: number = 0;
  private duplicateClaims: number = 0;

  // Message tracking
  private messagesSent: number = 0;
  private startTime: number = 0;
  private endTime: number = 0;

  // Mission Control event log
  private events: MissionControlEvent[] = [];

  // ─── Task Metrics ────────────────────────────────────────────────────────

  recordTaskCreated(taskId: TaskID): void {
    this.taskStates.set(taskId, TaskState.ANNOUNCED);
    this.taskStartTimes.set(taskId, Date.now());
  }

  recordTaskClaimed(taskId: TaskID, agentId: AgentID): void {
    this.taskStates.set(taskId, TaskState.CLAIMED);
    const claimants = this.taskClaimAttempts.get(taskId) ?? [];
    claimants.push(agentId);
    this.taskClaimAttempts.set(taskId, claimants);

    // Detect duplicate claims (multiple agents claiming same task)
    if (claimants.length > 1) {
      this.duplicateClaims++;
    }
  }

  recordTaskStarted(taskId: TaskID): void {
    this.taskStates.set(taskId, TaskState.IN_PROGRESS);
  }

  recordTaskCompleted(taskId: TaskID): void {
    this.taskStates.set(taskId, TaskState.COMPLETED);
    this.taskEndTimes.set(taskId, Date.now());
  }

  recordTaskFailed(taskId: TaskID): void {
    this.taskStates.set(taskId, TaskState.FAILED);
    this.taskEndTimes.set(taskId, Date.now());
  }

  recordTaskCancelled(taskId: TaskID): void {
    this.taskStates.set(taskId, TaskState.CANCELLED);
    this.taskEndTimes.set(taskId, Date.now());
  }

  // ─── Agent Metrics ───────────────────────────────────────────────────────

  recordAgentState(agentId: AgentID, state: string): void {
    this.agentStates.set(agentId, state);
  }

  recordAgentError(agentId: AgentID): void {
    this.agentErrors.set(agentId, (this.agentErrors.get(agentId) ?? 0) + 1);
  }

  // ─── Workstream Metrics ───────────────────────────────────────────────────

  recordWorkstreamState(workstreamId: string, state: string): void {
    this.workstreamStates.set(workstreamId, state);
  }

  // ─── Resource Metrics ─────────────────────────────────────────────────────

  recordAllocation(allocation: ResourceBudget): void {
    this.totalAllocated.ru += allocation.ru;
    this.totalAllocated.mu += allocation.mu;
    this.totalAllocated.eu += allocation.eu;
    this.totalAllocated.vu += allocation.vu;
  }

  recordConsumption(consumption: ResourceConsumption): void {
    this.totalConsumed.ru += consumption.ru;
    this.totalConsumed.mu += consumption.mu;
    this.totalConsumed.eu += consumption.eu;
    this.totalConsumed.vu += consumption.vu;
  }

  // ─── Validation Metrics ───────────────────────────────────────────────────

  recordValidationRequest(): void {
    this.validationRequests++;
  }

  recordValidationResult(approved: boolean): void {
    if (approved) {
      this.validationApprovals++;
    } else {
      this.validationRejections++;
    }
  }

  // ─── Coordination Metrics ─────────────────────────────────────────────────

  recordDeadlock(): void {
    this.deadlockCount++;
  }

  recordDeadlockResolution(): void {
    this.deadlockResolutions++;
  }

  recordRecoveryAttempt(success: boolean): void {
    this.recoveryAttempts++;
    if (success) this.recoverySuccesses++;
  }

  // ─── Message Metrics ──────────────────────────────────────────────────────

  recordMessage(): void {
    this.messagesSent++;
  }

  // ─── Mission Control Events ───────────────────────────────────────────────

  recordEvent(event: MissionControlEvent): void {
    this.events.push(event);
  }

  // ─── Timing ───────────────────────────────────────────────────────────────

  startTiming(): void {
    this.startTime = Date.now();
  }

  stopTiming(): void {
    this.endTime = Date.now();
  }

  // ─── Compute Metrics ─────────────────────────────────────────────────────

  compute(): SwarmMetrics {
    const durationMs = this.endTime > 0 ? this.endTime - this.startTime : 0;
    const seconds = durationMs / 1000;

    // Task metrics
    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    let pending = 0;

    for (const [, state] of this.taskStates) {
      switch (state) {
        case TaskState.COMPLETED: completed++; break;
        case TaskState.FAILED: failed++; break;
        case TaskState.CANCELLED: cancelled++; break;
        default: pending++; break;
      }
    }

    const totalTasks = this.taskStates.size;
    const completionRate = totalTasks > 0 ? completed / totalTasks : 0;

    // Agent metrics
    let activeAgents = 0;
    let idleAgents = 0;
    let erroredAgents = 0;

    for (const [, state] of this.agentStates) {
      switch (state) {
        case 'running': case 'working': activeAgents++; break;
        case 'ready': case 'idle': idleAgents++; break;
        case 'errored': case 'error': erroredAgents++; break;
      }
    }

    // Workstream metrics
    let completedWorkstreams = 0;
    let failedWorkstreams = 0;

    for (const [, state] of this.workstreamStates) {
      switch (state) {
        case 'completed': completedWorkstreams++; break;
        case 'failed': failedWorkstreams++; break;
      }
    }

    // Task latency
    let totalLatency = 0;
    let latencyCount = 0;

    for (const [taskId, endTime] of this.taskEndTimes) {
      const startTime = this.taskStartTimes.get(taskId);
      if (startTime !== undefined) {
        totalLatency += endTime - startTime;
        latencyCount++;
      }
    }

    const averageTaskLatencyMs = latencyCount > 0 ? totalLatency / latencyCount : 0;

    // Resource utilization
    const totalAllocatedAmount = this.totalAllocated.ru + this.totalAllocated.mu +
      this.totalAllocated.eu + this.totalAllocated.vu;
    const totalConsumedAmount = this.totalConsumed.ru + this.totalConsumed.mu +
      this.totalConsumed.eu + this.totalConsumed.vu;
    const resourceUtilization = totalAllocatedAmount > 0
      ? totalConsumedAmount / totalAllocatedAmount
      : 0;

    // Recovery success rate
    const recoverySuccessRate = this.recoveryAttempts > 0
      ? this.recoverySuccesses / this.recoveryAttempts
      : 1; // Perfect if no recoveries needed

    // Validation accuracy
    const validationAccuracy = this.validationRequests > 0
      ? this.validationApprovals / this.validationRequests
      : 0;

    // Message throughput
    const messagesPerSecond = seconds > 0 ? this.messagesSent / seconds : 0;

    return {
      totalTasks,
      completedTasks: completed,
      failedTasks: failed,
      cancelledTasks: cancelled,
      pendingTasks: pending,
      completionRate,
      totalAgents: this.agentStates.size,
      activeAgents,
      idleAgents,
      erroredAgents,
      totalWorkstreams: this.workstreamStates.size,
      completedWorkstreams,
      failedWorkstreams,
      ruAllocated: this.totalAllocated.ru,
      ruConsumed: this.totalConsumed.ru,
      muAllocated: this.totalAllocated.mu,
      muConsumed: this.totalConsumed.mu,
      euAllocated: this.totalAllocated.eu,
      euConsumed: this.totalConsumed.eu,
      vuAllocated: this.totalAllocated.vu,
      vuConsumed: this.totalConsumed.vu,
      resourceUtilization,
      taskDuplication: this.duplicateClaims,
      averageTaskLatencyMs,
      deadlockCount: this.deadlockCount,
      recoverySuccessRate,
      validationRequests: this.validationRequests,
      validationApprovals: this.validationApprovals,
      validationRejections: this.validationRejections,
      validationAccuracy,
      messagesSent: this.messagesSent,
      messagesPerSecond,
      startTime: this.startTime,
      endTime: this.endTime,
      durationMs,
    };
  }

  // ─── Event History ───────────────────────────────────────────────────────

  getEvents(type?: MissionControlEventType): MissionControlEvent[] {
    if (type) {
      return this.events.filter((e) => e.type === type);
    }
    return [...this.events];
  }

  getEventsByAgent(agentId: AgentID): MissionControlEvent[] {
    return this.events.filter((e) => e.agentId === agentId);
  }

  getEventsByTask(taskId: TaskID): MissionControlEvent[] {
    return this.events.filter((e) => e.taskId === taskId);
  }
}