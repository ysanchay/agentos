/**
 * @agentos/blackboard — Shared Coordination Layer
 * Where agents claim tasks, publish results, and resolve conflicts.
 */

// Main Blackboard class
export { Blackboard } from './blackboard.js';
export type { ErrorEntry, ValidationResult } from './blackboard.js';

// Claim Processor
export { ClaimProcessor } from './claim-processor.js';
export type { ClaimEntry, AgentProfile, ClaimRejectionReason } from './claim-processor.js';

// Lock Manager
export { LockManager } from './lock-manager.js';
export type { LockEntry, LockWaiter } from './lock-manager.js';

// Deadlock Detector
export { DeadlockDetector } from './deadlock-detector.js';
export type { DeadlockInfo, AgentPriority } from './deadlock-detector.js';

// Conflict Resolver
export { ConflictResolver } from './conflict-resolver.js';
export type { ConflictVote, ConflictState, MergeResult } from './conflict-resolver.js';

// Audit Chain
export { AuditChain } from './audit-chain.js';
export type { AuditEntry } from './audit-chain.js';