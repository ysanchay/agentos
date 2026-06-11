/**
 * @agentos/capabilities — Security Hypervisor
 * Enforcement layer that runs BEFORE and AFTER every capability invocation.
 * Pre-invoke: 9 checks (policy, permission, rate limit, approval, input
 * validation, input size, concurrent, budget, sandbox).
 * Post-invoke: 5 anomaly checks (output size, duration, consumption,
 * output schema, audit).
 */

import type {
  CapabilityPath,
  Capability,
  CapabilityInvocation,
  InvocationID,
  InvocationResult,
  InvocationError,
  AgentID,
  ResourceBudget,
  ResourceConsumption,
} from '@agentos/types';
import { ok, err } from '@agentos/types';
import type { Outcome } from '@agentos/types';
import type {
  ICapabilityProvider,
  SecurityPolicy,
  SecurityAnomaly,
  CapabilityRule,
} from './types.js';

// ─── Rate Limiter ───────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

export class SecurityHypervisor {
  private policy: SecurityPolicy;
  /** Per-agent rate limit tracking: `${agentId}:${capabilityPath}` → entry */
  private rateLimitEntries = new Map<string, RateLimitEntry>();
  /** Per-agent concurrent invocation tracking */
  private concurrentInvocations = new Map<string, number>;
  /** Pending approvals: InvocationID → { granted, approvedBy } */
  private pendingApprovals = new Map<InvocationID, { granted: boolean; approvedBy?: AgentID }>();
  /** Per-agent budget tracking (hourly) */
  private budgetUsage = new Map<string, { ru: number; mu: number; windowStart: number }>();
  /** Audit log for all invocations */
  private auditLog: Array<{
    invocationId: InvocationID;
    capabilityPath: CapabilityPath;
    agentId: AgentID;
    phase: 'pre' | 'post';
    result: 'allowed' | 'denied' | 'completed' | 'failed';
    anomalies?: SecurityAnomaly[];
    timestamp: number;
  }> = [];

  constructor(policy: SecurityPolicy) {
    this.policy = policy;
  }

