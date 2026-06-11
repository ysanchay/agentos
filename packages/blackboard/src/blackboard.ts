/**
 * @agentos/blackboard — Main Blackboard Class
 * The central coordination structure with 7 sections:
 * goals, tasks, claims, results, context, consensus, errors
 *
 * From blackboard-protocol Articles I-IX.
 */

import type {
  AgentID,
  TaskID,
  WorkspaceID,
  Outcome,
  BlackboardTask,
  GoalEntry,
  SharedContext,
  ConsensusRecord,
  ConsensusStrategy,
  ConflictStrategy,
  LockType,
  TaskResult,
  ConsensusID,
  ResourceBudget,
} from '@agentos/types';
import {
  ok,
  err,
  BB_E,
  TaskState,
  CLAIM_TIMEOUT_MS,
  MAX_LOCK_DURATION_MS,
  createUUID,
  budgetGTE,
} from '@agentos/types';
import { ClaimProcessor, type ClaimEntry, type AgentProfile } from './claim-processor.js';
import { LockManager, type LockEntry } from './lock-manager.js';
import { DeadlockDetector, type DeadlockInfo } from './deadlock-detector.js';
import { ConflictResolver } from './conflict-resolver.js';
import { AuditChain, type AuditEntry } from './audit-chain.js';

// ─── Blackboard-Local Types ───────────────────────────────────────────

export interface ErrorEntry {
  id: string;
  task_id?: TaskID;
  agent_id: AgentID;
  error_code: string;
  error_message: string;
  timestamp: string;
}

export interface ValidationResult {
  task_id: TaskID;
  validator_id: AgentID;
  approved: boolean;
  reason?: string;
  validated_at: string;
}

// ─── Blackboard ────────────────────────────────────────────────────────

export class Blackboard {
  private workspaceId: WorkspaceID;
  private goals: Map<string, GoalEntry> = new Map();
  private tasks: Map<string, BlackboardTask> = new Map();
  private claims: Map<string, ClaimEntry> = new Map();
  private results: Map<string, TaskResult[]> = new Map();
  private context: Map<string, SharedContext> = new Map();
  private consensus: Map<string, ConsensusRecord> = new Map();
  private errors: Map<string, ErrorEntry> = new Map();
  private validations: Map<string, ValidationResult[]> = new Map();

  // Subsystems
  private claimProcessor: ClaimProcessor;
  private lockManager: LockManager;
  private deadlockDetector: DeadlockDetector;
  private conflictResolver: ConflictResolver;
  private auditChain: AuditChain;

  constructor(workspaceId: WorkspaceID) {
    this.workspaceId = workspaceId;
    this.claimProcessor = new ClaimProcessor(CLAIM_TIMEOUT_MS);
    this.lockManager = new LockManager(MAX_LOCK_DURATION_MS);
    this.deadlockDetector = new DeadlockDetector();
    this.conflictResolver = new ConflictResolver();
    this.auditChain = new AuditChain();
  }

  // ─── Task Operations ──────────────────────────────────────────────

  /**
   * Publish a task to the blackboard.
   * Task must be in DRAFT or ANNOUNCED state.
   */
  publishTask(task: BlackboardTask): Outcome<BlackboardTask> {
    if (this.tasks.has(task.id)) {
      return err(BB_E.VALIDATION_FAILED, `Task ${task.id} already exists`, {
        retryable: false,
      });
    }

    // Store the task
    this.tasks.set(task.id, { ...task });

    // Audit
    this.auditChain.append({
      agent_id: task.owner ?? ('system' as unknown as AgentID),
      action: 'publish_task',
      target: task.id,
      previous_value: null,
      new_value: task,
    });

    return ok(task);
  }

