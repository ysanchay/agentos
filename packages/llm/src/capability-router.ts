/**
 * @agentos/llm — Capability Router
 * Maps AgentOS capability paths to Model Router task types.
 *
 * The Model Router classifies requests as coding/reasoning/decision/planning/default.
 * This module bridges the AgentOS capability graph (e.g., 'reason.infer.text',
 * 'create.code.typescript') to those routing categories via the x-task-type header.
 *
 * Constitutional reference: capability-graph-v1.md defines 12 root capabilities.
 */

import type { TaskType } from './types.js';

// ─── Capability → Task Type Mapping ────────────────────────────────────────

/**
 * Maps capability path prefixes to Model Router task types.
 * More specific paths take precedence over shorter ones.
 * The Model Router's x-task-type header drives the routing decision.
 */
const CAPABILITY_MAP: Map<string, TaskType> = new Map([
  // Coding capabilities → local Qwen2.5-Coder (free, fast for code)
  ['create.code', 'coding'],
  ['create.code.typescript', 'coding'],
  ['create.code.python', 'coding'],
  ['create.code.javascript', 'coding'],
  ['create.code.rust', 'coding'],
  ['create.code.go', 'coding'],
  ['create.code.sql', 'coding'],

  // Reasoning capabilities → cloud GLM-5.1 (better for analysis)
  ['reason.infer', 'reasoning'],
  ['reason.infer.text', 'reasoning'],
  ['reason.infer.code', 'reasoning'],

  // Decision capabilities → cloud GLM-5.1
  ['reason.decide', 'decision'],
  ['reason.decide.binary', 'decision'],
  ['reason.decide.multi', 'decision'],

  // Planning/coordination capabilities → cloud GLM-5.1
  ['coordinate.plan', 'planning'],
  ['coordinate.plan.short', 'planning'],
  ['coordinate.plan.long', 'planning'],

  // Validation capabilities → reasoning (needs analysis)
  ['validate.review', 'reasoning'],
  ['validate.test', 'reasoning'],
  ['validate.approve', 'decision'],

  // Compute capabilities → coding (implementation-focused)
  ['compute.execute', 'coding'],
  ['compute.compile', 'coding'],
  ['compute.build', 'coding'],

  // Perception/learning → reasoning
  ['perceive.analyze', 'reasoning'],
  ['learn.adapt', 'reasoning'],
]);

// ─── CapabilityRouter ────────────────────────────────────────────────────

/**
 * Resolves an AgentOS capability path to a Model Router task type.
 *
 * Resolution strategy:
 * 1. Exact match in the map (e.g., 'reason.infer.text' → 'reasoning')
 * 2. Parent path fallback (e.g., 'reason.infer.text.long' → walk up to 'reason.infer.text')
 * 3. Root capability default (e.g., 'create' → 'coding', 'reason' → 'reasoning')
 * 4. Global default → 'default' (routes to GLM-5.1)
 */
export class CapabilityRouter {
  private mapping: Map<string, TaskType>;

  constructor(customMapping?: Map<string, TaskType>) {
    this.mapping = customMapping ?? CAPABILITY_MAP;
  }

  /**
   * Resolve a capability path to a task type for the Model Router.
   */
  resolve(capabilityPath: string): TaskType {
    // 1. Exact match
    const exact = this.mapping.get(capabilityPath);
    if (exact) return exact;

    // 2. Walk up the path tree (e.g., 'reason.infer.text.long' → 'reason.infer.text' → 'reason.infer')
    const parts = capabilityPath.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const parent = parts.slice(0, i).join('.');
      const match = this.mapping.get(parent);
      if (match) return match;
    }

    // 3. Root capability defaults
    const root = parts[0];
    if (root === 'create' || root === 'compute') return 'coding';
    if (root === 'reason' || root === 'perceive' || root === 'learn') return 'reasoning';
    if (root === 'coordinate' || root === 'secure') return 'planning';
    if (root === 'validate') return 'reasoning';

    // 4. Global default → routes to GLM-5.1
    return 'default';
  }

  /**
   * Get the x-task-type header value for a capability path.
   * This is the header that the Model Router reads for routing decisions.
   */
  getTaskTypeHeader(capabilityPath: string): string {
    return this.resolve(capabilityPath);
  }
}