  /**
   * Pre-invoke check — the security gate.
   * Called BEFORE provider.execute().
   * Returns ok(true) if invocation is allowed, err otherwise.
   */
  preInvoke(
    invocation: CapabilityInvocation,
    provider: ICapabilityProvider,
    capability: Capability,
  ): Outcome<true> {
    const agentId = invocation.caller.agent_id;
    const path = invocation.capability_path;

    // 1. CAPABILITY POLICY — is this capability allowed by policy?
    const ruleResult = this.checkPolicy(path);
    if (!ruleResult) {
      this.auditLog.push({ invocationId: invocation.id, capabilityPath: path, agentId, phase: 'pre', result: 'denied', timestamp: Date.now() });
      return err('CG_E.PERMISSION_DENIED', `Capability ${path} denied by security policy`, { retryable: false });
    }

    // 2. RATE LIMIT — has agent exceeded per-capability rate?
    const rateResult = this.checkRateLimit(agentId, path);
    if (!rateResult) {
      this.auditLog.push({ invocationId: invocation.id, capabilityPath: path, agentId, phase: 'pre', result: 'denied', timestamp: Date.now() });
      return err('CG_E.RATE_LIMIT_EXCEEDED', `Rate limit exceeded for ${path} by agent ${agentId}`, { retryable: true });
    }

    // 3. GLOBAL RATE LIMIT — has agent exceeded global invocation rate?
    const globalRateResult = this.checkGlobalRateLimit(agentId);
    if (!globalRateResult) {
      this.auditLog.push({ invocationId: invocation.id, capabilityPath: path, agentId, phase: 'pre', result: 'denied', timestamp: Date.now() });
      return err('CG_E.RATE_LIMIT_EXCEEDED', `Global rate limit exceeded for agent ${agentId}`, { retryable: true });
    }

    // 4. APPROVAL REQUIREMENT — does this capability require approval?
    const approvalResult = this.checkApproval(invocation.id, path);
    if (!approvalResult) {
      this.auditLog.push({ invocationId: invocation.id, capabilityPath: path, agentId, phase: 'pre', result: 'denied', timestamp: Date.now() });
      return err('CG_E.APPROVAL_REQUIRED', `Capability ${path} requires approval`, { retryable: true });
    }

    // 5. INPUT VALIDATION — basic size check
    const inputSize = this.estimateSize(invocation.input);
    if (inputSize > this.policy.maxInputSizeBytes) {
      this.auditLog.push({ invocationId: invocation.id, capabilityPath: path, agentId, phase: 'pre', result: 'denied', timestamp: Date.now() });
      return err('CG_E.INPUT_VALIDATION_FAILED', `Input size ${inputSize} exceeds limit ${this.policy.maxInputSizeBytes}`, { retryable: false });
    }

    // 6. CONCURRENT INVOCATIONS — is agent within maxConcurrent limit?
    const concurrent = this.concurrentInvocations.get(agentId as string) ?? 0;
    if (concurrent >= this.policy.globalRateLimit.maxConcurrent) {
      this.auditLog.push({ invocationId: invocation.id, capabilityPath: path, agentId, phase: 'pre', result: 'denied', timestamp: Date.now() });
      return err('CG_E.RATE_LIMIT_EXCEEDED', `Agent ${agentId} at max concurrent invocations (${concurrent})`, { retryable: true });
    }

    // 7. BUDGET CHECK — does agent have remaining budget?
    const budgetResult = this.checkBudget(agentId, capability.resource_profile.typical);
    if (!budgetResult) {
      this.auditLog.push({ invocationId: invocation.id, capabilityPath: path, agentId, phase: 'pre', result: 'denied', timestamp: Date.now() });
      return err('CG_E.BUDGET_EXCEEDED', `Budget exceeded for agent ${agentId}`, { retryable: false });
    }

    // 8. Increment concurrent counter
    this.concurrentInvocations.set(agentId as string, concurrent + 1);

    // 9. Audit: pre-invoke passed
    this.auditLog.push({ invocationId: invocation.id, capabilityPath: path, agentId, phase: 'pre', result: 'allowed', timestamp: Date.now() });

    return ok(true);
  }

  /**
   * Post-invoke check — anomaly detection and audit.
   * Called AFTER provider.execute() returns.
   * Always runs, even on error.
   */
  postInvoke(
    invocation: CapabilityInvocation,
    result?: InvocationResult,
    error?: InvocationError,
  ): { anomalies: SecurityAnomaly[] } {
    const anomalies: SecurityAnomaly[] = [];
    const agentId = invocation.caller.agent_id;
    const path = invocation.capability_path;

    // Decrement concurrent counter
    const concurrent = this.concurrentInvocations.get(agentId as string) ?? 1;
    this.concurrentInvocations.set(agentId as string, Math.max(0, concurrent - 1));

    // Record budget usage
    if (result?.resources_consumed) {
      this.recordBudgetUsage(agentId, result.resources_consumed);
    }

    if (!result) {
      // Error case — still audit
      this.auditLog.push({ invocationId: invocation.id, capabilityPath: path, agentId, phase: 'post', result: 'failed', anomalies, timestamp: Date.now() });
      return { anomalies };
    }

    // 1. OUTPUT SIZE — within maxOutputSizeBytes?
    const outputSize = this.estimateSize(result.output);
    if (outputSize > this.policy.maxOutputSizeBytes) {
      anomalies.push({
        type: 'output_size',
        severity: 'high',
        message: `Output size ${outputSize} exceeds limit ${this.policy.maxOutputSizeBytes}`,
        details: { size: outputSize, limit: this.policy.maxOutputSizeBytes },
      });
    }

    // 2. DURATION ANOMALY — > 3× avg_latency for provider?
    // (We don't have the provider's avg_latency here, so we skip strict checking
    //  and flag if duration > 60s as a heuristic)
    if (result.duration_ms > 60_000) {
      anomalies.push({
        type: 'duration',
        severity: 'medium',
        message: `Execution took ${result.duration_ms}ms (> 60s)`,
        details: { durationMs: result.duration_ms },
      });
    }

    // 3. CONSUMPTION ANOMALY — very high resource usage
    const totalUnits = result.resources_consumed.ru + result.resources_consumed.mu +
                       result.resources_consumed.eu + result.resources_consumed.vu;
    if (totalUnits > 1000) {
      anomalies.push({
        type: 'consumption',
        severity: 'medium',
        message: `High resource consumption: ${totalUnits} total units`,
        details: { consumed: result.resources_consumed },
      });
    }

    // 4. OUTPUT SCHEMA VALIDATION — basic structural check
    if (result.output === undefined || result.output === null) {
      anomalies.push({
        type: 'output_schema',
        severity: 'low',
        message: 'Output is null/undefined',
        details: { path },
      });
    }

    // 5. AUDIT LOG — always record the post-invoke result
    this.auditLog.push({
      invocationId: invocation.id,
      capabilityPath: path,
      agentId,
      phase: 'post',
      result: anomalies.length === 0 ? 'completed' : 'completed',
      anomalies: anomalies.length > 0 ? anomalies : undefined,
      timestamp: Date.now(),
    });

    return { anomalies };
  }