  /**
   * Claim a task — the critical 5-step atomic claim process.
   * This is the key correctness property: zero double-claims.
   */
  claimTask(taskId: TaskID, agentId: AgentID, agentProfile?: AgentProfile): Outcome<ClaimEntry> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return err(BB_E.TASK_NOT_FOUND, `Task ${taskId} not found`, {
        retryable: false,
      });
    }

    // Check if already claimed by another agent
    const existingClaim = this.claims.get(taskId);
    if (existingClaim && existingClaim.status === 'active') {
      return err(BB_E.CLAIM_CONFLICT, `Task ${taskId} is already claimed by ${existingClaim.agent_id}`, {
        retryable: false,
      });
    }

    // Build agent profile if not provided
    const profile: AgentProfile = agentProfile ?? {
      id: agentId,
      capabilities: [],
      available_resources: { ru: Infinity, mu: Infinity, eu: Infinity, vu: Infinity },
      role: 'worker',
    };

    // Use the claim processor for 5-step atomic claim
    const result = this.claimProcessor.processClaim(task, profile);

    if (!result.ok) {
      return result;
    }

    // Update task state to claimed
    const updatedTask: BlackboardTask = {
      ...task,
      state: TaskState.CLAIMED,
      owner: agentId,
      owner_since: result.data.claimed_at,
      updated_at: new Date().toISOString(),
    };
    this.tasks.set(taskId, updatedTask);

    // Store the claim
    this.claims.set(taskId, result.data);

    // Audit
    this.auditChain.append({
      agent_id: agentId,
      action: 'claim_task',
      target: taskId,
      previous_value: { state: task.state, owner: task.owner },
      new_value: { state: TaskState.CLAIMED, owner: agentId },
    });

    return result;
  }

  /**
   * Release a claim on a task.
   */
  releaseClaim(taskId: TaskID, agentId: AgentID, reason: string): Outcome<true> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return err(BB_E.TASK_NOT_FOUND, `Task ${taskId} not found`, {
        retryable: false,
      });
    }

    const result = this.claimProcessor.releaseClaim(taskId, agentId, reason);
    if (!result.ok) {
      return result;
    }

    // Transition task back to announced
    const previousOwner = {
      agent_id: agentId,
      claimed_at: task.owner_since ?? task.updated_at,
      released_at: new Date().toISOString(),
      reason,
    };

    const updatedTask: BlackboardTask = {
      ...task,
      state: TaskState.ANNOUNCED,
      owner: undefined,
      owner_since: undefined,
      previous_owners: [...task.previous_owners, previousOwner],
      updated_at: new Date().toISOString(),
    };
    this.tasks.set(taskId, updatedTask);

    // Remove claim
    this.claims.delete(taskId);

    // Audit
    this.auditChain.append({
      agent_id: agentId,
      action: 'release_claim',
      target: taskId,
      previous_value: { state: TaskState.CLAIMED, owner: agentId },
      new_value: { state: TaskState.ANNOUNCED, owner: null, reason },
    });

    return ok(true);
  }

  /**
   * Override a claim — Chief/Manager authority.
   */
  overrideClaim(taskId: TaskID, chiefId: AgentID): Outcome<ClaimEntry> {
    const task = this.tasks.get(taskId);
    if (!task) {
      return err(BB_E.TASK_NOT_FOUND, `Task ${taskId} not found`, {
        retryable: false,
      });
    }

    const previousOwner = task.owner;
    const result = this.claimProcessor.overrideClaim(taskId, chiefId);
    if (!result.ok) {
      return result;
    }

    // Update task
    const updatedTask: BlackboardTask = {
      ...task,
      owner: chiefId,
      owner_since: result.data.claimed_at,
      previous_owners: previousOwner
        ? [...task.previous_owners, {
            agent_id: previousOwner,
            claimed_at: task.owner_since ?? task.updated_at,
            released_at: new Date().toISOString(),
            reason: 'chief_override',
          }]
        : task.previous_owners,
      updated_at: new Date().toISOString(),
    };
    this.tasks.set(taskId, updatedTask);
    this.claims.set(taskId, result.data);

    // Audit
    this.auditChain.append({
      agent_id: chiefId,
      action: 'override_claim',
      target: taskId,
      previous_value: { owner: previousOwner },
      new_value: { owner: chiefId },
    });

    return result;
  }

  // ─── Result Operations ────────────────────────────────────────────

  /**
   * Submit a result for a task.
   */
  submitResult(result: TaskResult): Outcome<true> {
    const task = this.tasks.get(result.task_id);
    if (!task) {
      return err(BB_E.TASK_NOT_FOUND, `Task ${result.task_id} not found`, {
        retryable: false,
      });
    }

    // Store the result
    const existingResults = this.results.get(result.task_id) ?? [];
    existingResults.push(result);
    this.results.set(result.task_id, existingResults);

    // If multiple results, this is a conflict
    if (existingResults.length > 1) {
      this.conflictResolver.registerConflict(
        result.task_id,
        existingResults,
        'first-wins',
      );
    }

    // Audit
    this.auditChain.append({
      agent_id: result.agent_id,
      action: 'submit_result',
      target: result.task_id,
      previous_value: null,
      new_value: { confidence: result.confidence, duration_ms: result.duration_ms },
    });

    return ok(true);
  }

  /**
   * Validate a result for a task.
   */
  validateResult(taskId: TaskID, validatorId: AgentID, approved: boolean, reason?: string): Outcome<true> {
    const results = this.results.get(taskId);
    if (!results || results.length === 0) {
      return err(BB_E.VALIDATION_FAILED, `No results found for task ${taskId}`, {
        retryable: false,
      });
    }

    const validation: ValidationResult = {
      task_id: taskId,
      validator_id: validatorId,
      approved,
      reason,
      validated_at: new Date().toISOString(),
    };

    const validations = this.validations.get(taskId) ?? [];
    validations.push(validation);
    this.validations.set(taskId, validations);

    // If approved, transition task to completed
    if (approved) {
      const task = this.tasks.get(taskId);
      if (task) {
        const updatedTask: BlackboardTask = {
          ...task,
          state: TaskState.COMPLETED,
          result: results[results.length - 1],
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        this.tasks.set(taskId, updatedTask);
      }
    }

    // Audit
    this.auditChain.append({
      agent_id: validatorId,
      action: 'validate_result',
      target: taskId,
      previous_value: null,
      new_value: { approved, reason },
    });

    return ok(true);
  }

  // ─── Context Operations ───────────────────────────────────────────

  /**
   * Write a shared context entry.
   */
  writeContext(entry: SharedContext): Outcome<true> {
    const existing = this.context.get(entry.key);
    const version = existing ? existing.version + 1 : 1;

    this.context.set(entry.key, {
      ...entry,
      version,
      updated_at: new Date().toISOString(),
    });

    // Audit
    this.auditChain.append({
      agent_id: entry.source_agent,
      action: 'write_context',
      target: entry.key,
      previous_value: existing ?? null,
      new_value: entry,
    });

    return ok(true);
  }

  /**
   * Read a shared context entry.
   */
  readContext(key: string): SharedContext | undefined {
    const entry = this.context.get(key);

    // Check if expired
    if (entry?.expires_at && entry.expires_at <= new Date().toISOString()) {
      return undefined;
    }

    return entry;
  }

  /**
   * Delete a shared context entry (soft delete).
   */
  deleteContext(key: string): Outcome<true> {
    const existing = this.context.get(key);
    if (!existing) {
      return err(BB_E.TASK_NOT_FOUND, `Context key '${key}' not found`, {
        retryable: false,
      });
    }

    // Soft delete — set value to null but keep the entry
    this.context.set(key, {
      ...existing,
      value: null,
      updated_at: new Date().toISOString(),
    });

    // Audit
    this.auditChain.append({
      agent_id: existing.source_agent,
      action: 'delete_context',
      target: key,
      previous_value: existing.value,
      new_value: null,
    });

    return ok(true);
  }

  // ─── Consensus Operations ─────────────────────────────────────────

  /**
   * Create a consensus record.
   */
  createConsensus(record: ConsensusRecord): Outcome<ConsensusRecord> {
    if (this.consensus.has(record.id)) {
      return err(BB_E.VALIDATION_FAILED, `Consensus ${record.id} already exists`, {
        retryable: false,
      });
    }

    this.consensus.set(record.id, { ...record });

    // Audit
    this.auditChain.append({
      agent_id: record.proposer,
      action: 'create_consensus',
      target: record.id,
      previous_value: null,
      new_value: { topic: record.topic, strategy: record.strategy },
    });

    return ok(record);
  }

  /**
   * Vote on a consensus record.
   */
  vote(consensusId: string, agentId: AgentID, option: string): Outcome<true> {
    const record = this.consensus.get(consensusId);
    if (!record) {
      return err(BB_E.TASK_NOT_FOUND, `Consensus ${consensusId} not found`, {
        retryable: false,
      });
    }

    if (record.status !== 'voting') {
      return err(BB_E.VALIDATION_FAILED, `Consensus is in '${record.status}' state, expected 'voting'`, {
        retryable: false,
      });
    }

    // Check if already voted
    const alreadyVoted = record.votes.find((v) => v.agent_id === agentId);
    if (alreadyVoted) {
      return err(BB_E.VALIDATION_FAILED, 'Agent has already voted', {
        retryable: false,
      });
    }

    // Add vote
    record.votes = [
      ...record.votes,
      {
        agent_id: agentId,
        option,
        timestamp: new Date().toISOString(),
      },
    ];

    // Audit
    this.auditChain.append({
      agent_id: agentId,
      action: 'vote_consensus',
      target: consensusId,
      previous_value: null,
      new_value: { option },
    });

    return ok(true);
  }

  /**
   * Resolve a consensus record based on its strategy.
   */
  resolveConsensus(consensusId: string): Outcome<ConsensusRecord> {
    const record = this.consensus.get(consensusId);
    if (!record) {
      return err(BB_E.TASK_NOT_FOUND, `Consensus ${consensusId} not found`, {
        retryable: false,
      });
    }

    if (record.status !== 'voting') {
      return err(BB_E.VALIDATION_FAILED, `Consensus is in '${record.status}' state, expected 'voting'`, {
        retryable: false,
      });
    }

    // Count votes per option
    const voteCounts = new Map<string, number>();
    for (const vote of record.votes) {
      const count = voteCounts.get(vote.option) ?? 0;
      voteCounts.set(vote.option, count + 1);
    }

    const totalVotes = record.votes.length;
    let winner: string | undefined;

    switch (record.strategy) {
      case 'unanimous': {
        // All votes must be the same option
        const options = [...voteCounts.keys()];
        if (options.length === 1 && totalVotes > 0) {
          winner = options[0];
        }
        break;
      }
      case 'majority': {
        // >50% of votes
        const majority = Math.floor(totalVotes / 2) + 1;
        for (const [option, count] of voteCounts) {
          if (count >= majority) {
            winner = option;
            break;
          }
        }
        break;
      }
      case 'supermajority': {
        // >66% of votes
        const threshold = Math.ceil(totalVotes * (2 / 3));
        for (const [option, count] of voteCounts) {
          if (count >= threshold) {
            winner = option;
            break;
          }
        }
        break;
      }
      case 'chief-decides': {
        // The proposer decides
        const chiefVote = record.votes.find((v) => v.agent_id === record.proposer);
        winner = chiefVote?.option;
        break;
      }
      case 'weighted': {
        // For now, fall back to majority
        const majority = Math.floor(totalVotes / 2) + 1;
        for (const [option, count] of voteCounts) {
          if (count >= majority) {
            winner = option;
            break;
          }
        }
        break;
      }
    }

    if (!winner) {
      // No winner — check if past deadline
      if (record.deadline <= new Date().toISOString()) {
        record.status = 'expired';
      }
      this.consensus.set(consensusId, record);
      return err(BB_E.VALIDATION_FAILED, 'No consensus reached', {
        retryable: true,
      });
    }

    record.status = 'resolved';
    record.result = winner;
    this.consensus.set(consensusId, record);

    // Audit
    this.auditChain.append({
      agent_id: record.proposer,
      action: 'resolve_consensus',
      target: consensusId,
      previous_value: { status: 'voting' },
      new_value: { status: 'resolved', result: winner },
    });

    return ok(record);
  }

  // ─── Lock Operations ──────────────────────────────────────────────

  /**
   * Acquire a lock on a resource.
   */
  acquireLock(resourceId: string, agentId: AgentID, lockType: LockType, timeoutMs?: number): Outcome<LockEntry> {
    return this.lockManager.acquireLock(resourceId, agentId, lockType);
  }

  /**
   * Release a lock on a resource.
   */
  releaseLock(resourceId: string, agentId: AgentID): Outcome<true> {
    return this.lockManager.releaseLock(resourceId, agentId);
  }

  // ─── Deadlock Detection ───────────────────────────────────────────

  /**
   * Detect deadlocks in the current lock/wait state.
   */
  detectDeadlocks(): DeadlockInfo[] {
    const waitForGraph = this.lockManager.getWaitForGraph();
    return this.deadlockDetector.detectDeadlocks(waitForGraph);
  }

  /**
   * Resolve a detected deadlock.
   */
  resolveDeadlock(deadlock: DeadlockInfo): Outcome<true> {
    const allLocks = this.getAllActiveLocks();
    const agentPriorities = new Map<AgentID, number>();

    // Default priority for agents involved
    for (const agentId of deadlock.cycle) {
      agentPriorities.set(agentId, 5); // default low priority
    }

    const result = this.deadlockDetector.resolveDeadlock(
      deadlock,
      agentPriorities,
      allLocks,
    );

    if (!result.ok) {
      return result;
    }

    // Release the victim's locks
    const victimId = result.data;
    const victimLocks = this.lockManager.getLocksByAgent(victimId);
    for (const lock of victimLocks) {
      this.lockManager.releaseLock(lock.resource_id, lock.agent_id);
    }

    // Audit
    this.auditChain.append({
      agent_id: 'system' as unknown as AgentID,
      action: 'resolve_deadlock',
      target: deadlock.cycle.join(','),
      previous_value: null,
      new_value: { victim: victimId },
    });

    return ok(true);
  }

  // ─── Conflict Resolution ─────────────────────────────────────────

  /**
   * Resolve a conflict for a task.
   */
  resolveConflict(taskId: TaskID, strategy: ConflictStrategy): Outcome<TaskResult> {
    const results = this.results.get(taskId);
    if (!results || results.length < 2) {
      return err(BB_E.VALIDATION_FAILED, `No conflict exists for task ${taskId}`, {
        retryable: false,
      });
    }

    // Register conflict if not already registered
    if (!this.conflictResolver.getConflict(taskId)) {
      this.conflictResolver.registerConflict(taskId, results, strategy);
    }

    return this.conflictResolver.resolveConflict(taskId, strategy);
  }

  // ─── Queries ──────────────────────────────────────────────────────

  /**
   * Get available tasks that match agent capabilities.
   */
  getAvailableTasks(agentCapabilities: string[]): BlackboardTask[] {
    const available: BlackboardTask[] = [];

    for (const task of this.tasks.values()) {
      if (task.state !== TaskState.ANNOUNCED) continue;

      // Check if task has capability requirements
      const requiredCapabilities = task.tags
        .filter((t) => t.startsWith('capability:'))
        .map((t) => t.replace('capability:', ''));

      // If no capabilities required, task is available to all
      if (requiredCapabilities.length === 0) {
        available.push(task);
        continue;
      }

      // Check if agent has all required capabilities
      const hasAll = requiredCapabilities.every(
        (cap) => agentCapabilities.includes(cap),
      );
      if (hasAll) {
        available.push(task);
      }
    }

    return available;
  }

  /**
   * Get a specific task by ID.
   */
  getTask(taskId: TaskID): BlackboardTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all claims by a specific agent.
   */
  getClaimsByAgent(agentId: AgentID): ClaimEntry[] {
    return this.claimProcessor.getClaimsByAgent(agentId);
  }

  /**
   * Get the audit log.
   */
  getAuditLog(limit?: number): AuditEntry[] {
    if (limit !== undefined) {
      return this.auditChain.getRecent(limit);
    }
    return this.auditChain.getEntries();
  }

  /**
   * Verify the audit chain integrity.
   */
  verifyAuditChain(): boolean {
    const result = this.auditChain.verify();
    return result.ok;
  }

  // ─── Private Helpers ──────────────────────────────────────────────

  private getAllActiveLocks(): LockEntry[] {
    const locks: LockEntry[] = [];
    // We need to iterate all resources — use the lock manager's internal
    // access pattern. Since we don't expose a "getAllLocks" method,
    // we'll collect from the wait-for graph and known resources.
    // For now, we collect from claims as a proxy.
    for (const taskId of this.claims.keys()) {
      const taskLocks = this.lockManager.getLocks(taskId);
      locks.push(...taskLocks);
    }
    return locks;
  }
}