/**
 * @agentos/capabilities — Local Model Provider
 * Implements reason.model.{complete,chat,embed} by bridging
 * to the @agentos/llm LLMClient + Model Router.
 */

import type { ResourceConsumption } from '@agentos/types';
import { LLMClient, type LLMClientConfig, type ChatMessage, type LLMCompleteOptions } from '@agentos/llm';
import type { ProviderExecuteContext, ProviderSandboxConfig } from '../types.js';
import { ProviderBase, type ProviderBaseConfig, type ProviderCapabilityDef } from './provider-base.js';

// ─── Input Schemas ───────────────────────────────────────────────────────────

const COMPLETE_INPUT = {
  type: 'object',
  required: ['prompt'],
  properties: {
    prompt: { type: 'string', description: 'The prompt to complete' },
    system: { type: 'string', description: 'System prompt' },
    maxTokens: { type: 'number', default: 4096 },
    temperature: { type: 'number', default: 0.7 },
    jsonMode: { type: 'boolean', default: false },
    model: { type: 'string', description: 'Override model (bypasses routing)' },
  },
} as const;

const CHAT_INPUT = {
  type: 'object',
  required: ['messages'],
  properties: {
    messages: {
      type: 'array',
      items: {
        type: 'object',
        required: ['role', 'content'],
        properties: {
          role: { type: 'string', enum: ['system', 'user', 'assistant'] },
          content: { type: 'string' },
        },
      },
      description: 'Chat messages',
    },
    maxTokens: { type: 'number', default: 4096 },
    temperature: { type: 'number', default: 0.7 },
    jsonMode: { type: 'boolean', default: false },
    model: { type: 'string', description: 'Override model (bypasses routing)' },
  },
} as const;

const EMBED_INPUT = {
  type: 'object',
  required: ['text'],
  properties: {
    text: { type: 'string', description: 'Text to embed' },
    model: { type: 'string', description: 'Embedding model' },
  },
} as const;

const MODEL_OUTPUT = {
  type: 'object',
  properties: {
    content: { type: 'string' },
    model: { type: 'string' },
    taskType: { type: 'string' },
    tokens: { type: 'object' },
    durationMs: { type: 'number' },
    fallbackTriggered: { type: 'boolean' },
  },
} as const;

// ─── Provider Config ──────────────────────────────────────────────────────────

export interface LocalModelProviderConfig extends ProviderBaseConfig {
  /** LLMClient configuration (baseURL, timeout, etc.) */
  llmConfig?: Partial<LLMClientConfig>;
  /** Custom LLMClient instance (overrides llmConfig) */
  llmClient?: LLMClient;
}

// ─── Local Model Provider ────────────────────────────────────────────────────

export class LocalModelProvider extends ProviderBase {
  private readonly llmClient: LLMClient;

  constructor(config?: Partial<LocalModelProviderConfig>) {
    const sandboxOverride: Partial<ProviderSandboxConfig> = {
      network: {
        enabled: true,
        allowedHosts: ['*'], // Model Router may route to cloud
        allowOutbound: true,
        maxResponseSize: 10_000_000,
      },
      maxTimeoutMs: 180_000,
    };

    const defs: ProviderCapabilityDef[] = [
      {
        path: 'reason.model.complete',
        displayName: 'Model Complete',
        description: 'Complete a text prompt using the local or routed model',
        inputSchema: COMPLETE_INPUT,
        outputSchema: MODEL_OUTPUT,
        handler: (input, ctx) => this.handleComplete(input, ctx),
        resourceProfile: { typical: { ru: 20, mu: 10, eu: 5, vu: 0 }, peak: { ru: 100, mu: 50, eu: 20, vu: 0 }, timeout_ms: 120_000 },
      },
      {
        path: 'reason.model.chat',
        displayName: 'Model Chat',
        description: 'Chat completion using the local or routed model',
        inputSchema: CHAT_INPUT,
        outputSchema: MODEL_OUTPUT,
        handler: (input, ctx) => this.handleChat(input, ctx),
        resourceProfile: { typical: { ru: 25, mu: 15, eu: 5, vu: 0 }, peak: { ru: 150, mu: 80, eu: 25, vu: 0 }, timeout_ms: 120_000 },
      },
      {
        path: 'reason.model.embed',
        displayName: 'Model Embed',
        description: 'Generate text embeddings using the model router',
        inputSchema: EMBED_INPUT,
        outputSchema: {
          type: 'object',
          properties: {
            embedding: { type: 'array', items: { type: 'number' } },
            model: { type: 'string' },
            tokens: { type: 'number' },
          },
        },
        handler: (input, ctx) => this.handleEmbed(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 10, mu: 5, eu: 3, vu: 0 }, peak: { ru: 50, mu: 25, eu: 10, vu: 0 }, timeout_ms: 30_000 },
      },
    ];

