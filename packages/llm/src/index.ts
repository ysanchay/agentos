/**
 * @agentos/llm — LLM Integration for AgentOS
 * Connects AgentOS capabilities to the Model Router for task-based model routing.
 *
 * Architecture:
 *   AgentOS agents → LLMClient.complete() → Model Router (localhost:8080)
 *     → x-task-type header from CapabilityRouter → correct model
 *
 * Resource accountability:
 *   Every LLM call produces a ResourceConsumption record via TokenTracker.
 *   This satisfies the constitutional requirement for resource conservation tracking.
 */

// ─── Public API ────────────────────────────────────────────────────────────

export { LLMClient } from './llm-client.js';
export { CapabilityRouter } from './capability-router.js';
export { TokenTracker } from './token-tracker.js';

export type {
  LLMClientConfig,
  LLMCompleteOptions,
  LLMResponse,
  ChatMessage,
  TaskType,
  TokenCostConfig,
} from './types.js';

export { DEFAULT_LLM_CONFIG, DEFAULT_TOKEN_COSTS } from './types.js';