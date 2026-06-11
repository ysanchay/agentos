/**
 * @agentos/llm — LLM Client
 * OpenAI-compatible HTTP client that routes requests through the Model Router.
 *
 * Architecture:
 *   AgentOS agents → LLMClient.complete() → Model Router (localhost:8080)
 *     → x-task-type header based on CapabilityRouter → correct model
 *
 * The Model Router handles classification, routing, circuit breaking, and fallback.
 * This client just needs to:
 *   1. Format the request in OpenAI chat completion format
 *   2. Set the x-task-type header from the capability path
 *   3. Parse the response and track token usage via TokenTracker
 *   4. Retry on transient errors
 */

import type { ResourceConsumption } from '@agentos/types';
import { CapabilityRouter } from './capability-router.js';
import { TokenTracker } from './token-tracker.js';
import {
  DEFAULT_LLM_CONFIG,
  type LLMClientConfig,
  type ChatMessage,
  type LLMCompleteOptions,
  type LLMResponse,
  type TaskType,
} from './types.js';

// ─── Retry helper ──────────────────────────────────────────────────────────

function calculateBackoff(attempt: number): number {
  // Exponential backoff with jitter: 1s, 2s, 4s
  const baseMs = Math.min(1000 * Math.pow(2, attempt), 4000);
  const jitter = Math.random() * 500;
  return baseMs + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── LLMClient ────────────────────────────────────────────────────────────

export class LLMClient {
  private config: LLMClientConfig;
  private capabilityRouter: CapabilityRouter;
  private tokenTracker: TokenTracker;

  constructor(config: Partial<LLMClientConfig> = {}) {
    this.config = { ...DEFAULT_LLM_CONFIG, ...config };
    // Merge nested token costs
    this.config.tokenCosts = { ...DEFAULT_LLM_CONFIG.tokenCosts, ...config.tokenCosts };
    this.capabilityRouter = new CapabilityRouter();
    this.tokenTracker = new TokenTracker(this.config.tokenCosts);
  }

  /**
   * Send a chat completion request through the Model Router.
   *
   * The Model Router classifies the request based on the x-task-type header
   * (derived from the capabilityPath) and routes to the appropriate model:
   *   coding → Qwen2.5-Coder (local Ollama)
   *   reasoning/decision/planning → GLM-5.1 (Ollama Cloud)
   *   default → GLM-5.1 (cloud fallback)
   */
  async complete(
    messages: ChatMessage[],
    options: LLMCompleteOptions = {},
  ): Promise<LLMResponse> {
    // Determine task type from capability path or explicit override
    const taskType: TaskType = options.taskType
      ?? (options.capabilityPath
        ? this.capabilityRouter.resolve(options.capabilityPath)
        : 'default');

    // Build OpenAI-compatible request body
    const body: Record<string, unknown> = {
      model: options.model ?? 'auto', // 'auto' tells Model Router to use classification
      messages,
      stream: false,
    };

    if (options.maxTokens !== undefined) {
      body['max_tokens'] = options.maxTokens;
    }
    if (options.temperature !== undefined) {
      body['temperature'] = options.temperature;
    }
    if (options.jsonMode) {
      body['format'] = 'json';
    }

    // Build headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-task-type': taskType, // This is the key routing signal
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    // Make the request with retries
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.config.baseURL}/v1/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.config.timeout),
        });

        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'Unknown error');
          lastError = new Error(`Model Router error ${response.status}: ${errorBody}`);

          // Don't retry client errors (4xx) except 429 (rate limit)
          if (response.status >= 400 && response.status < 500 && response.status !== 429) {
            throw lastError;
          }

          // Retry on 429 and 5xx
          if (attempt < this.config.maxRetries) {
            await sleep(calculateBackoff(attempt));
            continue;
          }
          throw lastError;
        }

        const data = await response.json() as {
          id?: string;
          model?: string;
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };

        // Extract response content
        const content = data.choices?.[0]?.message?.content ?? '';
        const model = data.model ?? 'unknown';
        const promptTokens = data.usage?.prompt_tokens ?? 0;
        const completionTokens = data.usage?.completion_tokens ?? 0;
        const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;
        const durationMs = Date.now() - startTime;

        // Track token usage and convert to AgentOS resource units
        const resourcesConsumed = this.tokenTracker.track(promptTokens, completionTokens);

        return {
          content,
          model,
          taskType,
          promptTokens,
          completionTokens,
          totalTokens,
          durationMs,
          resourcesConsumed,
          fallbackTriggered: false, // Not available from response; tracked by Model Router
        };
      } catch (error) {
        lastError = error as Error;

        // Don't retry on AbortError (timeout) or non-retryable errors
        if (error instanceof TypeError || (error as Error).name === 'AbortError') {
          throw error;
        }

        if (attempt < this.config.maxRetries) {
          await sleep(calculateBackoff(attempt));
          continue;
        }
      }
    }

    throw lastError ?? new Error('All retries exhausted');
  }

  /**
   * Get the token tracker for this client.
   * Useful for querying cumulative resource usage.
   */
  getTokenTracker(): TokenTracker {
    return this.tokenTracker;
  }

  /**
   * Get the capability router for this client.
   * Useful for debugging which task type a capability maps to.
   */
  getCapabilityRouter(): CapabilityRouter {
    return this.capabilityRouter;
  }

  /**
   * Get cumulative resource consumption across all tracked calls.
   */
  getTotalConsumption(): ResourceConsumption {
    return this.tokenTracker.getTotalConsumption();
  }

  /**
   * Reset all tracked usage.
   */
  reset(): void {
    this.tokenTracker.reset();
  }
}