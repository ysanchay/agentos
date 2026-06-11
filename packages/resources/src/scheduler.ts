/**
 * @agentos/resources — Resource Scheduler
 * Main scheduling engine that coordinates allocation, quotas, fairness, and throttling.
 * From resource-model-v1.md Sections 2-8.
 *
 * ZERO AI logic — deterministic scheduling only.
 */

import type {
  AgentID,
  TaskID,
  WorkspaceID,
  Priority,
  Outcome,
  ResourceBudget,
  ResourceRequest,
  ISO8601,
} from '@agentos/types';
import { ok, err, KER, AllocationState, ZERO_BUDGET, createUUID } from '@agentos/types';
import type { AllocationID } from '@agentos/types';
import type { ConservationResult } from './conservation.js';
import { AllocationStateMachine, type AllocationRecord } from './allocator.js';
import { QuotaEngine, type AgentUsage, type WorkspaceUsage, type UserUsage, type EnterpriseUsage } from './quota-engine.js';
import { PreemptionEngine } from './preemption-engine.js';
import { ThrottleEngine, ThrottleLevel } from './throttle-engine.js';
import { FairnessEngine } from './fairness-engine.js';
import { BudgetEnforcer } from './budget-enforcer.js';
import { ConservationEnforcer } from './conservation.js';
import { TokenBucket } from './token-bucket.js';

// ─── Scheduler Config ──────────────────────────────────────────────────

export interface SchedulerConfig {
  /** Total system resource capacity */
  totalCapacity: ResourceBudget;
  /** Default allocation duration in ms (default: 1 hour) */
  defaultDurationMs: number;
  /** Maximum concurrent allocations per agent */
  maxConcurrentPerAgent: number;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  totalCapacity: { ru: 10000, mu: 5000, eu: 1000, vu: 500 },
  defaultDurationMs: 3_600_000,
  maxConcurrentPerAgent: 10,
};

// ─── Scheduler ─────────────────────────────────────────────────────────

export class ResourceScheduler {
  private allocations: Map<string, AllocationRecord> = new Map();
  private stateMachine = new AllocationStateMachine();
  private quotaEngine = new QuotaEngine();
  private preemptionEngine = new PreemptionEngine();
  private throttleEngine = new ThrottleEngine();
  private fairnessEngine = new FairnessEngine();
  private budgetEnforcer = new BudgetEnforcer();
  private conservationEnforcer = new ConservationEnforcer();
  private rateLimiter: TokenBucket;

