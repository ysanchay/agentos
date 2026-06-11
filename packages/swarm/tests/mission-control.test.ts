/**
 * @agentos/swarm — Mission Control Tests
 * Tests for MissionControl snapshot generation, AgentOverview,
 * TaskOverview, ResourceOverview, MessageTraffic, WorkflowProgress,
 * Validation section, Deadlocks, render() output, renderCompact(),
 * and empty metrics edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUUID, AgentState } from '@agentos/types';
import type { AgentID, TaskID, WorkspaceID, ProjectID, Priority } from '@agentos/types';
import { SwarmMetricsCollector } from '../src/swarm-metrics.js';
import { MissionControl } from '../src/mission-control.js';
import type { MissionControlSnapshot } from '../src/mission-control.js';
import { ChiefAgent } from '../src/chief-agent.js';
import { ManagerAgent } from '../src/manager-agent.js';
import { WorkerAgent } from '../src/worker-agent.js';
import { ValidatorAgent } from '../src/validator-agent.js';
import { SwarmAgent } from '../src/swarm-agent.js';

// ─── Mock Context ──────────────────────────────────────────────────────────

function createMockContext() {
  const events: any[] = [];
  const messages: any[] = [];

  return {
    eventBus: {
      publish: vi.fn((event: any) => events.push(event)),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      getHistory: vi.fn(() => []),
      createEvent: vi.fn(),
      subscribeToEntity: vi.fn(),
    },
    blackboard: {
      publishTask: vi.fn(() => ({ ok: true })),
      claimTask: vi.fn(() => ({ ok: true })),
      releaseClaim: vi.fn(() => ({ ok: true })),
      submitResult: vi.fn(() => ({ ok: true })),
      validateResult: vi.fn(() => ({ ok: true })),
      getAvailableTasks: vi.fn(() => []),
      getTask: vi.fn(() => null),
      writeContext: vi.fn(),
      readContext: vi.fn(),
    },
    scheduler: {
      requestAllocation: vi.fn(() => ({ ok: true, allocation: {} })),
      releaseAllocation: vi.fn(),
      reportConsumption: vi.fn(),
      getActiveAllocations: vi.fn(() => []),
    },
    config: {
      id: 'test-swarm',
      totalBudget: { ru: 100_000, mu: 50_000, eu: 10_000, vu: 5_000 },
      maxWorkersPerManager: 20,
      maxTasksPerWorker: 3,
      maxRetries: 3,
      validationThreshold: 0.7,
      validatorsPerResult: 3,
      llmMode: 'none' as const,
      persistEvents: true,
      clockSpeed: 10,
    },
    sendMessage: vi.fn((msg: any) => messages.push(msg)),
    onMessage: vi.fn(),
    currentTime: vi.fn(() => Date.now()),
    _events: events,
    _messages: messages,
  };
}

type MockContext = ReturnType<typeof createMockContext>;

function createIds() {
  return {
    workspaceId: createUUID() as unknown as WorkspaceID,
    projectId: createUUID() as unknown as ProjectID,
  };
}

// ─── Helper: Create agents in specific states ──────────────────────────────

function createAgentsInStates(): {
  chief: ChiefAgent;
  managers: ManagerAgent[];
  workers: WorkerAgent[];
  validators: ValidatorAgent[];
  allAgents: SwarmAgent[];
  contexts: MockContext[];
} {
  const ids = createIds();
  const contexts: MockContext[] = [];

  const chief = new ChiefAgent({
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
  });

  const manager1 = new ManagerAgent({
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
  });

  const manager2 = new ManagerAgent({
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
  });

  const worker1 = new WorkerAgent({
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
  });

  const worker2 = new WorkerAgent({
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
  });

  const worker3 = new WorkerAgent({
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
  });

  const validator1 = new ValidatorAgent({
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
  });

  const validator2 = new ValidatorAgent({
    workspaceId: ids.workspaceId,
    projectId: ids.projectId,
  });

  const allAgents = [chief, manager1, manager2, worker1, worker2, worker3, validator1, validator2];
  const managers = [manager1, manager2];
  const workers = [worker1, worker2, worker3];
  const validators = [validator1, validator2];

  // Connect and initialize all agents
  for (const agent of allAgents) {
    const ctx = createMockContext();
    contexts.push(ctx);
    agent.connect(ctx as any);
    agent.initialize();
  }

  // Put some agents in specific states
  // worker2 is running (has active task)
  worker2.startTask(createUUID() as unknown as TaskID);
  // worker3 is errored — force the transition
  (worker3 as any)._state = AgentState.ERRORED;

  return { chief, managers, workers, validators, allAgents, contexts };
}

// ═══════════════════════════════════════════════════════════════════════════
// Snapshot with Known Agent States
// ═══════════════════════════════════════════════════════════════════════════

describe('MissionControl snapshot — agent states', () => {
  let metrics: SwarmMetricsCollector;
  let agents: ReturnType<typeof createAgentsInStates>;

  beforeEach(() => {
    metrics = new SwarmMetricsCollector();
    metrics.startTiming();
    agents = createAgentsInStates();

    // Record agent states in metrics
    for (const agent of agents.allAgents) {
      metrics.recordAgentState(agent.id, agent.state as string);
    }
  });

  it('should snapshot with correct agent counts', () => {
    const missionControl = new MissionControl(
      metrics,
      agents.allAgents,
      agents.chief,
      agents.managers,
      agents.workers,
      agents.validators,
    );

    const snap = missionControl.snapshot();
    expect(snap.agents.total).toBe(8); // 1 chief + 2 managers + 3 workers + 2 validators
  });

  it('should count idle (ready) agents', () => {
    const missionControl = new MissionControl(
      metrics,
      agents.allAgents,
      agents.chief,
      agents.managers,
      agents.workers,
      agents.validators,
    );

    const snap = missionControl.snapshot();
    // chief (ready), manager1 (ready), manager2 (ready), worker1 (ready), validator1 (ready), validator2 (ready)
    expect(snap.agents.idleCount).toBe(6);
  });

  it('should count active (running) agents', () => {
    const missionControl = new MissionControl(
      metrics,
      agents.allAgents,
      agents.chief,
      agents.managers,
      agents.workers,
      agents.validators,
    );

    const snap = missionControl.snapshot();
    // worker2 is running
    expect(snap.agents.activeCount).toBe(1);
  });

  it('should count errored agents', () => {
    const missionControl = new MissionControl(
      metrics,
      agents.allAgents,
      agents.chief,
      agents.managers,
      agents.workers,
      agents.validators,
    );

    const snap = missionControl.snapshot();
    // worker3 is errored
    expect(snap.agents.erroredCount).toBe(1);
  });

  it('should categorize agents by type', () => {
    const missionControl = new MissionControl(
      metrics,
      agents.allAgents,
      agents.chief,
      agents.managers,
      agents.workers,
      agents.validators,
    );

    const snap = missionControl.snapshot();
    expect(snap.agents.byType['chief']).toBe(1);
    expect(snap.agents.byType['manager']).toBe(2);
    expect(snap.agents.byType['worker']).toBe(3);
    expect(snap.agents.byType['validator']).toBe(2);
  });

  it('should categorize agents by state', () => {
    const missionControl = new MissionControl(
      metrics,
      agents.allAgents,
      agents.chief,
      agents.managers,
      agents.workers,
      agents.validators,
    );

    const snap = missionControl.snapshot();
    expect(snap.agents.byState['ready']).toBeDefined();
    expect(snap.agents.byState['running']).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TaskOverview
// ═══════════════════════════════════════════════════════════════════════════

describe('MissionControl snapshot — tasks', () => {
  let metrics: SwarmMetricsCollector;

  beforeEach(() => {
    metrics = new SwarmMetricsCollector();
    metrics.startTiming();
  });

  it('should report task counts by state', () => {
    metrics.recordTaskCreated(createUUID() as unknown as TaskID);
    metrics.recordTaskCreated(createUUID() as unknown as TaskID);
    metrics.recordTaskCreated(createUUID() as unknown as TaskID);

    const taskId1 = createUUID() as unknown as TaskID;
    const taskId2 = createUUID() as unknown as TaskID;
    metrics.recordTaskCreated(taskId1);
    metrics.recordTaskClaimed(taskId1, createUUID() as unknown as AgentID);
    metrics.recordTaskCompleted(taskId1);

    metrics.recordTaskCreated(taskId2);
    metrics.recordTaskClaimed(taskId2, createUUID() as unknown as AgentID);
    metrics.recordTaskFailed(taskId2);

    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.tasks.total).toBe(5);
    expect(snap.tasks.byState['completed']).toBe(1);
    expect(snap.tasks.byState['failed']).toBe(1);
  });

  it('should calculate completion rate', () => {
    const taskId1 = createUUID() as unknown as TaskID;
    const taskId2 = createUUID() as unknown as TaskID;

    metrics.recordTaskCreated(taskId1);
    metrics.recordTaskClaimed(taskId1, createUUID() as unknown as AgentID);
    metrics.recordTaskCompleted(taskId1);

    metrics.recordTaskCreated(taskId2);
    metrics.recordTaskClaimed(taskId2, createUUID() as unknown as AgentID);
    metrics.recordTaskCompleted(taskId2);

    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.tasks.completionRate).toBe(1);
  });

  it('should calculate average latency', () => {
    const taskId = createUUID() as unknown as TaskID;
    metrics.recordTaskCreated(taskId);
    metrics.recordTaskClaimed(taskId, createUUID() as unknown as AgentID);
    metrics.recordTaskCompleted(taskId);

    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.tasks.averageLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('should track duplicate claims in task overview', () => {
    const taskId = createUUID() as unknown as TaskID;
    metrics.recordTaskCreated(taskId);
    metrics.recordTaskClaimed(taskId, createUUID() as unknown as AgentID);
    metrics.recordTaskClaimed(taskId, createUUID() as unknown as AgentID);

    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.tasks.duplicateClaims).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ResourceOverview
// ═══════════════════════════════════════════════════════════════════════════

describe('MissionControl snapshot — resources', () => {
  let metrics: SwarmMetricsCollector;

  beforeEach(() => {
    metrics = new SwarmMetricsCollector();
    metrics.startTiming();
  });

  it('should report allocated vs consumed resources', () => {
    metrics.recordAllocation({ ru: 1000, mu: 500, eu: 100, vu: 50 });
    metrics.recordConsumption({ ru: 600, mu: 300, eu: 60, vu: 25 });

    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.resources.allocated.ru).toBe(1000);
    expect(snap.resources.allocated.mu).toBe(500);
    expect(snap.resources.allocated.eu).toBe(100);
    expect(snap.resources.allocated.vu).toBe(50);

    expect(snap.resources.consumed.ru).toBe(600);
    expect(snap.resources.consumed.mu).toBe(300);
    expect(snap.resources.consumed.eu).toBe(60);
    expect(snap.resources.consumed.vu).toBe(25);
  });

  it('should calculate utilization percentage', () => {
    metrics.recordAllocation({ ru: 1000, mu: 500, eu: 100, vu: 50 }); // total = 1650
    metrics.recordConsumption({ ru: 500, mu: 250, eu: 50, vu: 25 });  // total = 825

    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    // utilizationPercent = Math.round(825 / 1650 * 100) = 50
    expect(snap.resources.utilizationPercent).toBe(50);
  });

  it('should handle zero allocation gracefully', () => {
    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.resources.utilizationPercent).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MessageTraffic
// ═══════════════════════════════════════════════════════════════════════════

describe('MissionControl snapshot — messages', () => {
  let metrics: SwarmMetricsCollector;

  beforeEach(() => {
    metrics = new SwarmMetricsCollector();
    metrics.startTiming();
  });

  it('should report total messages', () => {
    for (let i = 0; i < 50; i++) {
      metrics.recordMessage();
    }
    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.messages.totalMessages).toBe(50);
  });

  it('should report messages per second', () => {
    for (let i = 0; i < 100; i++) {
      metrics.recordMessage();
    }
    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.messages.messagesPerSecond).toBeGreaterThanOrEqual(0);
  });

  it('should categorize messages by type from events', () => {
    metrics.recordEvent({
      id: createUUID(),
      type: 'task.claimed',
      agentId: createUUID() as unknown as AgentID,
      timestamp: Date.now(),
      data: {},
    });

    metrics.recordEvent({
      id: createUUID(),
      type: 'task.completed',
      agentId: createUUID() as unknown as AgentID,
      timestamp: Date.now(),
      data: {},
    });

    metrics.recordEvent({
      id: createUUID(),
      type: 'task.claimed',
      agentId: createUUID() as unknown as AgentID,
      timestamp: Date.now(),
      data: {},
    });

    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.messages.byType['task.claimed']).toBe(2);
    expect(snap.messages.byType['task.completed']).toBe(1);
  });

  it('should include recent events in message traffic', () => {
    for (let i = 0; i < 25; i++) {
      metrics.recordEvent({
        id: createUUID(),
        type: 'task.claimed',
        agentId: createUUID() as unknown as AgentID,
        timestamp: Date.now(),
        data: { index: i },
      });
    }

    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    // recentEvents is last 20 from the events array
    expect(snap.messages.recentEvents.length).toBeLessThanOrEqual(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WorkflowProgress
// ═══════════════════════════════════════════════════════════════════════════

describe('MissionControl snapshot — workflows', () => {
  it('should return empty goals when no chief is provided', () => {
    const metrics = new SwarmMetricsCollector();
    metrics.startTiming();
    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.workflows.goals).toEqual([]);
  });

  it('should include goals from chief', () => {
    const ids = createIds();
    const chief = new ChiefAgent({
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
    });

    const context = createMockContext();
    chief.connect(context as any);
    chief.initialize();

    chief.submitGoal({
      title: 'Test goal',
      description: 'Test goal for workflow progress',
      priority: 3 as Priority,
      budget: { ru: 5000, mu: 3000, eu: 1000, vu: 500 },
      createdBy: chief.id,
      metadata: {},
    });

    const metrics = new SwarmMetricsCollector();
    metrics.startTiming();
    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, [], chief);
    const snap = missionControl.snapshot();

    expect(snap.workflows.goals.length).toBe(1);
    expect(snap.workflows.goals[0]!.title).toBe('Test goal');
    expect(snap.workflows.goals[0]!.status).toBe('in_progress');
    expect(snap.workflows.goals[0]!.workstreams.length).toBeGreaterThan(0);
  });

  it('should include workstream task progress', () => {
    const ids = createIds();
    const chief = new ChiefAgent({
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
    });

    const context = createMockContext();
    chief.connect(context as any);
    chief.initialize();

    chief.submitGoal({
      title: 'Progress test',
      description: 'Test workstream progress tracking',
      priority: 3 as Priority,
      budget: { ru: 5000, mu: 3000, eu: 1000, vu: 500 },
      createdBy: chief.id,
      metadata: {},
    });

    const workstreams = chief.getWorkstreams();

    const manager = new ManagerAgent({
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
    });
    const managerCtx = createMockContext();
    manager.connect(managerCtx as any);
    manager.initialize();

    // Assign first workstream to the manager
    if (workstreams.length > 0) {
      chief.assignWorkstream(workstreams[0]!.id, manager.id);
      manager.assignWorkstream(workstreams[0]!);
    }

    const metrics = new SwarmMetricsCollector();
    metrics.startTiming();
    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, [], chief, [manager]);
    const snap = missionControl.snapshot();

    const goal = snap.workflows.goals[0];
    expect(goal).toBeDefined();
    if (goal && goal.workstreams.length > 0) {
      const ws = goal.workstreams[0]!;
      expect(ws.taskProgress).toHaveProperty('completed');
      expect(ws.taskProgress).toHaveProperty('total');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Validation Section
// ═══════════════════════════════════════════════════════════════════════════

describe('MissionControl snapshot — validation', () => {
  it('should report validation requests, approvals, and rejections', () => {
    const metrics = new SwarmMetricsCollector();
    metrics.startTiming();

    metrics.recordValidationRequest();
    metrics.recordValidationResult(true);
    metrics.recordValidationRequest();
    metrics.recordValidationResult(true);
    metrics.recordValidationRequest();
    metrics.recordValidationResult(false);

    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.validation.requests).toBe(3);
    expect(snap.validation.approvals).toBe(2);
    expect(snap.validation.rejections).toBe(1);
  });

  it('should calculate validation accuracy', () => {
    const metrics = new SwarmMetricsCollector();
    metrics.startTiming();

    metrics.recordValidationRequest();
    metrics.recordValidationResult(true);
    metrics.recordValidationRequest();
    metrics.recordValidationResult(false);

    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    // Accuracy = approvals / requests = 1 / 2 = 0.5
    expect(snap.validation.accuracy).toBe(0.5);
  });

  it('should report zero validation metrics when none recorded', () => {
    const metrics = new SwarmMetricsCollector();
    metrics.startTiming();
    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.validation.requests).toBe(0);
    expect(snap.validation.approvals).toBe(0);
    expect(snap.validation.rejections).toBe(0);
    expect(snap.validation.accuracy).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Deadlocks
// ═══════════════════════════════════════════════════════════════════════════

describe('MissionControl snapshot — deadlocks', () => {
  it('should report detected deadlocks', () => {
    const metrics = new SwarmMetricsCollector();
    metrics.startTiming();

    metrics.recordDeadlock();
    metrics.recordDeadlock();
    metrics.recordDeadlock();
    metrics.recordDeadlockResolution();

    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.deadlocks.detected).toBe(3);
  });

  it('should calculate resolved deadlocks based on recovery success rate', () => {
    const metrics = new SwarmMetricsCollector();
    metrics.startTiming();

    metrics.recordDeadlock();
    metrics.recordDeadlock();
    metrics.recordDeadlockResolution();
    metrics.recordRecoveryAttempt(true);
    metrics.recordRecoveryAttempt(false);

    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.deadlocks.detected).toBe(2);
    // resolved = recoverySuccessRate * deadlockCount = 0.5 * 2 = 1
    expect(snap.deadlocks.resolved).toBe(1);
  });

  it('should report zero deadlocks when none detected', () => {
    const metrics = new SwarmMetricsCollector();
    metrics.startTiming();
    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.deadlocks.detected).toBe(0);
    expect(snap.deadlocks.resolved).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// render() Output Format
// ═══════════════════════════════════════════════════════════════════════════

describe('MissionControl render()', () => {
  let metrics: SwarmMetricsCollector;

  beforeEach(() => {
    metrics = new SwarmMetricsCollector();
    metrics.startTiming();
  });

  it('should include MISSION CONTROL header', () => {
    const missionControl = new MissionControl(metrics, []);
    metrics.recordAgentState(createUUID() as unknown as AgentID, 'ready');
    metrics.stopTiming();

    const output = missionControl.render();
    expect(output).toContain('MISSION CONTROL');
  });

  it('should include AGENTS section', () => {
    const missionControl = new MissionControl(metrics, []);
    metrics.recordAgentState(createUUID() as unknown as AgentID, 'ready');
    metrics.stopTiming();

    const output = missionControl.render();
    expect(output).toContain('AGENTS');
    expect(output).toContain('Total:');
  });

  it('should include TASKS section', () => {
    const missionControl = new MissionControl(metrics, []);
    metrics.recordTaskCreated(createUUID() as unknown as TaskID);
    metrics.stopTiming();

    const output = missionControl.render();
    expect(output).toContain('TASKS');
    expect(output).toContain('Completed:');
    expect(output).toContain('Failed:');
  });

  it('should include RESOURCES section', () => {
    const missionControl = new MissionControl(metrics, []);
    metrics.recordAllocation({ ru: 1000, mu: 500, eu: 100, vu: 50 });
    metrics.stopTiming();

    const output = missionControl.render();
    expect(output).toContain('RESOURCES');
    expect(output).toContain('RU:');
    expect(output).toContain('MU:');
    expect(output).toContain('EU:');
    expect(output).toContain('VU:');
    expect(output).toContain('Utilization:');
  });

  it('should include VALIDATION section', () => {
    const missionControl = new MissionControl(metrics, []);
    metrics.stopTiming();

    const output = missionControl.render();
    expect(output).toContain('VALIDATION');
  });

  it('should include COORDINATION section', () => {
    const missionControl = new MissionControl(metrics, []);
    metrics.stopTiming();

    const output = missionControl.render();
    expect(output).toContain('COORDINATION');
    expect(output).toContain('Messages sent:');
    expect(output).toContain('Deadlocks detected:');
  });

  it('should include GOALS section', () => {
    const missionControl = new MissionControl(metrics, []);
    metrics.stopTiming();

    const output = missionControl.render();
    expect(output).toContain('GOALS');
  });

  it('should include RECENT EVENTS section', () => {
    const missionControl = new MissionControl(metrics, []);
    metrics.stopTiming();

    const output = missionControl.render();
    expect(output).toContain('RECENT EVENTS');
  });

  it('should render agent type counts', () => {
    const ids = createIds();
    const agents: SwarmAgent[] = [];

    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId });
    const validator = new ValidatorAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId });

    for (const agent of [worker, validator]) {
      const ctx = createMockContext();
      agent.connect(ctx as any);
      agent.initialize();
      agents.push(agent);
      metrics.recordAgentState(agent.id, agent.state as string);
    }

    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, agents);
    const output = missionControl.render();

    expect(output).toContain('worker:');
    expect(output).toContain('validator:');
  });

  it('should render completion rate as percentage', () => {
    const taskId = createUUID() as unknown as TaskID;
    metrics.recordTaskCreated(taskId);
    metrics.recordTaskClaimed(taskId, createUUID() as unknown as AgentID);
    metrics.recordTaskCompleted(taskId);
    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const output = missionControl.render();

    expect(output).toContain('Completion rate:');
    expect(output).toContain('100.0%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// renderCompact() Single-Line Format
// ═══════════════════════════════════════════════════════════════════════════

describe('MissionControl renderCompact()', () => {
  let metrics: SwarmMetricsCollector;

  beforeEach(() => {
    metrics = new SwarmMetricsCollector();
    metrics.startTiming();
  });

  it('should produce a single-line format', () => {
    const missionControl = new MissionControl(metrics, []);
    metrics.recordAgentState(createUUID() as unknown as AgentID, 'running');
    metrics.stopTiming();

    const compact = missionControl.renderCompact();
    // Should be a single line (no newlines)
    expect(compact).not.toContain('\n');
  });

  it('should include all key metrics separated by pipes', () => {
    const missionControl = new MissionControl(metrics, []);
    metrics.recordAgentState(createUUID() as unknown as AgentID, 'running');
    metrics.stopTiming();

    const compact = missionControl.renderCompact();
    expect(compact).toContain('Agents:');
    expect(compact).toContain('Tasks:');
    expect(compact).toContain('Rate:');
    expect(compact).toContain('RU:');
    expect(compact).toContain('Msgs:');
    expect(compact).toContain('|');
  });

  it('should show active/total agent count', () => {
    const ids = createIds();
    const agents: SwarmAgent[] = [];

    const worker1 = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId });
    const worker2 = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId });

    for (const agent of [worker1, worker2]) {
      const ctx = createMockContext();
      agent.connect(ctx as any);
      agent.initialize();
      agents.push(agent);
      metrics.recordAgentState(agent.id, agent.state as string);
    }

    // Make worker1 active
    worker1.startTask(createUUID() as unknown as TaskID);
    metrics.recordAgentState(worker1.id, 'running');

    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, agents);
    const compact = missionControl.renderCompact();

    // Should show "Agents:1/2" (1 active out of 2 total)
    expect(compact).toContain('Agents:1/2');
  });

  it('should show completion rate as percentage without decimal', () => {
    const taskId = createUUID() as unknown as TaskID;
    metrics.recordTaskCreated(taskId);
    metrics.recordTaskClaimed(taskId, createUUID() as unknown as AgentID);
    metrics.recordTaskCompleted(taskId);
    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const compact = missionControl.renderCompact();

    // toFixed(0) => "100%"
    expect(compact).toContain('Rate:100%');
  });

  it('should show resource utilization as percentage', () => {
    metrics.recordAllocation({ ru: 1000, mu: 500, eu: 100, vu: 50 });
    metrics.recordConsumption({ ru: 500, mu: 250, eu: 50, vu: 25 });
    metrics.stopTiming();

    const missionControl = new MissionControl(metrics, []);
    const compact = missionControl.renderCompact();

    // 50% utilization
    expect(compact).toContain('RU:50%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Empty Metrics Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe('MissionControl — empty metrics', () => {
  let metrics: SwarmMetricsCollector;

  beforeEach(() => {
    metrics = new SwarmMetricsCollector();
    metrics.startTiming();
    metrics.stopTiming();
  });

  it('should handle zero agents gracefully', () => {
    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.agents.total).toBe(0);
    expect(snap.agents.activeCount).toBe(0);
    expect(snap.agents.idleCount).toBe(0);
    expect(snap.agents.erroredCount).toBe(0);
    expect(snap.agents.terminatedCount).toBe(0);
    expect(snap.agents.byType).toEqual({});
    expect(snap.agents.byState).toEqual({});
  });

  it('should handle zero tasks gracefully', () => {
    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.tasks.total).toBe(0);
    expect(snap.tasks.byState['completed']).toBe(0);
    expect(snap.tasks.byState['failed']).toBe(0);
    expect(snap.tasks.byState['cancelled']).toBe(0);
    expect(snap.tasks.byState['pending']).toBe(0);
    expect(snap.tasks.completionRate).toBe(0);
    expect(snap.tasks.averageLatencyMs).toBe(0);
  });

  it('should handle zero resources gracefully', () => {
    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.resources.allocated.ru).toBe(0);
    expect(snap.resources.allocated.mu).toBe(0);
    expect(snap.resources.allocated.eu).toBe(0);
    expect(snap.resources.allocated.vu).toBe(0);
    expect(snap.resources.consumed.ru).toBe(0);
    expect(snap.resources.consumed.mu).toBe(0);
    expect(snap.resources.consumed.eu).toBe(0);
    expect(snap.resources.consumed.vu).toBe(0);
    expect(snap.resources.utilizationPercent).toBe(0);
  });

  it('should handle zero messages gracefully', () => {
    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.messages.totalMessages).toBe(0);
    expect(snap.messages.messagesPerSecond).toBe(0);
    expect(snap.messages.byType).toEqual({});
    expect(snap.messages.recentEvents).toEqual([]);
  });

  it('should handle zero validation metrics gracefully', () => {
    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.validation.requests).toBe(0);
    expect(snap.validation.approvals).toBe(0);
    expect(snap.validation.rejections).toBe(0);
    expect(snap.validation.accuracy).toBe(0);
  });

  it('should handle zero deadlocks gracefully', () => {
    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.deadlocks.detected).toBe(0);
    expect(snap.deadlocks.resolved).toBe(0);
  });

  it('should handle zero goals gracefully', () => {
    const missionControl = new MissionControl(metrics, []);
    const snap = missionControl.snapshot();

    expect(snap.workflows.goals).toEqual([]);
  });

  it('should still produce valid render output with all zeros', () => {
    const missionControl = new MissionControl(metrics, []);

    const output = missionControl.render();
    expect(output).toContain('MISSION CONTROL');
    expect(output).toContain('AGENTS');
    expect(output).toContain('TASKS');
    expect(output).toContain('RESOURCES');
    expect(output).toContain('VALIDATION');
    expect(output).toContain('COORDINATION');
    expect(output).toContain('GOALS');

    // Should not throw on all-zeros
    expect(() => missionControl.render()).not.toThrow();
  });

  it('should produce valid compact output with all zeros', () => {
    const missionControl = new MissionControl(metrics, []);

    const compact = missionControl.renderCompact();
    expect(compact).toContain('Agents:0/0');
    expect(compact).toContain('Tasks:0/0');
    expect(compact).toContain('Rate:0%');
    expect(compact).toContain('RU:0%');
    expect(compact).toContain('Msgs:0');
  });
});