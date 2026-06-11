/**
 * @agentos/llm — LLMClient tests
 * Tests against a mocked HTTP server to verify request formatting,
 * response parsing, x-task-type header, and retry logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMClient } from '../src/llm-client.js';
import type { TaskType } from '../src/types.js';

// ─── Mock fetch ────────────────────────────────────────────────────────────

function createMockFetch(responses: Array<{
  status?: number;
  body?: Record<string, unknown>;
  error?: string;
}>): typeof fetch {
  let callIndex = 0;
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const response = responses[callIndex] ?? responses[responses.length - 1]!;
    callIndex++;

    if (response.error) {
      throw new Error(response.error);
    }

    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('LLMClient', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('complete', () => {
    it('should send request to Model Router with correct headers', async () => {
      const mockFetch = createMockFetch([{
        body: {
          id: 'chatcmpl-test',
          object: 'chat.completion',
          model: 'qwen2.5-coder:7b',
          choices: [{ message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      }]);

      globalThis.fetch = mockFetch;

      const client = new LLMClient({ baseURL: 'http://localhost:8080' });
      const result = await client.complete(
        [{ role: 'user', content: 'write hello world' }],
        { capabilityPath: 'create.code.python' },
      );

      expect(result.content).toBe('Hello!');
      expect(result.model).toBe('qwen2.5-coder:7b');
      expect(result.taskType).toBe('coding');

      // Verify the request was made correctly
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:8080/v1/chat/completions');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.model).toBe('auto');
      expect(body.stream).toBe(false);

      // Verify x-task-type header
      const headers = init.headers as Record<string, string>;
      expect(headers['x-task-type']).toBe('coding');
    });

    it('should route reasoning tasks correctly', async () => {
      globalThis.fetch = createMockFetch([{
        body: {
          id: 'chatcmpl-test',
          model: 'glm-5.1:cloud',
          choices: [{ message: { role: 'assistant', content: 'Analysis complete' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 50, completion_tokens: 200, total_tokens: 250 },
        },
      }]);

      const client = new LLMClient({ baseURL: 'http://localhost:8080' });
      const result = await client.complete(
        [{ role: 'user', content: 'analyze the tradeoffs' }],
        { capabilityPath: 'reason.infer.text' },
      );

      expect(result.taskType).toBe('reasoning');
      expect(result.promptTokens).toBe(50);
      expect(result.completionTokens).toBe(200);
    });

    it('should allow taskType override', async () => {
      globalThis.fetch = createMockFetch([{
        body: {
          id: 'chatcmpl-test',
          model: 'glm-5.1:cloud',
          choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      }]);

      const client = new LLMClient({ baseURL: 'http://localhost:8080' });
      const result = await client.complete(
        [{ role: 'user', content: 'write code' }],
        { taskType: 'reasoning' as TaskType },
      );

      expect(result.taskType).toBe('reasoning');
    });

    it('should track token usage and resource consumption', async () => {
      globalThis.fetch = createMockFetch([{
        body: {
          id: 'chatcmpl-test',
          model: 'qwen2.5-coder:7b',
          choices: [{ message: { role: 'assistant', content: 'result' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10000, completion_tokens: 2000, total_tokens: 12000 },
        },
      }]);

      const client = new LLMClient({ baseURL: 'http://localhost:8080' });
      await client.complete([{ role: 'user', content: 'test' }]);

      const tracker = client.getTokenTracker();
      expect(tracker.getTotalCalls()).toBe(1);
      expect(tracker.getTotalPromptTokens()).toBe(10000);
      expect(tracker.getTotalCompletionTokens()).toBe(2000);

      const totalConsumption = client.getTotalConsumption();
      expect(totalConsumption.ru).toBeGreaterThan(0);
      expect(totalConsumption.mu).toBeGreaterThan(0);
      expect(totalConsumption.eu).toBe(1);
    });

    it('should retry on 5xx errors', async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response('Internal Server Error', { status: 500 });
        }
        return new Response(JSON.stringify({
          id: 'chatcmpl-test',
          model: 'qwen2.5-coder:7b',
          choices: [{ message: { role: 'assistant', content: 'Success' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as unknown as typeof fetch;

      const client = new LLMClient({
        baseURL: 'http://localhost:8080',
        maxRetries: 2,
        timeout: 5000,
      });

      // Speed up retries for testing
      const result = await client.complete([{ role: 'user', content: 'test' }]);
      expect(result.content).toBe('Success');
      expect(callCount).toBe(2); // First failed, second succeeded
    });

    it('should throw on 4xx errors without retrying', async () => {
      globalThis.fetch = createMockFetch([{
        status: 400,
        body: { error: { message: 'Bad request', type: 'invalid_request_error' } },
      }]);

      const client = new LLMClient({ baseURL: 'http://localhost:8080', maxRetries: 0 });
      await expect(client.complete([{ role: 'user', content: 'test' }])).rejects.toThrow();
    });

    it('should default to "default" task type when no capability path given', async () => {
      globalThis.fetch = createMockFetch([{
        body: {
          id: 'chatcmpl-test',
          model: 'glm-5.1:cloud',
          choices: [{ message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      }]);

      const client = new LLMClient({ baseURL: 'http://localhost:8080' });
      const result = await client.complete([{ role: 'user', content: 'test' }]);

      expect(result.taskType).toBe('default');
    });
  });

  describe('reset', () => {
    it('should reset all tracked usage', async () => {
      globalThis.fetch = createMockFetch([{
        body: {
          id: 'chatcmpl-test',
          model: 'qwen2.5-coder:7b',
          choices: [{ message: { role: 'assistant', content: 'test' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      }]);

      const client = new LLMClient({ baseURL: 'http://localhost:8080' });
      await client.complete([{ role: 'user', content: 'test' }]);

      expect(client.getTokenTracker().getTotalCalls()).toBe(1);
      client.reset();
      expect(client.getTokenTracker().getTotalCalls()).toBe(0);
    });
  });
});