    super(
      {
        root: 'reason',
        reliabilityScore: 0.92,
        avgLatencyMs: 2000,
        successRate: 0.95,
        maxConcurrent: 20,
        sandboxConfig: sandboxOverride,
        ...config,
      },
      defs,
    );

    // Use provided client or create one
    this.llmClient = config?.llmClient ?? new LLMClient(config?.llmConfig);
  }

  // ─── Handlers ────────────────────────────────────────────────────────────

  private async handleComplete(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();

    const messages: ChatMessage[] = [];
    if (input.system) {
      messages.push({ role: 'system', content: input.system });
    }
    messages.push({ role: 'user', content: input.prompt });

    const options: LLMCompleteOptions = {
      capabilityPath: context.invocation.capability_path as string,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      jsonMode: input.jsonMode,
      model: input.model,
    };

    try {
      const response = await this.llmClient.complete(messages, options);
      const durationMs = Date.now() - start;

      return this.success({
        content: response.content,
        model: response.model,
        taskType: response.taskType,
        tokens: {
          prompt: response.promptTokens,
          completion: response.completionTokens,
          total: response.totalTokens,
        },
        durationMs,
        fallbackTriggered: response.fallbackTriggered,
        fallbackFromModel: response.fallbackFromModel,
      }, durationMs, {
        ru: 20,
        mu: 10,
        eu: 5,
        vu: 0,
      });
    } catch (e) {
      throw new Error(`Model completion failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async handleChat(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();

    const messages: ChatMessage[] = (input.messages as Array<{ role: string; content: string }>).map(m => ({
      role: m.role as ChatMessage['role'],
      content: m.content,
    }));

    const options: LLMCompleteOptions = {
      capabilityPath: context.invocation.capability_path as string,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      jsonMode: input.jsonMode,
      model: input.model,
    };

    try {
      const response = await this.llmClient.complete(messages, options);
      const durationMs = Date.now() - start;

      return this.success({
        content: response.content,
        model: response.model,
        taskType: response.taskType,
        tokens: {
          prompt: response.promptTokens,
          completion: response.completionTokens,
          total: response.totalTokens,
        },
        durationMs,
        fallbackTriggered: response.fallbackTriggered,
        fallbackFromModel: response.fallbackFromModel,
      }, durationMs, {
        ru: 25,
        mu: 15,
        eu: 5,
        vu: 0,
      });
    } catch (e) {
      throw new Error(`Model chat failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async handleEmbed(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();

    // Embed is a specialized operation — we use a simple prompt-based approach
    // since the LLMClient doesn't have a dedicated embed method.
    // In production, this would call a dedicated embedding endpoint.
    const messages: ChatMessage[] = [
      { role: 'user', content: input.text },
    ];

    try {
      const response = await this.llmClient.complete(messages, {
        capabilityPath: 'reason.model.embed',
        maxTokens: 8,
        temperature: 0,
        model: input.model,
      });

      // For now, return a placeholder embedding vector
      // A real implementation would call an embedding endpoint
      const durationMs = Date.now() - start;

      return this.success({
        embedding: [], // Placeholder — real implementation returns float vector
        model: response.model,
        tokens: response.totalTokens,
        text: input.text,
        note: 'Embedding via completion endpoint (placeholder vector). Full embedding API pending.',
      }, durationMs, {
        ru: 10,
        mu: 5,
        eu: 3,
        vu: 0,
      });
    } catch (e) {
      throw new Error(`Model embed failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  protected override async performHealthCheck(): Promise<{ healthy: boolean; details?: unknown }> {
    try {
      const response = await this.llmClient.complete(
        [{ role: 'user', content: 'ping' }],
        { maxTokens: 5, temperature: 0 },
      );
      return { healthy: true, details: { model: response.model, latency: response.durationMs } };
    } catch (e) {
      return { healthy: false, details: { reason: e instanceof Error ? e.message : String(e) } };
    }
  }

  /**
   * Get the underlying LLMClient for direct access.
   */
  getLLMClient(): LLMClient {
    return this.llmClient;
  }
}