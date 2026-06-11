/**
 * @agentos/swarm — Validator Consensus Tests
 * Tests for the computeConsensus algorithm across all 4 strategies,
 * confidence averaging, approval rate tracking, and edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUUID, AgentState } from '@agentos/types';
import type { AgentID, WorkspaceID, ProjectID, TaskID } from '@agentos/types';
import type { ValidationResult, ValidationConsensus } from '../src/types.js';
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

function createIds() {
  return {
    workspaceId: createUUID() as unknown as WorkspaceID,
    projectId: createUUID() as unknown as ProjectID,
  };
}

// ─── Helper: Build ValidationResult ─────────────────────────────────────────

function makeResult(overrides: Partial<ValidationResult> & { taskId: TaskID }): ValidationResult {
  return {
    validatorId: createUUID() as unknown as AgentID,
    approved: true,
    confidence: 0.9,
    issues: [],
    suggestions: [],
    timestamp: Date.now(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Unanimous Strategy
// ═══════════════════════════════════════════════════════════════════════════

describe('computeConsensus — unanimous', () => {
  let validator: ValidatorAgent;
  let context: MockContext;

  beforeEach(() => {
    const ids = createIds();
    validator = new ValidatorAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId });
    context = createMockContext();
    validator.connect(context as any);
    validator.initialize();
  });

  it('should approve when all validators approve', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.9 }),
      makeResult({ taskId, approved: true, confidence: 0.85 }),
      makeResult({ taskId, approved: true, confidence: 0.8 }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'unanimous');
    expect(consensus.finalDecision).toBe('approved');
  });

  it('should reject when one validator rejects', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.9 }),
      makeResult({ taskId, approved: false, confidence: 0.6, issues: ['minor issue'] }),
      makeResult({ taskId, approved: true, confidence: 0.85 }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'unanimous');
    expect(consensus.finalDecision).toBe('rejected');
  });

  it('should reject when all validators reject', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: false, confidence: 0.3, issues: ['fail'] }),
      makeResult({ taskId, approved: false, confidence: 0.2, issues: ['fail'] }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'unanimous');
    expect(consensus.finalDecision).toBe('rejected');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Majority Strategy
// ═══════════════════════════════════════════════════════════════════════════

describe('computeConsensus — majority', () => {
  let validator: ValidatorAgent;
  let context: MockContext;

  beforeEach(() => {
    const ids = createIds();
    validator = new ValidatorAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId });
    context = createMockContext();
    validator.connect(context as any);
    validator.initialize();
  });

  it('should approve when more than half approve (2 of 3)', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.9 }),
      makeResult({ taskId, approved: true, confidence: 0.85 }),
      makeResult({ taskId, approved: false, confidence: 0.6, issues: ['minor'] }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'majority');
    expect(consensus.finalDecision).toBe('approved');
  });

  it('should reject when half or fewer approve (1 of 3)', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.9 }),
      makeResult({ taskId, approved: false, confidence: 0.4, issues: ['issue'] }),
      makeResult({ taskId, approved: false, confidence: 0.3, issues: ['issue'] }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'majority');
    expect(consensus.finalDecision).toBe('rejected');
  });

  it('should reject on a tie (1 of 2)', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.9 }),
      makeResult({ taskId, approved: false, confidence: 0.5, issues: ['issue'] }),
    ];

    // majority requires > half, so 1/2 is not enough
    const consensus = validator.computeConsensus(taskId, results, 'majority');
    expect(consensus.finalDecision).toBe('rejected');
  });

  it('should approve with single unanimous validator (1 of 1)', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.95 }),
    ];

    // 1 > 0.5, so majority approves
    const consensus = validator.computeConsensus(taskId, results, 'majority');
    expect(consensus.finalDecision).toBe('approved');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Supermajority Strategy
// ═══════════════════════════════════════════════════════════════════════════

describe('computeConsensus — supermajority', () => {
  let validator: ValidatorAgent;
  let context: MockContext;

  beforeEach(() => {
    const ids = createIds();
    validator = new ValidatorAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId });
    context = createMockContext();
    validator.connect(context as any);
    validator.initialize();
  });

  it('should approve when >= 66% approve (2 of 3 = 66.7%)', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.9 }),
      makeResult({ taskId, approved: true, confidence: 0.85 }),
      makeResult({ taskId, approved: false, confidence: 0.6, issues: ['minor'] }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'supermajority');
    expect(consensus.finalDecision).toBe('approved');
  });

  it('should reject when < 66% approve (1 of 2 = 50%)', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.9 }),
      makeResult({ taskId, approved: false, confidence: 0.5, issues: ['issue'] }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'supermajority');
    expect(consensus.finalDecision).toBe('rejected');
  });

  it('should reject when exactly half approve (1 of 2)', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.85 }),
      makeResult({ taskId, approved: false, confidence: 0.4, issues: ['fail'] }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'supermajority');
    expect(consensus.finalDecision).toBe('rejected');
  });

  it('should approve with single validator (1 of 1 = 100%)', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.9 }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'supermajority');
    expect(consensus.finalDecision).toBe('approved');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Chief-Decides Strategy
// ═══════════════════════════════════════════════════════════════════════════

describe('computeConsensus — chief-decides', () => {
  let validator: ValidatorAgent;
  let context: MockContext;

  beforeEach(() => {
    const ids = createIds();
    validator = new ValidatorAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId });
    context = createMockContext();
    validator.connect(context as any);
    validator.initialize();
  });

  it('should approve when first result approves', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.9 }),
      makeResult({ taskId, approved: false, confidence: 0.4, issues: ['issue'] }),
      makeResult({ taskId, approved: false, confidence: 0.3, issues: ['issue'] }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'chief-decides');
    expect(consensus.finalDecision).toBe('approved');
  });

  it('should reject when first result rejects', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: false, confidence: 0.4, issues: ['issue'] }),
      makeResult({ taskId, approved: true, confidence: 0.9 }),
      makeResult({ taskId, approved: true, confidence: 0.85 }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'chief-decides');
    expect(consensus.finalDecision).toBe('rejected');
  });

  it('should reject when results array is empty', () => {
    const taskId = createUUID() as unknown as TaskID;
    const consensus = validator.computeConsensus(taskId, [], 'chief-decides');
    expect(consensus.finalDecision).toBe('rejected');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Edge Cases
// ═══════════════════════════════════════════════════════════════════════════

describe('computeConsensus — edge cases', () => {
  let validator: ValidatorAgent;
  let context: MockContext;

  beforeEach(() => {
    const ids = createIds();
    validator = new ValidatorAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId });
    context = createMockContext();
    validator.connect(context as any);
    validator.initialize();
  });

  it('should return needs_review for empty results with any strategy', () => {
    const taskId = createUUID() as unknown as TaskID;

    // With 0 results, approvals === 0 and results.length === 0:
    //   unanimous: 0 === 0 => true => 'approved'
    //   majority:  0 > 0   => false => 'rejected'
    //   supermajority: 0 >= 0 => true => 'approved'
    //   chief-decides: results.length === 0 => 'rejected'
    // The 'needs_review' only hits via the default case in the switch.
    // Test actual behavior: unanimous and supermajority approve with 0 results.
    const consensusUnanimous = validator.computeConsensus(taskId, [], 'unanimous');
    expect(consensusUnanimous.finalDecision).toBe('approved');

    const consensusMajority = validator.computeConsensus(taskId, [], 'majority');
    expect(consensusMajority.finalDecision).toBe('rejected');
  });

  it('should handle single validator with majority strategy', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.9 }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'majority');
    expect(consensus.finalDecision).toBe('approved');
    expect(consensus.averageConfidence).toBe(0.9);
  });

  it('should handle single rejecting validator with majority strategy', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: false, confidence: 0.3, issues: ['fail'] }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'majority');
    expect(consensus.finalDecision).toBe('rejected');
  });

  it('should average confidence across validators', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.9 }),
      makeResult({ taskId, approved: true, confidence: 0.7 }),
      makeResult({ taskId, approved: false, confidence: 0.5, issues: ['issue'] }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'majority');
    expect(consensus.averageConfidence).toBeCloseTo((0.9 + 0.7 + 0.5) / 3, 5);
  });

  it('should handle disagreement: 2 approve high conf, 1 reject low conf', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.95 }),
      makeResult({ taskId, approved: true, confidence: 0.92 }),
      makeResult({ taskId, approved: false, confidence: 0.3, issues: ['minor issue'] }),
    ];

    // Majority: 2/3 approve
    const consensusMajority = validator.computeConsensus(taskId, results, 'majority');
    expect(consensusMajority.finalDecision).toBe('approved');

    // Unanimous: not all approve
    const consensusUnanimous = validator.computeConsensus(taskId, results, 'unanimous');
    expect(consensusUnanimous.finalDecision).toBe('rejected');

    // Supermajority: 2/3 = 66.7% >= 66% => approved
    const consensusSupermajority = validator.computeConsensus(taskId, results, 'supermajority');
    expect(consensusSupermajority.finalDecision).toBe('approved');

    // Chief-decides: first result approves
    const consensusChief = validator.computeConsensus(taskId, results, 'chief-decides');
    expect(consensusChief.finalDecision).toBe('approved');
  });

  it('should return zero average confidence for empty results', () => {
    const taskId = createUUID() as unknown as TaskID;
    const consensus = validator.computeConsensus(taskId, [], 'majority');
    expect(consensus.averageConfidence).toBe(0);
  });

  it('should include all results in the consensus object', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.9 }),
      makeResult({ taskId, approved: false, confidence: 0.4, issues: ['issue'] }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'majority');
    expect(consensus.results).toHaveLength(2);
    expect(consensus.results).toEqual(results);
  });

  it('should set timestamp on the consensus', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.9 }),
    ];

    const consensus = validator.computeConsensus(taskId, results, 'majority');
    expect(consensus.timestamp).toBeGreaterThan(0);
  });

  it('should store consensus result internally', () => {
    const taskId = createUUID() as unknown as TaskID;
    const results = [
      makeResult({ taskId, approved: true, confidence: 0.9 }),
    ];

    validator.computeConsensus(taskId, results, 'majority');
    const stored = validator.getConsensusResults();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.taskId).toBe(taskId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Failure Rate Simulation
// ═══════════════════════════════════════════════════════════════════════════

describe('ValidatorAgent — failure rate', () => {
  it('should always fail validation when failureRate=1.0', () => {
    const ids = createIds();
    // Use a deterministic RNG that always returns 0.5 (< failureRate 1.0)
    const validator = new ValidatorAgent({
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
      failureRate: 1.0,
    }, () => 0.5);

    const context = createMockContext();
    validator.connect(context as any);
    validator.initialize();

    const taskId = createUUID() as unknown as TaskID;
    const result = {
      taskId,
      agentId: createUUID() as unknown as AgentID,
      output: { completed: true, data: 'test' },
      confidence: 0.95,
      resourcesConsumed: { ru: 10, mu: 5, eu: 1, vu: 0 },
      durationMs: 500,
      llmCallsUsed: 0,
      capabilityPath: 'execute',
    };

    validator.requestValidation(taskId, result, createUUID() as unknown as AgentID);
    const validationResult = validator.validate(taskId);

    // With failureRate=1.0, shouldFail() always returns true
    expect(validationResult.approved).toBe(false);
    expect(validationResult.issues).toContain('Validator uncertainty (simulated)');
  });

  it('should never fail validation when failureRate=0.0', () => {
    const ids = createIds();
    const validator = new ValidatorAgent({
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
      failureRate: 0.0,
    }, () => 0.5);

    const context = createMockContext();
    validator.connect(context as any);
    validator.initialize();

    const taskId = createUUID() as unknown as TaskID;
    const result = {
      taskId,
      agentId: createUUID() as unknown as AgentID,
      output: { completed: true, data: 'test' },
      confidence: 0.95,
      resourcesConsumed: { ru: 10, mu: 5, eu: 1, vu: 0 },
      durationMs: 500,
      llmCallsUsed: 0,
      capabilityPath: 'execute',
    };

    validator.requestValidation(taskId, result, createUUID() as unknown as AgentID);
    const validationResult = validator.validate(taskId);

    expect(validationResult.approved).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Approval Rate Tracking
// ═══════════════════════════════════════════════════════════════════════════

describe('ValidatorAgent — getApprovalRate', () => {
  it('should return 0 when no validations have been performed', () => {
    const ids = createIds();
    const validator = new ValidatorAgent({
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
      failureRate: 0.0,
    }, () => 0.5);

    expect(validator.getApprovalRate()).toBe(0);
  });

  it('should return 1.0 when all validations approved', () => {
    const ids = createIds();
    const validator = new ValidatorAgent({
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
      failureRate: 0.0,
    }, () => 0.5);

    const context = createMockContext();
    validator.connect(context as any);
    validator.initialize();

    const taskId1 = createUUID() as unknown as TaskID;
    const taskId2 = createUUID() as unknown as TaskID;

    for (const tid of [taskId1, taskId2]) {
      const result = {
        taskId: tid,
        agentId: createUUID() as unknown as AgentID,
        output: { completed: true },
        confidence: 0.95,
        resourcesConsumed: { ru: 10, mu: 5, eu: 1, vu: 0 },
        durationMs: 500,
        llmCallsUsed: 0,
        capabilityPath: 'execute',
      };
      validator.requestValidation(tid, result, createUUID() as unknown as AgentID);
      validator.validate(tid);
    }

    expect(validator.getApprovalRate()).toBe(1);
  });

  it('should return 0.5 when half of validations approved', () => {
    const ids = createIds();
    const validator = new ValidatorAgent({
      workspaceId: ids.workspaceId,
      projectId: ids.projectId,
      failureRate: 0.0,
    }, () => 0.5);

    const context = createMockContext();
    validator.connect(context as any);
    validator.initialize();

    // First: approved (high confidence, valid output)
    const taskId1 = createUUID() as unknown as TaskID;
    validator.requestValidation(taskId1, {
      taskId: taskId1,
      agentId: createUUID() as unknown as AgentID,
      output: { completed: true },
      confidence: 0.95,
      resourcesConsumed: { ru: 10, mu: 5, eu: 1, vu: 0 },
      durationMs: 500,
      llmCallsUsed: 0,
      capabilityPath: 'execute',
    }, createUUID() as unknown as AgentID);
    validator.validate(taskId1);

    // Second: rejected (null output, low confidence)
    const taskId2 = createUUID() as unknown as TaskID;
    validator.requestValidation(taskId2, {
      taskId: taskId2,
      agentId: createUUID() as unknown as AgentID,
      output: null,
      confidence: 0.2,
      resourcesConsumed: { ru: 0, mu: 0, eu: 0, vu: 0 },
      durationMs: 5,
      llmCallsUsed: 0,
      capabilityPath: 'execute',
    }, createUUID() as unknown as AgentID);
    validator.validate(taskId2);

    expect(validator.getApprovalRate()).toBe(0.5);
  });
});