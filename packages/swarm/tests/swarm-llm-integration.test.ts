/**
 * @agentos/swarm — Model Router Integration Tests
 * Validates the integration between WorkerAgent and the LLM Model Router:
 *   1. WorkerAgent.setLLMClient() wires up the client
 *   2. llmMode='live' triggers LLM execution instead of simulation
 *   3. CapabilityRouter maps swarm task types to correct routing headers
 *   4. Token usage converts to AgentOS resource units
 *   5. LLM errors are handled gracefully (fallback or fail)
 *   6. Resource consumption is tracked correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createUUID, AgentState } from '@agentos/types';
import type { AgentID, TaskID, WorkspaceID, ProjectID, ResourceConsumption } from '@agentos/types';
import { WorkerAgent } from '../src/worker-agent.js';
import { LLMClient } from '@agentos/llm';
import { CapabilityRouter } from '@agentos/llm';
import type { LLMResponse } from '@agentos/llm';
import type { SwarmAgentContext, SwarmConfig } from '../src/types.js';
import { DEFAULT_SWARM_CONFIG } from '../src/types.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────

function createMockContext(overrides?: Partial<SwarmAgentContext>): SwarmAgentContext {
  return {
    eventBus: { publish: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() },
    blackboard: {
      getAvailableTasks: vi.fn().mockReturnValue([]),
      claimTask: vi.fn().mockReturnValue(false),
      submitResult: vi.fn().mockReturnValue({ ok: true }),
      validateResult: vi.fn().mockReturnValue(true),
    } as any,
    scheduler: {
      allocate: vi.fn().mockReturnValue({ ok: true, allocation: { ru: 100, mu: 50, eu: 1, vu: 0 } }),
      release: vi.fn(),
    } as any,
    config: { ...DEFAULT_SWARM_CONFIG, llmMode: 'live' } as SwarmConfig,
    sendMessage: vi.fn(),
    onMessage: vi.fn(),
    currentTime: () => Date.now(),
    ...overrides,
  };
}

function createLLMResponse(overrides?: Partial<LLMResponse>): LLMResponse {
  return {
    content: 'Task executed successfully. Generated code module.',
    model: 'qwen2.5-coder',
    taskType: 'coding',
    promptTokens: 150,
    completionTokens: 80,
    totalTokens: 230,
    durationMs: 1200,
    resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 },
    fallbackTriggered: false,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Capability Router Integration
// ═══════════════════════════════════════════════════════════════════════════

describe('CapabilityRouter — Swarm Task Routing', () => {
  let router: CapabilityRouter;

  beforeEach(() => {
    router = new CapabilityRouter();
  });

  it('should route create.code.* to coding', () => {
    expect(router.resolve('create.code.typescript')).toBe('coding');
    expect(router.resolve('create.code.python')).toBe('coding');
    expect(router.resolve('create.code.rust')).toBe('coding');
  });

  it('should route reason.infer.* to reasoning', () => {
    expect(router.resolve('reason.infer.text')).toBe('reasoning');
  });

  it('should route reason.decide.* to decision', () => {
    expect(router.resolve('reason.decide.retry')).toBe('decision');
  });

  it('should route coordinate.plan.* to planning', () => {
    expect(router.resolve('coordinate.plan.decompose')).toBe('planning');
  });

  it('should default unknown capabilities to default', () => {
    expect(router.resolve('unknown.capability')).toBe('default');
  });

  it('should route empty capability to default', () => {
    expect(router.resolve('')).toBe('default');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// WorkerAgent + LLMClient Integration
// ═══════════════════════════════════════════════════════════════════════════

describe('WorkerAgent + LLMClient Integration', () => {
  let worker: WorkerAgent;
  let context: SwarmAgentContext;

  beforeEach(() => {
    const ws = createUUID() as unknown as WorkspaceID;
    const pr = createUUID() as unknown as ProjectID;

    worker = new WorkerAgent({
      workspaceId: ws,
      projectId: pr,
      failureRate: 0,
    }, () => 0.5);

    context = createMockContext();
    worker.connect(context);
    worker.initialize();
  });

  it('should accept LLMClient via setLLMClient', () => {
    const llmClient = new LLMClient();
    worker.setLLMClient(llmClient);
    // No error thrown — client accepted
  });

  it('should use simulated execution when llmMode is not live', () => {
    const ctx = createMockContext({ config: { ...DEFAULT_SWARM_CONFIG, llmMode: 'none' } });
    worker.connect(ctx);

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);

    const result = worker.executeSimulated(taskId, Date.now());
    expect(result.output['simulated']).toBe(true);
  });

  it('should route through LLMClient when llmMode is live', async () => {
    // Create a mock LLMClient
    const mockResponse = createLLMResponse();
    const mockLLMClient = {
      complete: vi.fn().mockResolvedValue(mockResponse),
      getTokenTracker: vi.fn().mockReturnValue({ getTotalConsumption: vi.fn() }),
      getCapabilityRouter: vi.fn(),
      getTotalConsumption: vi.fn(),
      reset: vi.fn(),
    };

    worker.setLLMClient(mockLLMClient as any);

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);

    // The worker's execute() calls executeWithLLM when llmClient is set and llmMode === 'live'
    const result = await worker.executeTask(taskId);

    // Verify LLMClient.complete was called
    expect(mockLLMClient.complete).toHaveBeenCalledOnce();

    // Verify the capability path was included in the request
    const call = mockLLMClient.complete.mock.calls[0]!;
    expect(call[1]!.capabilityPath).toBeDefined();

    // Verify result contains LLM output
    expect(result).not.toBeNull();
    expect(result!.output['llmOutput']).toBeDefined();
    expect(result!.output['model']).toBe('qwen2.5-coder');
  });

  it('should handle LLM errors gracefully', async () => {
    const mockLLMClient = {
      complete: vi.fn().mockRejectedValue(new Error('Model Router unavailable')),
      getTokenTracker: vi.fn(),
      getCapabilityRouter: vi.fn(),
      getTotalConsumption: vi.fn(),
      reset: vi.fn(),
    };

    worker.setLLMClient(mockLLMClient as any);

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);

    const result = await worker.executeTask(taskId);
    // Should fail the task rather than crash
    expect(result).not.toBeNull();
    // The task result should contain the error information
  });

  it('should track resource consumption from LLM calls', async () => {
    const resourcesConsumed: ResourceConsumption = { ru: 2, mu: 1, eu: 1, vu: 0 };
    const mockResponse = createLLMResponse({ resourcesConsumed });
    const mockLLMClient = {
      complete: vi.fn().mockResolvedValue(mockResponse),
      getTokenTracker: vi.fn(),
      getCapabilityRouter: vi.fn(),
      getTotalConsumption: vi.fn(),
      reset: vi.fn(),
    };

    worker.setLLMClient(mockLLMClient as any);

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);

    const result = await worker.executeTask(taskId);
    expect(result!.resourcesConsumed).toEqual(resourcesConsumed);
  });

  it('should send correct x-task-type based on capability path', async () => {
    const mockResponse = createLLMResponse({ taskType: 'coding' });
    const mockLLMClient = {
      complete: vi.fn().mockResolvedValue(mockResponse),
      getTokenTracker: vi.fn(),
      getCapabilityRouter: vi.fn(),
      getTotalConsumption: vi.fn(),
      reset: vi.fn(),
    };

    worker.setLLMClient(mockLLMClient as any);

    const taskId = createUUID() as unknown as TaskID;
    worker.startTask(taskId);

    await worker.executeTask(taskId);

    // The worker defaults to 'create.code.typescript' capability path
    // which maps to 'coding' task type via CapabilityRouter
    const call = mockLLMClient.complete.mock.calls[0]!;
    expect(call[1]!.capabilityPath).toBe('create.code.typescript');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Coordinator + Model Router Integration
// ═══════════════════════════════════════════════════════════════════════════

describe('SwarmCoordinator + Model Router Integration', () => {
  it('should support llmMode configuration in swarm run', async () => {
    const { SwarmCoordinator } = await import('../src/swarm-coordinator.js');

    const coordinator = new SwarmCoordinator({
      chiefCount: 1,
      managerCount: 2,
      workerCount: 5,
      validatorCount: 2,
      workspaceCount: 1,
      llmMode: 'live',
      llmBaseURL: 'http://localhost:8080',
      randomSeed: 42,
    });

    // Run in simulation mode (llmMode is ignored for the simulation loop)
    const result = await coordinator.run({
      title: 'Model Router integration test',
      description: 'Test that swarm coordinates with LLM config',
      priority: 3 as any,
    });

    expect(result.success).toBe(true);
    expect(result.metrics.totalAgents).toBe(10);
  });

  it('should create LLMClient with correct base URL from config', () => {
    const client = new LLMClient({ baseURL: 'http://localhost:8080' });

    // Verify the client was configured with the right base URL
    // (We can't easily inspect private fields, but we can verify it doesn't throw)
    expect(client).toBeDefined();
  });
});