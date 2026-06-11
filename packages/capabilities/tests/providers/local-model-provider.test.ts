/**
 * @agentos/capabilities — Local Model Provider Tests
 * Tests the LLM provider that bridges to @agentos/llm.
 * Uses a mocked LLMClient to avoid actual model calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalModelProvider } from '../../src/providers/local-model-provider.js';
import type { ProviderExecuteContext } from '../../src/types.js';
import type {
  CapabilityInvocation,
  InvocationID,
  AgentID,
  WorkspaceID,
  ProviderID,
  CapabilityPath,
} from '@agentos/types';
import { createUUID } from '@agentos/types';

// ─── Mock LLM Client ──────────────────────────────────────────────────────────

function createMockLLMClient() {
  return {
    complete: vi.fn().mockResolvedValue({
      content: 'Generated text response',
      model: 'test-model',
      taskType: 'reasoning',
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      durationMs: 500,
      resourcesConsumed: { ru: 20, mu: 10, eu: 5, vu: 0 },
      fallbackTriggered: false,
    }),
    getTokenTracker: vi.fn().mockReturnValue({ getTotal: () => ({ ru: 0, mu: 0, eu: 0, vu: 0 }) }),
    getCapabilityRouter: vi.fn(),
    getTotalConsumption: vi.fn().mockReturnValue({ ru: 20, mu: 10, eu: 5, vu: 0 }),
    reset: vi.fn(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeInvocation(path: string, input: unknown): CapabilityInvocation {
  return {
    id: createUUID() as unknown as InvocationID,
    capability_path: path as CapabilityPath,
    provider_id: createUUID() as unknown as ProviderID,
    caller: {
      agent_id: createUUID() as unknown as AgentID,
      workspace_id: createUUID() as unknown as WorkspaceID,
    },
    input,
    options: { timeout_ms: 60000, priority: 3, retry_on_failure: false },
    status: 'pending',
    created_at: new Date().toISOString(),
  };
}

function makeContext(invocation: CapabilityInvocation): ProviderExecuteContext {
  return {
    invocation,
    capability: {} as any,
    env: {},
    deadlineMs: 60_000,
    log: () => {},
    signal: new AbortController().signal,
  };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('LocalModelProvider', () => {
  it('should register model capabilities', () => {
    const provider = new LocalModelProvider({ llmClient: createMockLLMClient() as any });
    const paths = provider.capabilities.map(c => c.path as string);
    expect(paths).toContain('reason.model.complete');
    expect(paths).toContain('reason.model.chat');
    expect(paths).toContain('reason.model.embed');
  });

  it('should have network sandbox enabled for cloud routing', () => {
    const provider = new LocalModelProvider({ llmClient: createMockLLMClient() as any });
    expect(provider.sandboxConfig.network.enabled).toBe(true);
    expect(provider.sandboxConfig.network.allowOutbound).toBe(true);
  });

  it('should handle complete requests via LLMClient', async () => {
    const mockClient = createMockLLMClient();
    const provider = new LocalModelProvider({ llmClient: mockClient as any });

    const invocation = makeInvocation('reason.model.complete', {
      prompt: 'Explain quantum computing',
      maxTokens: 1024,
    });
    const context = makeContext(invocation);
    const result = await provider.execute(context);

    expect(result.output).toBeDefined();
    const output = result.output as any;
    expect(output.content).toBe('Generated text response');
    expect(output.model).toBe('test-model');
    expect(output.tokens).toBeDefined();
    expect(output.tokens.total).toBe(30);

    expect(mockClient.complete).toHaveBeenCalledOnce();
  });

  it('should handle chat requests via LLMClient', async () => {
    const mockClient = createMockLLMClient();
    const provider = new LocalModelProvider({ llmClient: mockClient as any });

    const invocation = makeInvocation('reason.model.chat', {
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hello!' },
      ],
    });
    const context = makeContext(invocation);
    const result = await provider.execute(context);

    expect(result.output).toBeDefined();
    const output = result.output as any;
    expect(output.content).toBe('Generated text response');
    expect(mockClient.complete).toHaveBeenCalledOnce();
  });

  it('should pass capability path to LLMClient for routing', async () => {
    const mockClient = createMockLLMClient();
    const provider = new LocalModelProvider({ llmClient: mockClient as any });

    const invocation = makeInvocation('reason.model.complete', { prompt: 'test' });
    const context = makeContext(invocation);
    await provider.execute(context);

    // Verify the LLMClient was called with options that include the capability path
    const callArgs = mockClient.complete.mock.calls[0];
    expect(callArgs[1].capabilityPath).toBe('reason.model.complete');
  });

  it('should handle model errors gracefully', async () => {
    const mockClient = createMockLLMClient();
    mockClient.complete.mockRejectedValue(new Error('Model unavailable'));

    const provider = new LocalModelProvider({ llmClient: mockClient as any });

    const invocation = makeInvocation('reason.model.complete', { prompt: 'test' });
    const context = makeContext(invocation);

    await expect(provider.execute(context)).rejects.toThrow('Model completion failed');
  });

  it('should pass health check when LLM is available', async () => {
    const mockClient = createMockLLMClient();
    const provider = new LocalModelProvider({ llmClient: mockClient as any });

    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
  });

  it('should report unhealthy when LLM is down', async () => {
    const mockClient = createMockLLMClient();
    mockClient.complete.mockRejectedValue(new Error('Connection refused'));
    const provider = new LocalModelProvider({ llmClient: mockClient as any });

    const health = await provider.healthCheck();
    expect(health.healthy).toBe(false);
  });

  it('should expose LLMClient via getter', () => {
    const mockClient = createMockLLMClient();
    const provider = new LocalModelProvider({ llmClient: mockClient as any });

    expect(provider.getLLMClient()).toBe(mockClient);
  });

  it('should have capabilities under reason root', () => {
    const provider = new LocalModelProvider({ llmClient: createMockLLMClient() as any });
    for (const cap of provider.capabilities) {
      expect(cap.root).toBe('reason');
    }
  });

  it('should handle embed requests', async () => {
    const mockClient = createMockLLMClient();
    const provider = new LocalModelProvider({ llmClient: mockClient as any });

    const invocation = makeInvocation('reason.model.embed', { text: 'hello world' });
    const context = makeContext(invocation);
    const result = await provider.execute(context);

    expect(result.output).toBeDefined();
    const output = result.output as any;
    expect(output.text).toBe('hello world');
  });
});