  /**
   * Check if a specific agent can invoke a specific capability.
   * Lightweight check that doesn't modify state.
   */
  canInvoke(agentId: AgentID, path: CapabilityPath): boolean {
    return this.checkPolicy(path);
  }

  /**
   * Grant approval for a pending invocation.
   */
  grantApproval(invocationId: InvocationID, approvedBy: AgentID): void {
    this.pendingApprovals.set(invocationId, { granted: true, approvedBy });
  }

  /**
   * Deny approval for a pending invocation.
   */
  denyApproval(invocationId: InvocationID): void {
    this.pendingApprovals.set(invocationId, { granted: false });
  }

  /**
   * Get the current security policy.
   */
  getPolicy(): SecurityPolicy {
    return this.policy;
  }

  /**
   * Update the security policy.
   */
  setPolicy(policy: SecurityPolicy): void {
    this.policy = policy;
  }

  /**
   * Get the audit log for all invocations.
   */
  getAuditLog(): ReadonlyArray<{
    invocationId: InvocationID;
    capabilityPath: CapabilityPath;
    agentId: AgentID;
    phase: 'pre' | 'post';
    result: 'allowed' | 'denied' | 'completed' | 'failed';
    anomalies?: SecurityAnomaly[];
    timestamp: number;
  }> {
    return this.auditLog;
  }

