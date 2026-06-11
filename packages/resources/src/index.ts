/**
 * @agentos/resources — Resource Management for AgentOS
 * ZERO AI logic — deterministic resource scheduling only.
 */

// Main scheduler
export { ResourceScheduler, type SchedulerConfig } from './scheduler.js';
export type { ConservationResult, ConservationViolation } from './conservation.js';

// Allocation state machine
export { AllocationStateMachine, type AllocationRecord } from './allocator.js';

// Quota engine
export { QuotaEngine, type QuotaCheckResult, type UsageSnapshot, type AgentUsage, type WorkspaceUsage, type UserUsage, type EnterpriseUsage } from './quota-engine.js';

// Preemption
export { PreemptionEngine, type PreemptionResult, type PreemptionCandidate } from './preemption-engine.js';

// Throttle
export { ThrottleEngine, ThrottleLevel, type ThrottleState, type ThrottleDecision } from './throttle-engine.js';

// Fairness
export { FairnessEngine, type WaitEntry, type FairShareAllocation, type PriorityInversionRecord, type BurstState } from './fairness-engine.js';

// Budget enforcer
export { BudgetEnforcer, BudgetLevel, type BudgetStatus, type SoftOffense } from './budget-enforcer.js';

// Conservation
export { ConservationEnforcer } from './conservation.js';

// Efficiency scorer
export { EfficiencyScorer, type EfficiencyMetrics } from './efficiency-scorer.js';

// Anomaly detector
export { AnomalyDetector, type AnomalyEvent, type AnomalyDetectorConfig } from './anomaly-detector.js';

// Token bucket
export { TokenBucket, type TokenBucketConfig } from './token-bucket.js';