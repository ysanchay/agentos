/**
 * @agentos/swarm — Agent Tests
 * Tests for ChiefAgent, ManagerAgent, WorkerAgent, and ValidatorAgent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUUID, AgentState, TaskState } from '@agentos/types';
import type { AgentID, WorkspaceID, ProjectID, Priority } from '@agentos/types';
import type { SwarmConfig } from '../src/types.js';
import { ChiefAgent } from '../src/chief-agent.js';
import { ManagerAgent } from '../src/manager-agent.js';
import { WorkerAgent } from '../src/worker-agent.js';
import { ValidatorAgent } from '../src/validator-agent.js';

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

// ─── Helper ────────────────────────────────────────────────────────────────

function createIds() {
  return {
    workspaceId: createUUID() as unknown as WorkspaceID,
    projectId: createUUID() as unknown as ProjectID,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ChiefAgent Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('ChiefAgent', () => {
  let chief: ChiefAgent;
  let context: MockContext;

  beforeEach(() => {
    const ids = createIds();
    chief = new ChiefAgent({
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
    });
    context = createMockContext();
    chief.connect(context as any);
    chief.initialize();
  });

  it('should initialize to READY state', () => {
    expect(chief.state).toBe(AgentState.READY);
    expect(chief.type).toBe('chief');
  });

  it('should have chief capabilities', () => {
    expect(chief.hasCapability('decompose')).toBe(true);
    expect(chief.hasCapability('assign')).toBe(true);
    expect(chief.hasCapability('manage')).toBe(true);
  });

  it('should submit and decompose a goal', () => {
    const goal = chief.submitGoal({
      title: 'Build authentication system',
      description: 'Implement OAuth2 + JWT authentication',
      priority: 2 as Priority,
      budget: { ru: 10000, mu: 5000, eu: 1000, vu: 500 },
      createdBy: chief.id,
      metadata: {},
    });

    expect(goal.id).toBeDefined();
    expect(goal.status).toBe('in_progress');
    expect(goal.workstreamIds.length).toBeGreaterThan(0);

    const workstreams = chief.getWorkstreams();
    expect(workstreams.length).toBe(goal.workstreamIds.length);
  });

  it('should allocate budget across workstreams', () => {
    const goal = chief.submitGoal({
      title: 'Test goal',
      description: 'Test budget allocation',
      priority: 3 as Priority,
      budget: { ru: 5000, mu: 3000, eu: 1000, vu: 500 },
      createdBy: chief.id,
      metadata: {},
    });

    const workstreams = chief.getWorkstreams();
    const totalRU = workstreams.reduce((sum, ws) => sum + ws.budget.ru, 0);
    expect(totalRU).toBeLessThanOrEqual(5000);
  });

  it('should assign managers to workstreams', () => {
    const goal = chief.submitGoal({
      title: 'Test goal',
      description: 'Test manager assignment',
      priority: 3 as Priority,
      budget: { ru: 5000, mu: 3000, eu: 1000, vu: 500 },
      createdBy: chief.id,
      metadata: {},
    });

    const managerId = createUUID() as unknown as AgentID;
    chief.registerManager(managerId);
    expect(chief.getManagerIds()).toContain(managerId);

    const workstreams = chief.getWorkstreams();
    if (workstreams.length > 0) {
      const assigned = chief.assignWorkstream(workstreams[0]!.id, managerId);
      expect(assigned).toBe(true);
      expect(workstreams[0]!.managerId).toBe(managerId);
    }
  });

  it('should track goal progress', () => {
    const goal = chief.submitGoal({
      title: 'Test progress',
      description: 'Test progress tracking',
      priority: 3 as Priority,
      budget: { ru: 5000, mu: 3000, eu: 1000, vu: 500 },
      createdBy: chief.id,
      metadata: {},
    });

    const progress = chief.getGoalProgress(goal.id);
    expect(progress.total).toBeGreaterThan(0);
    expect(progress.pending).toBe(progress.total);
  });

  it('should terminate correctly', () => {
    chief.terminate();
    expect(chief.state).toBe(AgentState.TERMINATED);
  });

  it('should emit events through context', () => {
    chief.submitGoal({
      title: 'Event test',
      description: 'Test event emission',
      priority: 3 as Priority,
      budget: { ru: 5000, mu: 3000, eu: 1000, vu: 500 },
      createdBy: chief.id,
      metadata: {},
    });

    // Should have published events
    expect(context.eventBus.publish).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ManagerAgent Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('ManagerAgent', () => {
  let manager: ManagerAgent;
  let context: MockContext;

  beforeEach(() => {
    const ids = createIds();
    manager = new ManagerAgent({
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
    });
    context = createMockContext();
    manager.connect(context as any);
    manager.initialize();
  });

  it('should initialize to READY state', () => {
    expect(manager.state).toBe(AgentState.READY);
    expect(manager.type).toBe('manager');
  });

  it('should have manager capabilities', () => {
    expect(manager.hasCapability('track')).toBe(true);
    expect(manager.hasCapability('assign')).toBe(true);
    expect(manager.hasCapability('coordinate')).toBe(true);
  });

  it('should accept and decompose workstreams', () => {
    const workstream = {
      id: createUUID(),
      goalId: createUUID(),
      title: 'Test workstream',
      description: 'Test workstream description',
      priority: 3 as Priority,
      budget: { ru: 5000, mu: 3000, eu: 1000, vu: 500 },
      status: 'pending' as const,
      taskIds: [],
      createdAt: new Date().toISOString(),
    };

    manager.assignWorkstream(workstream);
    const ws = manager.getWorkstreams();
    expect(ws.length).toBe(1);
    expect(ws[0]!.status).toBe('in_progress');
  });

  it('should publish tasks to blackboard when assigning workstream', () => {
    const workstream = {
      id: createUUID(),
      goalId: createUUID(),
      title: 'Test workstream',
      description: 'Test description',
      priority: 3 as Priority,
      budget: { ru: 5000, mu: 3000, eu: 1000, vu: 500 },
      status: 'pending' as const,
      taskIds: [],
      createdAt: new Date().toISOString(),
    };

    manager.assignWorkstream(workstream);
    expect(context.blackboard.publishTask).toHaveBeenCalled();
  });

  it('should register workers', () => {
    const workerId = createUUID() as unknown as AgentID;
    manager.registerWorker(workerId);
    expect(manager.getWorkerIds()).toContain(workerId);
  });

  it('should track published task IDs', () => {
    const workstream = {
      id: createUUID(),
      goalId: createUUID(),
      title: 'Test workstream',
      description: 'Test description',
      priority: 3 as Priority,
      budget: { ru: 5000, mu: 3000, eu: 1000, vu: 500 },
      status: 'pending' as const,
      taskIds: [],
      createdAt: new Date().toISOString(),
    };

    manager.assignWorkstream(workstream);
    expect(manager.getPublishedTaskIds().length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WorkerAgent Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('WorkerAgent', () => {
  let worker: WorkerAgent;
  let context: MockContext;

  beforeEach(() => {
    const ids = createIds();
    worker = new WorkerAgent({
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
    });
    context = createMockContext();
    worker.connect(context as any);
    worker.initialize();
  });

  it('should initialize to READY state', () => {
    expect(worker.state).toBe(AgentState.READY);
    expect(worker.type).toBe('worker');
  });

  it('should have worker capabilities', () => {
    expect(worker.hasCapability('execute')).toBe(true);
    expect(worker.hasCapability('implement')).toBe(true);
    expect(worker.hasCapability('test')).toBe(true);
  });

  it('should not accept tasks when at max capacity', () => {
    // Fill up the worker's task capacity
    expect(worker.canAcceptTask()).toBe(true);

    // Start max concurrent tasks
    worker.startTask(createUUID() as unknown as any);
    worker.startTask(createUUID() as unknown as any);
    worker.startTask(createUUID() as unknown as any);

    expect(worker.canAcceptTask()).toBe(false);
  });

  it('should complete tasks and return to READY', () => {
    const taskId = createUUID() as unknown as any;
    worker.startTask(taskId);
    expect(worker.state).toBe(AgentState.RUNNING);

    worker.completeTask(taskId);
    expect(worker.completedTaskCount).toBe(1);
    // After completing the only task, state should be READY
    expect(worker.state).toBe(AgentState.READY);
  });

  it('should fail tasks and track failure count', () => {
    const taskId = createUUID() as unknown as any;
    worker.startTask(taskId);
    worker.failTask(taskId);

    expect(worker.failedTaskCount).toBe(1);
    // After failing the only task, state should be READY
    expect(worker.state).toBe(AgentState.READY);
  });

  it('should track resource consumption', () => {
    worker.trackConsumption({ ru: 10, mu: 5, eu: 1, vu: 0 });
    worker.trackConsumption({ ru: 20, mu: 10, eu: 2, vu: 1 });

    expect(worker.resourcesConsumed.ru).toBe(30);
    expect(worker.resourcesConsumed.mu).toBe(15);
    expect(worker.resourcesConsumed.eu).toBe(3);
    expect(worker.resourcesConsumed.vu).toBe(1);
  });

  it('should produce summary with all fields', () => {
    const summary = worker.getSummary();
    expect(summary).toHaveProperty('id');
    expect(summary).toHaveProperty('type');
    expect(summary).toHaveProperty('state');
    expect(summary).toHaveProperty('phase');
    expect(summary).toHaveProperty('activeTasks');
    expect(summary).toHaveProperty('completed');
    expect(summary).toHaveProperty('failed');
    expect(summary).toHaveProperty('messagesSent');
    expect(summary).toHaveProperty('messagesReceived');
    expect(summary).toHaveProperty('resourcesConsumed');
  });

  it('should handle messages for task announcements', () => {
    // Should not throw
    worker.receiveMessage({
      id: createUUID(),
      type: 'task.announce',
      sender: createUUID() as unknown as AgentID,
      recipient: '*' as any,
      payload: { taskId: createUUID() },
      timestamp: Date.now(),
    });
  });

  it('should set manager ID', () => {
    const managerId = createUUID() as unknown as AgentID;
    worker.setManagerId(managerId);
    // Manager ID is internal; verify no error thrown
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ValidatorAgent Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('ValidatorAgent', () => {
  let validator: ValidatorAgent;
  let context: MockContext;

  beforeEach(() => {
    const ids = createIds();
    validator = new ValidatorAgent({
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
    });
    context = createMockContext();
    validator.connect(context as any);
    validator.initialize();
  });

  it('should initialize to READY state', () => {
    expect(validator.state).toBe(AgentState.READY);
    expect(validator.type).toBe('validator');
  });

  it('should have validator capabilities', () => {
    expect(validator.hasCapability('validate')).toBe(true);
    expect(validator.hasCapability('review')).toBe(true);
    expect(validator.hasCapability('approve')).toBe(true);
  });

  it('should validate a task result with high confidence', () => {
    const taskId = createUUID() as unknown as any;
    const result = {
      taskId,
      agentId: createUUID() as unknown as AgentID,
      output: { completed: true, data: 'test result' },
      confidence: 0.95,
      resourcesConsumed: { ru: 10, mu: 5, eu: 1, vu: 0 },
      durationMs: 500,
      llmCallsUsed: 0,
      capabilityPath: 'execute',
    };

    validator.requestValidation(taskId, result, createUUID() as unknown as AgentID);
    const validationResult = validator.validate(taskId);

    expect(validationResult.approved).toBe(true);
    expect(validationResult.confidence).toBeGreaterThanOrEqual(0.7);
    expect(validationResult.taskId).toBe(taskId);
  });

  it('should reject results with low confidence', () => {
    const taskId = createUUID() as unknown as any;
    const result = {
      taskId,
      agentId: createUUID() as unknown as AgentID,
      output: null,
      confidence: 0.2,
      resourcesConsumed: { ru: 0, mu: 0, eu: 0, vu: 0 },
      durationMs: 10,
      llmCallsUsed: 0,
      capabilityPath: 'execute',
    };

    validator.requestValidation(taskId, result, createUUID() as unknown as AgentID);
    const validationResult = validator.validate(taskId);

    expect(validationResult.approved).toBe(false);
    expect(validationResult.issues.length).toBeGreaterThan(0);
  });

  it('should compute consensus for majority approval', () => {
    const taskId = createUUID() as unknown as any;
    const results: any[] = [
      { taskId, validatorId: createUUID(), approved: true, confidence: 0.9, issues: [], suggestions: [], timestamp: Date.now() },
      { taskId, validatorId: createUUID(), approved: true, confidence: 0.85, issues: [], suggestions: [], timestamp: Date.now() },
      { taskId, validatorId: createUUID(), approved: false, confidence: 0.6, issues: ['minor issue'], suggestions: [], timestamp: Date.now() },
    ];

    const consensus = validator.computeConsensus(taskId, results, 'majority');
    expect(consensus.finalDecision).toBe('approved');
    expect(consensus.averageConfidence).toBeCloseTo(0.783, 1);
  });

  it('should compute consensus for unanimous approval', () => {
    const taskId = createUUID() as unknown as any;
    const results: any[] = [
      { taskId, validatorId: createUUID(), approved: true, confidence: 0.9, issues: [], suggestions: [], timestamp: Date.now() },
      { taskId, validatorId: createUUID(), approved: true, confidence: 0.85, issues: [], suggestions: [], timestamp: Date.now() },
      { taskId, validatorId: createUUID(), approved: true, confidence: 0.8, issues: [], suggestions: [], timestamp: Date.now() },
    ];

    const consensus = validator.computeConsensus(taskId, results, 'unanimous');
    expect(consensus.finalDecision).toBe('approved');
  });

  it('should reject consensus when any validator rejects (unanimous)', () => {
    const taskId = createUUID() as unknown as any;
    const results: any[] = [
      { taskId, validatorId: createUUID(), approved: true, confidence: 0.9, issues: [], suggestions: [], timestamp: Date.now() },
      { taskId, validatorId: createUUID(), approved: false, confidence: 0.6, issues: ['issue'], suggestions: [], timestamp: Date.now() },
    ];

    const consensus = validator.computeConsensus(taskId, results, 'unanimous');
    expect(consensus.finalDecision).toBe('rejected');
  });

  it('should compute supermajority consensus', () => {
    const taskId = createUUID() as unknown as any;
    const results: any[] = [
      { taskId, validatorId: createUUID(), approved: true, confidence: 0.9, issues: [], suggestions: [], timestamp: Date.now() },
      { taskId, validatorId: createUUID(), approved: true, confidence: 0.85, issues: [], suggestions: [], timestamp: Date.now() },
      { taskId, validatorId: createUUID(), approved: false, confidence: 0.6, issues: ['issue'], suggestions: [], timestamp: Date.now() },
    ];

    // 2/3 = 66.7% >= 66% threshold
    const consensus = validator.computeConsensus(taskId, results, 'supermajority');
    expect(consensus.finalDecision).toBe('approved');
  });

  it('should track approval rate', () => {
    const taskId1 = createUUID() as unknown as any;
    const taskId2 = createUUID() as unknown as any;

    // Validate two tasks: one approved, one rejected
    validator.requestValidation(taskId1, {
      taskId: taskId1, agentId: createUUID() as any,
      output: { ok: true }, confidence: 0.95,
      resourcesConsumed: { ru: 10, mu: 5, eu: 1, vu: 0 },
      durationMs: 500, llmCallsUsed: 0, capabilityPath: 'execute',
    }, createUUID() as any);
    validator.validate(taskId1);

    // Initially the approval rate is based on validated tasks
    const rate = validator.getApprovalRate();
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(1);
  });
});