  private config: SchedulerConfig;

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.rateLimiter = new TokenBucket({
      capacity: 1000,
      refillRate: 100,
      refillIntervalMs: 1000,
    });
  }

  // ─── Allocation Lifecycle ──────────────────────────────────────────

  /**
   * Request allocation of resources for an agent/task.
   * Goes through: quota check → conservation check → fairness → grant.
   */
  requestAllocation(
    agentId: AgentID,
    workspaceId: WorkspaceID,
    request: ResourceRequest,
    preemptible: boolean = true,
  ): Outcome<AllocationRecord> {
    // Rate limit check
    if (!this.rateLimiter.tryConsume(1)) {
      return err(KER.QUOTA_EXCEEDED, 'Rate limit exceeded for allocation requests', {
        retryable: true,
      });
    }

    // Check concurrent allocation limit
    const concurrentCount = this.getActiveAllocationsForAgent(agentId).length;
    if (concurrentCount >= this.config.maxConcurrentPerAgent) {
      return err(KER.QUOTA_EXCEEDED, `Agent ${agentId} has reached maximum concurrent allocations`, {
        retryable: false,
      });
    }

    // Check quota at all 4 levels
    const agentUsage = this.getAgentUsage(agentId);
    const workspaceUsage = this.getWorkspaceUsage(workspaceId);
    const userUsage = this.getDefaultUsage();
    const enterpriseUsage = this.getDefaultEnterpriseUsage();

    const quotaResult = this.quotaEngine.validate(
      request,
      agentUsage,
      workspaceUsage,
      userUsage,
      enterpriseUsage,
    );

    if (!quotaResult.ok) {
      return quotaResult;
    }

    // Check conservation (would adding this exceed capacity?)
    const id = createUUID() as unknown as AllocationID;
    const pendingRecord = this.stateMachine.createPending(
      id,
      agentId,
      workspaceId,
      request.priority,
      preemptible,
      request.ru,
      request.mu,
      request.eu,
      request.vu,
    );

    // Check if we have enough capacity
    const activeAllocations = this.getActiveAllocations();
    const conservationResult = this.conservationEnforcer.checkCapacity(
      activeAllocations,
      pendingRecord,
      this.config.totalCapacity,
    );

    if (!conservationResult.valid) {
      // Try preemption if the request is higher priority
      const candidates = this.preemptionEngine.selectCandidates(
        activeAllocations,
        request.priority,
        request.ru,
        request.mu,
        request.eu,
        request.vu,
      );

      if (candidates.length > 0) {
        const preemptResult = this.preemptionEngine.preempt(candidates, 'higher_priority_request');
        if (preemptResult.ok) {
          // Re-check capacity after preemption
          const remainingActive = this.getActiveAllocations();
          const capacityCheck = this.conservationEnforcer.checkCapacity(
            remainingActive,
            pendingRecord,
            this.config.totalCapacity,
          );
          if (!capacityCheck.valid) {
            return err(KER.RESOURCE_EXHAUSTED, 'Insufficient resources even after preemption', {
              retryable: true,
              details: { violations: capacityCheck.violations },
            });
          }
        }
      } else {
        return err(KER.RESOURCE_EXHAUSTED, 'Insufficient resources available', {
          retryable: true,
          details: { violations: conservationResult.violations },
        });
      }
    }

    // Grant the allocation — transition PENDING → GRANTED → ACTIVE
    let record = pendingRecord;
    const grantResult = this.stateMachine.transition(record, AllocationState.GRANTED);
    if (!grantResult.ok) return grantResult;
    record = grantResult.data;

    const activeResult = this.stateMachine.transition(record, AllocationState.ACTIVE);
    if (!activeResult.ok) return activeResult;
    record = activeResult.data;

    this.allocations.set(record.id as string, record);
    return ok(record);
  }

  /**
   * Release an allocation.
   */
  releaseAllocation(allocationId: AllocationID): Outcome<true> {
    const record = this.allocations.get(allocationId as string);
    if (!record) {
      return err(KER.NOT_FOUND, `Allocation ${allocationId} not found`, { retryable: false });
    }

    const result = this.stateMachine.transition(record, AllocationState.RELEASED);
    if (!result.ok) return err(KER.INVALID_STATE_TRANSITION, result.error_message);

    const updated = result.data;
    this.allocations.set(allocationId as string, updated);

    // Remove from fairness wait queue if present
    this.fairnessEngine.removeWait(record.agent_id);

    return ok(true);
  }

  /**
   * Revoke an allocation (admin action).
   */
  revokeAllocation(allocationId: AllocationID, reason: string): Outcome<true> {
    const record = this.allocations.get(allocationId as string);
    if (!record) {
      return err(KER.NOT_FOUND, `Allocation ${allocationId} not found`, { retryable: false });
    }

    const result = this.stateMachine.transition(record, AllocationState.REVOKED);
    if (!result.ok) return err(KER.INVALID_STATE_TRANSITION, result.error_message);

    this.allocations.set(allocationId as string, result.data);
    return ok(true);
  }

  // ─── Consumption Tracking ──────────────────────────────────────────

  /**
   * Report resource consumption for an allocation.
   */
  reportConsumption(
    allocationId: AllocationID,
    consumption: { ru: number; mu: number; eu: number; vu: number },
  ): Outcome<AllocationRecord> {
    const record = this.allocations.get(allocationId as string);
    if (!record) {
      return err(KER.NOT_FOUND, `Allocation ${allocationId} not found`, { retryable: false });
    }

    if (record.state !== AllocationState.ACTIVE && record.state !== AllocationState.THROTTLED) {
      return err(KER.INVALID_STATE_TRANSITION, `Cannot report consumption for allocation in state ${record.state}`, {
        retryable: false,
      });
    }

    // Check budget enforcement
    const budgetStatus = this.budgetEnforcer.evaluate(
      record.ru_allocated,
      record.ru_consumed + consumption.ru,
      record.agent_id,
    );

    if (budgetStatus.level === 'force_terminate' || budgetStatus.level === 'exhausted') {
      return err(KER.BUDGET_EXCEEDED, 'Budget exhausted — allocation terminated', {
        retryable: false,
        details: { budgetStatus },
      });
    }

    // Update consumption
    const updated: AllocationRecord = {
      ...record,
      ru_consumed: record.ru_consumed + consumption.ru,
      mu_consumed: record.mu_consumed + consumption.mu,
      eu_consumed: record.eu_consumed + consumption.eu,
      vu_consumed: record.vu_consumed + consumption.vu,
      updated_at: new Date().toISOString() as ISO8601,
    };

    // Check per-agent conservation (consumed <= allocated)
    const conservationCheck = this.conservationEnforcer.checkAllocation(updated);
    if (!conservationCheck.valid) {
      return err(KER.BUDGET_EXCEEDED, 'Consumption exceeds allocation', {
        retryable: false,
        details: { violations: conservationCheck.violations },
      });
    }

    this.allocations.set(allocationId as string, updated);
    return ok(updated);
  }

  // ─── Queries ────────────────────────────────────────────────────────

  getAllocation(allocationId: AllocationID): AllocationRecord | undefined {
    return this.allocations.get(allocationId as string);
  }

  getActiveAllocations(): AllocationRecord[] {
    return [...this.allocations.values()].filter(
      (a) => a.state === AllocationState.ACTIVE || a.state === AllocationState.THROTTLED,
    );
  }

  getActiveAllocationsForAgent(agentId: AgentID): AllocationRecord[] {
    return this.getActiveAllocations().filter((a) => a.agent_id === agentId);
  }

  getAllocationsForWorkspace(workspaceId: WorkspaceID): AllocationRecord[] {
    return [...this.allocations.values()].filter((a) => a.workspace_id === workspaceId);
  }

  getTotalAllocated(): ResourceBudget {
    const active = this.getActiveAllocations();
    return {
      ru: active.reduce((sum, a) => sum + a.ru_allocated, 0),
      mu: active.reduce((sum, a) => sum + a.mu_allocated, 0),
      eu: active.reduce((sum, a) => sum + a.eu_allocated, 0),
      vu: active.reduce((sum, a) => sum + a.vu_allocated, 0),
    };
  }

  getTotalConsumed(): ResourceBudget {
    const active = this.getActiveAllocations();
    return {
      ru: active.reduce((sum, a) => sum + a.ru_consumed, 0),
      mu: active.reduce((sum, a) => sum + a.mu_consumed, 0),
      eu: active.reduce((sum, a) => sum + a.eu_consumed, 0),
      vu: active.reduce((sum, a) => sum + a.vu_consumed, 0),
    };
  }

  getAvailableCapacity(): ResourceBudget {
    const allocated = this.getTotalAllocated();
    return {
      ru: this.config.totalCapacity.ru - allocated.ru,
      mu: this.config.totalCapacity.mu - allocated.mu,
      eu: this.config.totalCapacity.eu - allocated.eu,
      vu: this.config.totalCapacity.vu - allocated.vu,
    };
  }

  // ─── Conservation Check ──────────────────────────────────────────────

  /**
   * Verify all conservation laws hold.
   */
  verifyConservation(): ConservationResult {
    const allRecords = [...this.allocations.values()];
    return this.conservationEnforcer.enforce(allRecords, this.config.totalCapacity);
  }

  // ─── Subsystem Access ────────────────────────────────────────────────

  getQuotaEngine(): QuotaEngine { return this.quotaEngine; }
  getPreemptionEngine(): PreemptionEngine { return this.preemptionEngine; }
  getThrottleEngine(): ThrottleEngine { return this.throttleEngine; }
  getFairnessEngine(): FairnessEngine { return this.fairnessEngine; }
  getBudgetEnforcer(): BudgetEnforcer { return this.budgetEnforcer; }
  getConservationEnforcer(): ConservationEnforcer { return this.conservationEnforcer; }

  // ─── Private Helpers ────────────────────────────────────────────────

  private getAgentUsage(agentId: AgentID): AgentUsage {
    const active = this.getActiveAllocationsForAgent(agentId);
    return {
      ru_this_hour: active.reduce((sum, a) => sum + a.ru_consumed, 0),
      mu_current: active.reduce((sum, a) => sum + a.mu_consumed, 0),
      eu_this_hour: active.reduce((sum, a) => sum + a.eu_consumed, 0),
      vu_this_hour: active.reduce((sum, a) => sum + a.vu_consumed, 0),
      ru_total: active.reduce((sum, a) => sum + a.ru_consumed, 0),
      eu_total: active.reduce((sum, a) => sum + a.eu_consumed, 0),
      current_rpm: 0,
      concurrent_tasks: active.length,
    };
  }

  private getWorkspaceUsage(workspaceId: WorkspaceID): WorkspaceUsage {
    const wsAllocs = this.getAllocationsForWorkspace(workspaceId);
    const active = wsAllocs.filter(a => a.state === AllocationState.ACTIVE || a.state === AllocationState.THROTTLED);
    return {
      agent_count: new Set(active.map(a => a.agent_id)).size,
      task_count: active.length,
      memory_entries: 0,
      ru_this_hour: active.reduce((sum, a) => sum + a.ru_consumed, 0),
      mu_current: active.reduce((sum, a) => sum + a.mu_consumed, 0),
      eu_this_hour: active.reduce((sum, a) => sum + a.eu_consumed, 0),
      vu_this_hour: active.reduce((sum, a) => sum + a.vu_consumed, 0),
      ru_monthly: 0,
      eu_monthly: 0,
    };
  }

  private getDefaultUsage(): UserUsage {
    return {
      workspace_count: 0,
      agent_count: 0,
      ru_today: 0,
      eu_today: 0,
    };
  }

  private getDefaultEnterpriseUsage(): EnterpriseUsage {
    const allActive = this.getActiveAllocations();
    return {
      user_count: new Set(allActive.map(a => a.agent_id)).size,
      workspace_count: new Set(allActive.map(a => a.workspace_id)).size,
      ru_this_month: allActive.reduce((sum, a) => sum + a.ru_consumed, 0),
      mu_current: allActive.reduce((sum, a) => sum + a.mu_consumed, 0),
      eu_this_month: allActive.reduce((sum, a) => sum + a.eu_consumed, 0),
      vu_this_month: allActive.reduce((sum, a) => sum + a.vu_consumed, 0),
    };
  }
}