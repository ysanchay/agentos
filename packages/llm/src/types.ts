/**
 * @agentos/llm — Type definitions for LLM integration.
 * Connects AgentOS capabilities to the Model Router for task-based model routing.
 */

import type { ResourceConsumption } from '@agentos/types';

// ─── Token Cost Config ────────────────────────────────────────────────────

/** Conversion rates from LLM tokens to AgentOS resource units. */
export interface TokenCostConfig {
  /** RU per completion token (default: 0.001 → 1 RU per 1000 tokens) */
  ruPerCompletionToken: number;
  /** MU per prompt token (default: 0.0001 → 1 MU per 10000 tokens) */
  muPerPromptToken: number;
  /** EU per API call (default: 1) */
  euPerCall: number;
  /** VU per API call (default: 0) */
  vuPerCall: number;
}

/** Default token-to-resource conversion rates. */
export const DEFAULT_TOKEN_COSTS: TokenCostConfig = {
  ruPerCompletionToken: 0.001,
  muPerPromptToken: 0.0001,
  euPerCall: 1,
  vuPerCall: 0,
};

// ─── Configuration ──────────────────────────────────────────────────────────

/** Configuration for the LLM client connecting to the Model Router. */
export interface LLMClientConfig {
  /** Base URL of the Model Router (default: http://localhost:8080) */
  baseURL: string;
  /** Request timeout in milliseconds (default: 120000 for slow local inference) */
  timeout: number;
  /** Maximum number of retries on transient errors (default: 3) */
  maxRetries: number;
  /** Optional API key for authentication (passed as Authorization header) */
  apiKey?: string;
  /** Token-to-resource conversion rates */
  tokenCosts: TokenCostConfig;
}

/** Default LLM client configuration. */
export const DEFAULT_LLM_CONFIG: LLMClientConfig = {
  baseURL: process.env['AGENTOS_LLM_BASE_URL'] ?? 'http://localhost:8080',
  timeout: Number(process.env['AGENTOS_LLM_TIMEOUT'] ?? '120000'),
  maxRetries: Number(process.env['AGENTOS_LLM_MAX_RETRIES'] ?? '3'),
  apiKey: process.env['AGENTOS_LLM_API_KEY'],
  tokenCosts: DEFAULT_TOKEN_COSTS,
};

// ─── Chat Messages ────────────────────────────────────────────────────────

/** A single message in the chat conversation. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ─── Completion Options ───────────────────────────────────────────────────

/** Options for an LLM completion request. */
export interface LLMCompleteOptions {
  /** AgentOS capability path that determines model routing (e.g., 'reason.infer.text') */
  capabilityPath?: string;
  /** Override task type for routing (bypasses capability-based routing) */
  taskType?: TaskType;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Sampling temperature (0.0 - 2.0) */
  temperature?: number;
  /** Whether to request JSON mode output */
  jsonMode?: boolean;
  /** Model override (bypasses routing entirely) */
  model?: string;
}

// ─── Response ──────────────────────────────────────────────────────────────

/** The result of an LLM completion request. */
export interface LLMResponse {
  /** The generated text content */
  content: string;
  /** The model that actually served the request (e.g., 'qwen2.5-coder:7b') */
  model: string;
  /** How the task was classified ('coding', 'reasoning', 'decision', 'planning', 'default') */
  taskType: TaskType;
  /** Number of tokens in the prompt */
  promptTokens: number;
  /** Number of tokens in the completion */
  completionTokens: number;
  /** Total tokens (prompt + completion) */
  totalTokens: number;
  /** Wall-clock time in milliseconds */
  durationMs: number;
  /** Resource consumption in AgentOS units */
  resourcesConsumed: ResourceConsumption;
  /** Whether a fallback model was used */
  fallbackTriggered: boolean;
  /** Original model if fallback was triggered */
  fallbackFromModel?: string;
}

// ─── Task Type ─────────────────────────────────────────────────────────────

/** Task types that map to Model Router routing rules. */
export type TaskType = 'coding' | 'reasoning' | 'decision' | 'planning' | 'default';