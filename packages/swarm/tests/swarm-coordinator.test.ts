/**
 * @agentos/swarm — SwarmCoordinator & SwarmMetrics Tests
 * Integration tests for the full swarm lifecycle and metrics collection.
 *
 * All tests run entirely in simulation — no external dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUUID, AgentState, TaskState } from '@agentos/types';
import type { Priority, AgentID, WorkspaceID, ProjectID } from '@agentos/types';
import { SwarmCoordinator } from '../src/swarm-coordinator.js';
import { SwarmMetricsCollector } from '../src/swarm-metrics.js';
import { MissionControl } from '../src/mission-control.js';
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
      llmBaseURL: 'http://localhost:8080',
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

// ═══════════════════════════════════════════════════════════════════════════
// SwarmCoordinator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('SwarmCoordinator', () => {
  it('should create a coordinator with default config', () => {
    const coordinator = new SwarmCoordinator();
    expect(coordinator).toBeDefined();
  });

  it('should create a coordinator with custom agent counts', () => {
    const coordinator = new SwarmCoordinator({
      chiefCount: 1,
      managerCount: 3,
      workerCount: 20,
      validatorCount: 5,
    });
    expect(coordinator).toBeDefined();
  });

  it('should run a small swarm simulation to completion', async () => {
    const coordinator = new SwarmCoordinator({
      chiefCount: 1,
      managerCount: 2,
      workerCount: 10,
      validatorCount: 3,
      randomSeed: 42,
    });

    const result = await coordinator.run({
      title: 'Test goal',
      description: 'Run a test simulation',
      priority: 3 as Priority,
    });

    expect(result).toBeDefined();
    expect(result.metrics).toBeDefined();
    expect(result.metrics.totalAgents).toBe(16); // 1 chief + 2 managers + 10 workers + 3 validators
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.verification).toBeDefined();
  });

  it('should have agents after running', async () => {
    const coordinator = new SwarmCoordinator({
      chiefCount: 1,
      managerCount: 2,
      workerCount: 5,
      validatorCount: 2,
      randomSeed: 123,
    });

    await coordinator.run({
      title: 'Agent test',
      description: 'Test agent creation',
      priority: 3 as Priority,
    });

    const allAgents = coordinator.getAllAgents();
    expect(allAgents.length).toBe(10); // 1+2+5+2
  });

  it('should produce verification results', async () => {
    const coordinator = new SwarmCoordinator({
      chiefCount: 1,
      managerCount: 2,
      workerCount: 10,
      validatorCount: 3,
      randomSeed: 42,
    });

    const result = await coordinator.run({
      title: 'Verification test',
      description: 'Test verification',
      priority: 3 as Priority,
    });

    expect(result.verification).toHaveProperty('allTasksTerminal');
    expect(result.verification).toHaveProperty('noResourceLeaks');
    expect(result.verification).toHaveProperty('conservationHolds');
    expect(result.verification).toHaveProperty('auditTrailComplete');
    expect(result.verification).toHaveProperty('claimsAtomic');
    expect(result.verification).toHaveProperty('allPassed');
  });

  it('should collect metrics during simulation', async () => {
    const coordinator = new SwarmCoordinator({
      chiefCount: 1,
      managerCount: 2,
      workerCount: 10,
      validatorCount: 3,
      randomSeed: 42,
    });

    const result = await coordinator.run({
      title: 'Metrics test',
      description: 'Test metrics collection',
      priority: 3 as Priority,
    });

    const metrics = result.metrics;
    expect(metrics.totalAgents).toBe(16);
    expect(metrics.messagesSent).toBeGreaterThan(0);
    expect(metrics.startTime).toBeGreaterThan(0);
    expect(metrics.endTime).toBeGreaterThanOrEqual(metrics.startTime);
  });

  it('should expose mission control events', async () => {
    const coordinator = new SwarmCoordinator({
      chiefCount: 1,
      managerCount: 1,
      workerCount: 5,
      validatorCount: 2,
      randomSeed: 42,
    });

    await coordinator.run({
      title: 'Events test',
      description: 'Test event tracking',
      priority: 3 as Priority,
    });

    const events = coordinator.getMissionControlEvents();
    expect(events.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SwarmMetrics Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('SwarmMetricsCollector', () => {
  let metrics: SwarmMetricsCollector;

  beforeEach(() => {
    metrics = new SwarmMetricsCollector();
  });

  it('should track task lifecycle', () => {
    const taskId = createUUID() as any;

    metrics.recordTaskCreated(taskId);
    metrics.recordTaskClaimed(taskId, createUUID() as any);
    metrics.recordTaskStarted(taskId);
    metrics.recordTaskCompleted(taskId);

    const result = metrics.compute();
    expect(result.totalTasks).toBe(1);
    expect(result.completedTasks).toBe(1);
    expect(result.completionRate).toBe(1);
  });

  it('should track failed tasks', () => {
    const taskId = createUUID() as any;

    metrics.recordTaskCreated(taskId);
    metrics.recordTaskClaimed(taskId, createUUID() as any);
    metrics.recordTaskFailed(taskId);

    const result = metrics.compute();
    expect(result.failedTasks).toBe(1);
    expect(result.completionRate).toBe(0);
  });

  it('should track cancelled tasks', () => {
    const taskId = createUUID() as any;

    metrics.recordTaskCreated(taskId);
    metrics.recordTaskCancelled(taskId);

    const result = metrics.compute();
    expect(result.cancelledTasks).toBe(1);
  });

  it('should track resource allocation and consumption', () => {
    metrics.recordAllocation({ ru: 1000, mu: 500, eu: 100, vu: 50 });
    metrics.recordConsumption({ ru: 800, mu: 400, eu: 80, vu: 30 });

    const result = metrics.compute();
    expect(result.ruAllocated).toBe(1000);
    expect(result.ruConsumed).toBe(800);
    expect(result.muAllocated).toBe(500);
    expect(result.muConsumed).toBe(400);
  });

  it('should calculate resource utilization', () => {
    metrics.recordAllocation({ ru: 1000, mu: 500, eu: 100, vu: 50 });
    metrics.recordConsumption({ ru: 500, mu: 250, eu: 50, vu: 25 });

    const result = metrics.compute();
    expect(result.resourceUtilization).toBeGreaterThan(0);
    expect(result.resourceUtilization).toBeLessThanOrEqual(1);
  });

  it('should track validation metrics', () => {
    metrics.recordValidationRequest();
    metrics.recordValidationResult(true);
    metrics.recordValidationRequest();
    metrics.recordValidationResult(false);

    const result = metrics.compute();
    expect(result.validationRequests).toBe(2);
    expect(result.validationApprovals).toBe(1);
    expect(result.validationRejections).toBe(1);
    expect(result.validationAccuracy).toBe(0.5);
  });

  it('should track deadlock and recovery', () => {
    metrics.recordDeadlock();
    metrics.recordDeadlock();
    metrics.recordDeadlockResolution();
    metrics.recordRecoveryAttempt(true);
    metrics.recordRecoveryAttempt(false);

    const result = metrics.compute();
    expect(result.deadlockCount).toBe(2);
    expect(result.recoverySuccessRate).toBe(0.5);
  });

  it('should track message throughput', () => {
    metrics.startTiming();
    for (let i = 0; i < 100; i++) {
      metrics.recordMessage();
    }
    metrics.stopTiming();

    const result = metrics.compute();
    expect(result.messagesSent).toBe(100);
  });

  it('should track agent states', () => {
    const agentId1 = createUUID() as any;
    const agentId2 = createUUID() as any;

    metrics.recordAgentState(agentId1, 'running');
    metrics.recordAgentState(agentId2, 'ready');

    const result = metrics.compute();
    expect(result.totalAgents).toBe(2);
    expect(result.activeAgents).toBe(1);
    expect(result.idleAgents).toBe(1);
  });

  it('should track workstream states', () => {
    metrics.recordWorkstreamState('ws-1', 'in_progress');
    metrics.recordWorkstreamState('ws-2', 'completed');
    metrics.recordWorkstreamState('ws-3', 'failed');

    const result = metrics.compute();
    expect(result.totalWorkstreams).toBe(3);
    expect(result.completedWorkstreams).toBe(1);
    expect(result.failedWorkstreams).toBe(1);
  });

  it('should track duplicate claims', () => {
    const taskId = createUUID() as any;
    metrics.recordTaskCreated(taskId);
    metrics.recordTaskClaimed(taskId, createUUID() as any);
    metrics.recordTaskClaimed(taskId, createUUID() as any);

    const result = metrics.compute();
    expect(result.taskDuplication).toBe(1);
  });

  it('should return empty metrics when nothing recorded', () => {
    const result = metrics.compute();
    expect(result.totalTasks).toBe(0);
    expect(result.totalAgents).toBe(0);
    expect(result.completionRate).toBe(0);
    expect(result.messagesSent).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// MissionControl Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('MissionControl', () => {
  let metrics: SwarmMetricsCollector;

  beforeEach(() => {
    metrics = new SwarmMetricsCollector();
    metrics.startTiming();
  });

  it('should render a formatted dashboard', () => {
    const missionControl = new MissionControl(metrics, []);

    metrics.recordAgentState(createUUID() as any, 'ready');
    metrics.recordAgentState(createUUID() as any, 'running');
    metrics.recordTaskCreated(createUUID() as any);
    metrics.recordMessage();
    metrics.stopTiming();

    const dashboard = missionControl.render();
    expect(dashboard).toContain('MISSION CONTROL');
    expect(dashboard).toContain('AGENTS');
    expect(dashboard).toContain('TASKS');
    expect(dashboard).toContain('RESOURCES');
  });

  it('should render a compact status line', () => {
    const missionControl = new MissionControl(metrics, []);
    metrics.recordAgentState(createUUID() as any, 'running');
    metrics.stopTiming();

    const compact = missionControl.renderCompact();
    expect(compact).toContain('Agents:');
    expect(compact).toContain('Tasks:');
  });

  it('should take a snapshot of current state', () => {
    const missionControl = new MissionControl(metrics, []);
    metrics.recordAgentState(createUUID() as any, 'ready');
    metrics.recordTaskCreated(createUUID() as any);
    metrics.stopTiming();

    const snapshot = missionControl.snapshot();
    expect(snapshot).toHaveProperty('agents');
    expect(snapshot).toHaveProperty('tasks');
    expect(snapshot).toHaveProperty('resources');
    expect(snapshot).toHaveProperty('messages');
    expect(snapshot).toHaveProperty('workflows');
    expect(snapshot).toHaveProperty('deadlocks');
    expect(snapshot).toHaveProperty('validation');
  });
});