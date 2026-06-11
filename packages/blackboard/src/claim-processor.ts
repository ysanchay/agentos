/**
 * @agentos/blackboard — Claim Processor
 * Implements the 5-step atomic claim process from blackboard-protocol Article III:
 * 1. Verify task is in "announced" state
 * 2. Verify agent has required capabilities
 * 3. Verify resources are available
 * 4. If all pass: transition to "claimed", set owner
 * 5. If any fail: return claim.rejected with reason
 */

import type {
  AgentID,
  TaskID,
  Outcome,
  BlackboardTask,
  ResourceBudget,
} from '@agentos/types';
import { ok, err, BB_E, TaskState, budgetGTE } from '@agentos/types';

// ─── Types ─────────────────────────────────────────────────────────────

export interface ClaimEntry {
  task_id: TaskID;
  agent_id: AgentID;
  claimed_at: string;
  expires_at: string;
  status: 'active' | 'released' | 'overridden' | 'expired';
}

export interface AgentProfile {
  id: AgentID;
  capabilities: string[];
  available_resources: ResourceBudget;
  role: 'worker' | 'manager' | 'chief';
}

export type ClaimRejectionReason =
  | 'task-not-found'
  | 'task-not-announced'
  | 'agent-lacks-capabilities'
  | 'resources-unavailable'
  | 'task-already-claimed';

// ─── ClaimProcessor ──────────────────────────────────────────────────

export class ClaimProcessor {
  private claims: Map<TaskID, ClaimEntry> = new Map();
  private claimTimeoutMs: number;

  constructor(claimTimeoutMs: number = 60_000) {
    this.claimTimeoutMs = claimTimeoutMs;
  }

  /**
   * Execute the 5-step atomic claim process.
   *
   * Step 1: Verify task is in "announced" state
   * Step 2: Verify agent has required capabilities
   * Step 3: Verify resources are available
   * Step 4: If all pass, transition task to "claimed" and set owner
   * Step 5: If any fail, return rejected with reason
   */
  processClaim(
    task: BlackboardTask | undefined,
    agent: AgentProfile,
    now: string = new Date().toISOString(),
  ): Outcome<ClaimEntry> {
    // Step 1: Verify task exists and is in "announced" state
    if (!task) {
      return err(BB_E.TASK_NOT_FOUND, 'Task not found', { retryable: false });
    }

    if (task.state !== TaskState.ANNOUNCED) {
      return err(BB_E.TASK_NOT_CLAIMABLE, `Task is in '${task.state}' state, expected 'announced'`, {
        retryable: false,
        details: { current_state: task.state, required_state: TaskState.ANNOUNCED },
      });
    }

    // Step 2: Verify agent has required capabilities
    const requiredCapabilities = task.tags.filter((t) => t.startsWith('capability:'));
    const hasCapabilities = requiredCapabilities.every(
      (cap) => agent.capabilities.includes(cap.replace('capability:', '')),
    );

    if (!hasCapabilities) {
      const missing = requiredCapabilities.filter(
        (cap) => !agent.capabilities.includes(cap.replace('capability:', '')),
      );
      return err(BB_E.AGENT_LACKS_CAPABILITIES, `Agent lacks required capabilities: ${missing.join(', ')}`, {
        retryable: false,
        details: { required: requiredCapabilities, available: agent.capabilities },
      });
    }

    // Step 3: Verify resources are available
    if (!budgetGTE(agent.available_resources, task.resources_required)) {
      return err(BB_E.RESOURCES_UNAVAILABLE, 'Agent does not have sufficient resources', {
        retryable: false,
        details: {
          required: task.resources_required,
          available: agent.available_resources,
        },
      });
    }

    // Step 4: All checks passed — create claim entry
    const claimedAt = now;
    const expiresAt = new Date(new Date(claimedAt).getTime() + this.claimTimeoutMs).toISOString();

    const claim: ClaimEntry = {
      task_id: task.id,
      agent_id: agent.id,
      claimed_at: claimedAt,
      expires_at: expiresAt,
      status: 'active',
    };

    this.claims.set(task.id, claim);

    return ok(claim);
  }

  /**
   * Release a claim on a task.
   */
  releaseClaim(taskId: TaskID, agentId: AgentID, reason: string): Outcome<true> {
    const claim = this.claims.get(taskId);
    if (!claim) {
      return err(BB_E.TASK_NOT_FOUND, 'No active claim found for task', { retryable: false });
    }

    if (claim.agent_id !== agentId) {
      return err(BB_E.CLAIM_CONFLICT, 'Agent does not own this claim', { retryable: false });
    }

    claim.status = 'released';
    this.claims.delete(taskId);

    return ok(true);
  }

  /**
   * Override a claim (Chief/Manager authority).
   */
  overrideClaim(taskId: TaskID, chiefId: AgentID, now: string = new Date().toISOString()): Outcome<ClaimEntry> {
    const claim = this.claims.get(taskId);
    if (!claim) {
      return err(BB_E.TASK_NOT_FOUND, 'No active claim found for task', { retryable: false });
    }

    // Mark old claim as overridden
    claim.status = 'overridden';

    // Create new claim for chief
    const expiresAt = new Date(new Date(now).getTime() + this.claimTimeoutMs).toISOString();
    const newClaim: ClaimEntry = {
      task_id: taskId,
      agent_id: chiefId,
      claimed_at: now,
      expires_at: expiresAt,
      status: 'active',
    };

    this.claims.set(taskId, newClaim);

    return ok(newClaim);
  }

  /**
   * Get the claim for a task.
   */
  getClaim(taskId: TaskID): ClaimEntry | undefined {
    return this.claims.get(taskId);
  }

  /**
   * Get all claims held by a specific agent.
   */
  getClaimsByAgent(agentId: AgentID): ClaimEntry[] {
    return [...this.claims.values()].filter((c) => c.agent_id === agentId && c.status === 'active');
  }

  /**
   * Check if a task is currently claimed.
   */
  isClaimed(taskId: TaskID): boolean {
    const claim = this.claims.get(taskId);
    return claim !== undefined && claim.status === 'active';
  }

  /**
   * Check for and expire stale claims.
   */
  expireStaleClaims(now: string = new Date().toISOString()): TaskID[] {
    const expired: TaskID[] = [];
    for (const [taskId, claim] of this.claims) {
      if (claim.status === 'active' && claim.expires_at <= now) {
        claim.status = 'expired';
        this.claims.delete(taskId);
        expired.push(taskId);
      }
    }
    return expired;
  }
}