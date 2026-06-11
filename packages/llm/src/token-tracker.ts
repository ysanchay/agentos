/**
 * @agentos/llm — Token Tracker
 * Converts LLM token usage to AgentOS resource units (RU/MU/EU/VU).
 *
 * Constitutional reference: resource-model-v1.md defines the 4 resource types:
 *   RU = Reasoning Units (completion tokens → compute cost)
 *   MU = Memory Units (prompt tokens → context cost)
 *   EU = Execution Units (per API call → overhead cost)
 *   VU = Vision Units (not used for text LLMs, reserved)
 */

import type { ResourceConsumption } from '@agentos/types';
import type { TokenCostConfig } from './types.js';
import { DEFAULT_TOKEN_COSTS } from './types.js';

// ─── TokenTracker ─────────────────────────────────────────────────────────

export class TokenTracker {
  private config: TokenCostConfig;
  private totalPromptTokens: number = 0;
  private totalCompletionTokens: number = 0;
  private totalCalls: number = 0;
  private callHistory: Array<{
    promptTokens: number;
    completionTokens: number;
    resources: ResourceConsumption;
  }> = [];

  constructor(config: Partial<TokenCostConfig> = {}) {
    this.config = { ...DEFAULT_TOKEN_COSTS, ...config };
  }

  /**
   * Track token usage from an LLM response and convert to resource units.
   */
  track(promptTokens: number, completionTokens: number): ResourceConsumption {
    this.totalPromptTokens += promptTokens;
    this.totalCompletionTokens += completionTokens;
    this.totalCalls++;

    const resources: ResourceConsumption = {
      ru: Math.ceil(completionTokens * this.config.ruPerCompletionToken) || 1,
      mu: Math.ceil(promptTokens * this.config.muPerPromptToken) || 1,
      eu: this.config.euPerCall,
      vu: this.config.vuPerCall,
    };

    this.callHistory.push({ promptTokens, completionTokens, resources });

    return resources;
  }

  /**
   * Get the total resource consumption across all tracked calls.
   */
  getTotalConsumption(): ResourceConsumption {
    return {
      ru: this.callHistory.reduce((sum, c) => sum + c.resources.ru, 0),
      mu: this.callHistory.reduce((sum, c) => sum + c.resources.mu, 0),
      eu: this.callHistory.reduce((sum, c) => sum + c.resources.eu, 0),
      vu: this.callHistory.reduce((sum, c) => sum + c.resources.vu, 0),
    };
  }

  /**
   * Get total prompt tokens across all tracked calls.
   */
  getTotalPromptTokens(): number {
    return this.totalPromptTokens;
  }

  /**
   * Get total completion tokens across all tracked calls.
   */
  getTotalCompletionTokens(): number {
    return this.totalCompletionTokens;
  }

  /**
   * Get total number of API calls tracked.
   */
  getTotalCalls(): number {
    return this.totalCalls;
  }

  /**
   * Reset all tracked usage.
   */
  reset(): void {
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.totalCalls = 0;
    this.callHistory = [];
  }
}