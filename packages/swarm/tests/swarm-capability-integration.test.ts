/**
 * @agentos/swarm — Capability Executor Integration Tests
 * Validates the 3-tier execution priority in WorkerAgent:
 *   1. CapabilityExecutor (real execution) takes precedence
 *   2. LLMClient (live mode) is second
 *   3. Simulated execution is the fallback
 *
 * Tests that WorkerAgent can execute real capabilities through
 * the CapabilityExecutor and that the integration is backward-compatible.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUUID, AgentState, ZERO_BUDGET, ZERO_CONSUMPTION } from '@agentos/types';
import type {
  AgentID,
  TaskID,
  WorkspaceID,
  ProjectID,
  ResourceConsumption,
  CapabilityPath,
  ResolutionRequest,
  Outcome,
  InvocationResult,
} from '@agentos/types';
import { ok, err } from '@agentos/types';
import type { CapabilityExecutor } from '@agentos/capabilities';
import { WorkerAgent } from '../src/worker-agent.js';
import type { SwarmAgentContext } from '../src/swarm-agent.js';
import type { SwarmConfig } from '../src/types.js';
import { DEFAULT_SWARM_CONFIG } from '../src/types.js';

// ─── Mock CapabilityExecutor ──────────────────────────────────────────────

function createMockCapabilityExecutor(
  invokeResult?: Outcome<InvocationResult>,
): CapabilityExecutor {
  return {
    invoke: vi.fn().mockResolvedValue(
      invokeResult ?? ok({
        output: { text: 'capability executed' },
        duration_ms: 150,
        resources_consumed: { ru: 3, mu: 2, eu: 1, vu: 0 },
      }),
    ),
    getEvents: vi.fn().mockReturnValue([]),
    getConsumptionTracker: vi.fn().mockReturnValue({
      record: vi.fn(),
      getRecord: vi.fn().mockReturnValue(undefined),
      getRecords: vi.fn().mockReturnValue([]),
    }),
  } as any;
}

// ─── Mock Context ─────────────────────────────────────────────────────────

function createMockContext(overrides?: Partial<SwarmAgentContext>): SwarmAgentContext {
  return {
    eventBus: { publish: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() } as any,
    blackboard: {
      getAvailableTasks: vi.fn().mockReturnValue([]),
      claimTask: vi.fn().mockReturnValue({ ok: true }),
      releaseClaim: vi.fn().mockReturnValue({ ok: true }),
      submitResult: vi.fn().mockReturnValue({ ok: true }),
      validateResult: vi.fn().mockReturnValue({ ok: true }),
      getTask: vi.fn().mockReturnValue(null),
      publishTask: vi.fn(),
    } as any,
    scheduler: {
      requestAllocation: vi.fn().mockReturnValue({ ok: true, allocation: {} }),
      releaseAllocation: vi.fn(),
      reportConsumption: vi.fn(),
      getActiveAllocations: vi.fn().mockReturnValue([]),
    } as any,
    config: { ...DEFAULT_SWARM_CONFIG } as SwarmConfig,
    sendMessage: vi.fn(),
    onMessage: vi.fn(),
    currentTime: () => Date.now(),
    ...overrides,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function createIds() {
  return {
    workspaceId: createUUID() as unknown as WorkspaceID,
    projectId: createUUID() as unknown as ProjectID,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3-Tier Execution Priority
// ═══════════════════════════════════════════════════════════════════════════

describe('WorkerAgent — 3-Tier Execution Priority', () => {
  it('should use simulated execution when no capability executor and no LLM', () => {
    const ids = createIds();
    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);
    const context = createMockContext();
    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);

    const result = worker.executeSimulated(taskId, Date.now());
    expect(result.output).toHaveProperty('simulated', true);
  });

  it('should use capability executor when available and task has cap: tag', async () => {
    const ids = createIds();
    const mockExecutor = createMockCapabilityExecutor();
    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);

    // Provide a task with cap: tag
    const context = createMockContext({
      capabilityExecutor: mockExecutor,
      blackboard: {
        ...createMockContext().blackboard,
        getTask: vi.fn().mockReturnValue({
          id: 'test-task',
          tags: ['cap:actuate.shell.exec'],
          metadata: {},
        }),
        getAvailableTasks: vi.fn().mockReturnValue([]),
        claimTask: vi.fn().mockReturnValue({ ok: true }),
        submitResult: vi.fn().mockReturnValue({ ok: true }),
        validateResult: vi.fn().mockReturnValue({ ok: true }),
      } as any,
    });

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);
    worker.taskStartTimes.set(taskId, Date.now());

    const result = await worker.executeTask(taskId);

    expect(result).not.toBeNull();
    expect(result!.output).toHaveProperty('capabilityOutput');
    expect(mockExecutor.invoke).toHaveBeenCalledOnce();

    // Verify the resolution request includes the correct capability path
    const invokeCall = (mockExecutor.invoke as any).mock.calls[0]!;
    expect(invokeCall[0].capability_path).toBe('actuate.shell.exec');
  });

  it('should fall through to simulated when no cap: tag on task', async () => {
    const ids = createIds();
    const mockExecutor = createMockCapabilityExecutor();
    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);

    const context = createMockContext({
      capabilityExecutor: mockExecutor,
      blackboard: {
        ...createMockContext().blackboard,
        getTask: vi.fn().mockReturnValue({
          id: 'test-task',
          tags: [],  // No cap: tag
          metadata: {},
        }),
        getAvailableTasks: vi.fn().mockReturnValue([]),
        claimTask: vi.fn().mockReturnValue({ ok: true }),
        submitResult: vi.fn().mockReturnValue({ ok: true }),
        validateResult: vi.fn().mockReturnValue({ ok: true }),
      } as any,
    });

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);
    worker.taskStartTimes.set(taskId, Date.now());

    const result = await worker.executeTask(taskId);

    expect(result).not.toBeNull();
    // Falls through to simulated since no cap: tag
    expect(mockExecutor.invoke).not.toHaveBeenCalled();
  });

  it('should handle capability executor failure gracefully', async () => {
    const ids = createIds();
    const mockExecutor = createMockCapabilityExecutor(
      err('CG_E.PROVIDER_ERROR', 'Provider unavailable', { retryable: true }),
    );
    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);

    const context = createMockContext({
      capabilityExecutor: mockExecutor,
      blackboard: {
        ...createMockContext().blackboard,
        getTask: vi.fn().mockReturnValue({
          id: 'test-task',
          tags: ['cap:actuate.filesystem.read'],
          metadata: { path: '/test.txt' },
        }),
        getAvailableTasks: vi.fn().mockReturnValue([]),
        claimTask: vi.fn().mockReturnValue({ ok: true }),
        submitResult: vi.fn().mockReturnValue({ ok: true }),
        validateResult: vi.fn().mockReturnValue({ ok: true }),
      } as any,
    });

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);
    worker.taskStartTimes.set(taskId, Date.now());

    const result = await worker.executeTask(taskId);

    expect(result).not.toBeNull();
    expect(result!.output).toHaveProperty('error');
    expect((result!.output as any).error).toContain('Capability error');
  });

  it('should track resource consumption from capability executor', async () => {
    const ids = createIds();
    const consumed: ResourceConsumption = { ru: 5, mu: 3, eu: 2, vu: 0 };
    const mockExecutor = createMockCapabilityExecutor(
      ok({
        output: { text: 'executed' },
        duration_ms: 200,
        resources_consumed: consumed,
      }),
    );
    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);

    const context = createMockContext({
      capabilityExecutor: mockExecutor,
      blackboard: {
        ...createMockContext().blackboard,
        getTask: vi.fn().mockReturnValue({
          id: 'test-task',
          tags: ['cap:actuate.shell.exec'],
          metadata: {},
        }),
        getAvailableTasks: vi.fn().mockReturnValue([]),
        claimTask: vi.fn().mockReturnValue({ ok: true }),
        submitResult: vi.fn().mockReturnValue({ ok: true }),
        validateResult: vi.fn().mockReturnValue({ ok: true }),
      } as any,
    });

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);
    worker.taskStartTimes.set(taskId, Date.now());

    const result = await worker.executeTask(taskId);

    expect(result).not.toBeNull();
    expect(result!.resourcesConsumed).toEqual(consumed);
    // Also tracked on agent
    expect(worker.resourcesConsumed.ru).toBeGreaterThanOrEqual(consumed.ru);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// resolveCapabilityFromTask
// ═══════════════════════════════════════════════════════════════════════════

describe('WorkerAgent — resolveCapabilityFromTask', () => {
  it('should extract capability path from cap: tag', () => {
    const ids = createIds();
    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);

    const context = createMockContext({
      blackboard: {
        ...createMockContext().blackboard,
        getTask: vi.fn().mockReturnValue({
          id: 'task-1',
          tags: ['priority:high', 'cap:actuate.shell.exec', 'type:automation'],
          metadata: {},
        }),
      } as any,
    });

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    const result = worker.resolveCapabilityFromTask(taskId);
    expect(result).toBe('actuate.shell.exec');
  });

  it('should extract capability path from metadata.capability_path', () => {
    const ids = createIds();
    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);

    const context = createMockContext({
      blackboard: {
        ...createMockContext().blackboard,
        getTask: vi.fn().mockReturnValue({
          id: 'task-1',
          tags: [],
          metadata: { capability_path: 'communicate.http.get' },
        }),
      } as any,
    });

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    const result = worker.resolveCapabilityFromTask(taskId);
    expect(result).toBe('communicate.http.get');
  });

  it('should return null when no capability path found', () => {
    const ids = createIds();
    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);

    const context = createMockContext({
      blackboard: {
        ...createMockContext().blackboard,
        getTask: vi.fn().mockReturnValue({
          id: 'task-1',
          tags: ['priority:high'],
          metadata: {},
        }),
      } as any,
    });

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    const result = worker.resolveCapabilityFromTask(taskId);
    expect(result).toBeNull();
  });

  it('should return null when task not found', () => {
    const ids = createIds();
    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);

    const context = createMockContext({
      blackboard: {
        ...createMockContext().blackboard,
        getTask: vi.fn().mockReturnValue(null),
      } as any,
    });

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    const result = worker.resolveCapabilityFromTask(taskId);
    expect(result).toBeNull();
  });

  it('should return null when blackboard.getTask is not a function', () => {
    const ids = createIds();
    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);

    // Minimal mock without getTask (like older mock contexts)
    const context = createMockContext({
      blackboard: {
        getAvailableTasks: vi.fn().mockReturnValue([]),
        claimTask: vi.fn().mockReturnValue({ ok: true }),
        submitResult: vi.fn().mockReturnValue({ ok: true }),
        validateResult: vi.fn().mockReturnValue({ ok: true }),
      } as any,
    });

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    const result = worker.resolveCapabilityFromTask(taskId);
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// inferTaskInput
// ═══════════════════════════════════════════════════════════════════════════

describe('WorkerAgent — inferTaskInput', () => {
  it('should infer shell command input from capability path', async () => {
    const ids = createIds();
    let capturedInput: unknown;
    const mockExecutor = {
      invoke: vi.fn().mockImplementation(async (_req: any, input: any) => {
        capturedInput = input;
        return ok({
          output: { stdout: 'hello' },
          duration_ms: 50,
          resources_consumed: { ru: 1, mu: 1, eu: 1, vu: 0 },
        });
      }),
      getEvents: vi.fn().mockReturnValue([]),
      getConsumptionTracker: vi.fn().mockReturnValue({ record: vi.fn(), getRecords: vi.fn() }),
    } as any;

    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);
    const context = createMockContext({
      capabilityExecutor: mockExecutor,
      blackboard: {
        ...createMockContext().blackboard,
        getTask: vi.fn().mockReturnValue({
          id: 'task-1',
          tags: ['cap:actuate.shell.exec'],
          metadata: { command: 'git', args: ['status'] },
        }),
        getAvailableTasks: vi.fn().mockReturnValue([]),
        claimTask: vi.fn().mockReturnValue({ ok: true }),
        submitResult: vi.fn().mockReturnValue({ ok: true }),
        validateResult: vi.fn().mockReturnValue({ ok: true }),
      } as any,
    });

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);
    worker.taskStartTimes.set(taskId, Date.now());

    await worker.executeTask(taskId);

    expect(capturedInput).toEqual({ command: 'git', args: ['status'] });
  });

  it('should infer filesystem input from metadata', async () => {
    const ids = createIds();
    let capturedInput: unknown;
    const mockExecutor = {
      invoke: vi.fn().mockImplementation(async (_req: any, input: any) => {
        capturedInput = input;
        return ok({
          output: { content: 'file data' },
          duration_ms: 30,
          resources_consumed: { ru: 1, mu: 1, eu: 1, vu: 0 },
        });
      }),
      getEvents: vi.fn().mockReturnValue([]),
      getConsumptionTracker: vi.fn().mockReturnValue({ record: vi.fn(), getRecords: vi.fn() }),
    } as any;

    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);
    const context = createMockContext({
      capabilityExecutor: mockExecutor,
      blackboard: {
        ...createMockContext().blackboard,
        getTask: vi.fn().mockReturnValue({
          id: 'task-1',
          tags: ['cap:actuate.filesystem.read'],
          metadata: { capability_input: { path: '/etc/config.yaml' } },
        }),
        getAvailableTasks: vi.fn().mockReturnValue([]),
        claimTask: vi.fn().mockReturnValue({ ok: true }),
        submitResult: vi.fn().mockReturnValue({ ok: true }),
        validateResult: vi.fn().mockReturnValue({ ok: true }),
      } as any,
    });

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);
    worker.taskStartTimes.set(taskId, Date.now());

    await worker.executeTask(taskId);

    // capability_input takes precedence
    expect(capturedInput).toEqual({ path: '/etc/config.yaml' });
  });

  it('should provide default shell input when no metadata', async () => {
    const ids = createIds();
    let capturedInput: unknown;
    const mockExecutor = {
      invoke: vi.fn().mockImplementation(async (_req: any, input: any) => {
        capturedInput = input;
        return ok({
          output: { stdout: '' },
          duration_ms: 10,
          resources_consumed: { ru: 1, mu: 1, eu: 1, vu: 0 },
        });
      }),
      getEvents: vi.fn().mockReturnValue([]),
      getConsumptionTracker: vi.fn().mockReturnValue({ record: vi.fn(), getRecords: vi.fn() }),
    } as any;

    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);
    const context = createMockContext({
      capabilityExecutor: mockExecutor,
      blackboard: {
        ...createMockContext().blackboard,
        getTask: vi.fn().mockReturnValue({
          id: 'task-1',
          tags: ['cap:actuate.shell.exec'],
          metadata: {},
        }),
        getAvailableTasks: vi.fn().mockReturnValue([]),
        claimTask: vi.fn().mockReturnValue({ ok: true }),
        submitResult: vi.fn().mockReturnValue({ ok: true }),
        validateResult: vi.fn().mockReturnValue({ ok: true }),
      } as any,
    });

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);
    worker.taskStartTimes.set(taskId, Date.now());

    await worker.executeTask(taskId);

    // Default shell input
    expect(capturedInput).toEqual({ command: 'echo', args: ['hello'] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Backward Compatibility
// ═══════════════════════════════════════════════════════════════════════════

describe('WorkerAgent — Backward Compatibility', () => {
  it('should work without capabilityExecutor in context', async () => {
    const ids = createIds();
    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);

    // Context without capabilityExecutor
    const context = createMockContext();
    delete (context as any).capabilityExecutor;

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);
    worker.taskStartTimes.set(taskId, Date.now());

    // Should fall through to simulated
    const result = await worker.executeTask(taskId);
    expect(result).not.toBeNull();
    expect(result!.output).toHaveProperty('simulated', true);
  });

  it('should preserve LLM integration when no capability executor', async () => {
    const ids = createIds();
    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);

    const mockLLMClient = {
      complete: vi.fn().mockResolvedValue({
        content: 'LLM output',
        model: 'test-model',
        resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 },
      }),
      getTokenTracker: vi.fn(),
      getCapabilityRouter: vi.fn(),
      getTotalConsumption: vi.fn(),
      reset: vi.fn(),
    };
    worker.setLLMClient(mockLLMClient as any);

    const context = createMockContext({
      config: { ...DEFAULT_SWARM_CONFIG, llmMode: 'live' },
    });

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);
    worker.taskStartTimes.set(taskId, Date.now());

    // No cap: tag → no capability executor call → LLM used
    const result = await worker.executeTask(taskId);
    expect(result).not.toBeNull();
    expect(mockLLMClient.complete).toHaveBeenCalled();
  });

  it('should prefer capability executor over LLM when both available', async () => {
    const ids = createIds();
    const mockExecutor = createMockCapabilityExecutor();
    const worker = new WorkerAgent({ workspaceId: ids.workspaceId, projectId: ids.projectId, failureRate: 0 }, () => 0.5);

    const mockLLMClient = {
      complete: vi.fn().mockResolvedValue({
        content: 'LLM output',
        model: 'test-model',
        resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 },
      }),
      getTokenTracker: vi.fn(),
      getCapabilityRouter: vi.fn(),
      getTotalConsumption: vi.fn(),
      reset: vi.fn(),
    };
    worker.setLLMClient(mockLLMClient as any);

    // Both capabilityExecutor and LLM available, but task has cap: tag
    const context = createMockContext({
      capabilityExecutor: mockExecutor,
      config: { ...DEFAULT_SWARM_CONFIG, llmMode: 'live' },
      blackboard: {
        ...createMockContext().blackboard,
        getTask: vi.fn().mockReturnValue({
          id: 'task-1',
          tags: ['cap:reason.model.complete'],
          metadata: {},
        }),
        getAvailableTasks: vi.fn().mockReturnValue([]),
        claimTask: vi.fn().mockReturnValue({ ok: true }),
        submitResult: vi.fn().mockReturnValue({ ok: true }),
        validateResult: vi.fn().mockReturnValue({ ok: true }),
      } as any,
    });

    worker.connect(context);
    worker.initialize();

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);
    worker.taskStartTimes.set(taskId, Date.now());

    const result = await worker.executeTask(taskId);

    expect(result).not.toBeNull();
    // Capability executor should be called, NOT LLM
    expect(mockExecutor.invoke).toHaveBeenCalledOnce();
    expect(mockLLMClient.complete).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// SwarmCoordinator Integration
// ═══════════════════════════════════════════════════════════════════════════

describe('SwarmCoordinator — Capability Executor Integration', () => {
  it('should pass capabilityExecutor to agent context', async () => {
    const { SwarmCoordinator } = await import('../src/swarm-coordinator.js');
    const mockExecutor = createMockCapabilityExecutor();

    const coordinator = new SwarmCoordinator({
      chiefCount: 1,
      managerCount: 1,
      workerCount: 3,
      validatorCount: 1,
      workspaceCount: 1,
      randomSeed: 42,
      capabilityExecutor: mockExecutor as any,
    });

    // Run a simple simulation — the executor won't be called because
    // simulation tasks don't have cap: tags, but it should not error
    const result = await coordinator.run({
      title: 'Capability integration test',
      description: 'Test that capabilityExecutor is wired through',
      priority: 3 as any,
    });

    // The run should succeed
    expect(result.success).toBe(true);
  });

  it('should work without capabilityExecutor (backward compat)', async () => {
    const { SwarmCoordinator } = await import('../src/swarm-coordinator.js');

    const coordinator = new SwarmCoordinator({
      chiefCount: 1,
      managerCount: 1,
      workerCount: 3,
      validatorCount: 1,
      workspaceCount: 1,
      randomSeed: 42,
    });

    const result = await coordinator.run({
      title: 'Backward compat test',
      description: 'Test without capabilityExecutor',
      priority: 3 as any,
    });

    expect(result.success).toBe(true);
  });
});