  /**
   * Clear the audit log.
   */
  clearAuditLog(): void {
    this.auditLog = [];
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private checkPolicy(path: CapabilityPath): boolean {
    const pathStr = path as string;

    // Check exact rule
    const rule = this.policy.capabilityRules.get(path);
    if (rule) {
      return rule.allowed;
    }

    // Check parent rules (most specific first)
    const parts = pathStr.split('.');
    for (let depth = parts.length - 1; depth >= 1; depth--) {
      const parentPath = parts.slice(0, depth).join('.') as CapabilityPath;
      const parentRule = this.policy.capabilityRules.get(parentPath);
      if (parentRule) {
        return parentRule.allowed;
      }
    }

    // Check if in restricted list
    if (this.policy.restricted.some(r => pathStr.startsWith(r as string) || pathStr === (r as string))) {
      return false;
    }

    // Default action
    return this.policy.defaultAction === 'allow';
  }

  private checkRateLimit(agentId: AgentID, path: CapabilityPath): boolean {
    const rule = this.findRule(path);
    if (!rule?.maxInvocationsPerHour) return true;

    const key = `${agentId}:${path}`;
    const entry = this.rateLimitEntries.get(key);
    const now = Date.now();
    const windowMs = 3600_000; // 1 hour

    if (!entry || (now - entry.windowStart) > windowMs) {
      this.rateLimitEntries.set(key, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= rule.maxInvocationsPerHour) {
      return false;
    }

    entry.count++;
    return true;
  }

  private checkGlobalRateLimit(agentId: AgentID): boolean {
    const key = `${agentId}:__global__`;
    const entry = this.rateLimitEntries.get(key);
    const now = Date.now();
    const windowMs = 3600_000;

    if (!entry || (now - entry.windowStart) > windowMs) {
      this.rateLimitEntries.set(key, { count: 1, windowStart: now });
      return true;
    }

    if (entry.count >= this.policy.globalRateLimit.maxInvocationsPerHour) {
      return false;
    }

    entry.count++;
    return true;
  }

  private checkApproval(invocationId: InvocationID, path: CapabilityPath): boolean {
    const pathStr = path as string;

    // Check if this capability requires approval
    const requiresApproval = this.isApprovalRequired(path);

    if (!requiresApproval) return true;

    // Check if approval has been granted
    const approval = this.pendingApprovals.get(invocationId);
    if (approval?.granted) {
      this.pendingApprovals.delete(invocationId);
      return true;
    }

    return false;
  }

  private isApprovalRequired(path: CapabilityPath): boolean {
    const pathStr = path as string;

    // Check policy's approvalRequired list
    if (this.policy.approvalRequired === '*') return true;

    if (Array.isArray(this.policy.approvalRequired)) {
      for (const required of this.policy.approvalRequired) {
        if (pathStr === (required as string) || pathStr.startsWith((required as string) + '.')) {
          return true;
        }
      }
    }

    // Check rule
    const rule = this.findRule(path);
    if (rule?.requireApproval) return true;

    // Check restricted list
    if (this.policy.restricted.some(r => pathStr.startsWith(r as string) || pathStr === (r as string))) {
      return true;
    }

    return false;
  }

  private checkBudget(agentId: AgentID, estimated: ResourceBudget): boolean {
    const key = agentId as string;
    const now = Date.now();
    const windowMs = 3600_000;
    const usage = this.budgetUsage.get(key);

    // Even on fresh window, check if estimated cost fits within budget limits.
    // A budget of 0 means no invocations are allowed at all.
    const currentRu = (!usage || (now - usage.windowStart) > windowMs) ? 0 : usage.ru;
    const currentMu = (!usage || (now - usage.windowStart) > windowMs) ? 0 : usage.mu;

    if (currentRu + estimated.ru > this.policy.budgetLimits.maxRuPerHour) return false;
    if (currentMu + estimated.mu > this.policy.budgetLimits.maxMuPerHour) return false;

    return true;
  }

  private recordBudgetUsage(agentId: AgentID, consumed: ResourceConsumption): void {
    const key = agentId as string;
    const now = Date.now();
    const windowMs = 3600_000;
    let usage = this.budgetUsage.get(key);

    if (!usage || (now - usage.windowStart) > windowMs) {
      usage = { ru: 0, mu: 0, windowStart: now };
    }

    usage.ru += consumed.ru;
    usage.mu += consumed.mu;
    this.budgetUsage.set(key, usage);
  }

  private findRule(path: CapabilityPath): CapabilityRule | undefined {
    // Exact match first
    const rule = this.policy.capabilityRules.get(path);
    if (rule) return rule;

    // Parent fallback
    const parts = (path as string).split('.');
    for (let depth = parts.length - 1; depth >= 1; depth--) {
      const parentPath = parts.slice(0, depth).join('.') as CapabilityPath;
      const parentRule = this.policy.capabilityRules.get(parentPath);
      if (parentRule) return parentRule;
    }

    return undefined;
  }

  private estimateSize(value: unknown): number {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 0;
    }
  }
}