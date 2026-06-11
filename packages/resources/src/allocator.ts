/**
 * @agentos/resources — Allocation State Machine
 * 8 states, 16 transitions from resource-model-v1.md Section 3.3.
 */

import type {
  AllocationID,
  AgentID,
  TaskID,
  WorkspaceID,
  Priority,
  ISO8601,
  Outcome,
} from '@agentos/types';
import { AllocationState, ALLOCATION_TERMINAL_STATES, ok, err, KER } from '@agentos/types';

// ─── Transition Table ────────────────────────────────────────────────

const VALID_TRANSITIONS: Map<AllocationState, AllocationState[]> = new Map([
  [AllocationState.PENDING, [AllocationState.GRANTED, AllocationState.REVOKED]],
  [AllocationState.GRANTED, [AllocationState.ACTIVE, AllocationState.EXPIRED]],
  [AllocationState.ACTIVE, [
    AllocationState.THROTTLED,
    AllocationState.PREEMPTED,
    AllocationState.RELEASED,
    AllocationState.EXPIRED,
    AllocationState.REVOKED,
  ]],
  [AllocationState.THROTTLED, [
    AllocationState.ACTIVE,
    AllocationState.PREEMPTED,
    AllocationState.RELEASED,
  ]],
  [AllocationState.PREEMPTED, [AllocationState.PENDING]],
  // Terminal states have no outgoing transitions
  [AllocationState.RELEASED, []],
  [AllocationState.EXPIRED, []],
  [AllocationState.REVOKED, []],
]);

// ─── Local Allocation Record ─────────────────────────────────────────

export interface AllocationRecord {
  id: AllocationID;
  agent_id: AgentID;
  task_id?: TaskID;
  workspace_id: WorkspaceID;
  state: AllocationState;
  priority: Priority;
  preemptible: boolean;
  ru_allocated: number;
  mu_allocated: number;
  eu_allocated: number;
  vu_allocated: number;
  ru_consumed: number;
  mu_consumed: number;
  eu_consumed: number;
  vu_consumed: number;
  granted_at?: ISO8601;
  expires_at?: ISO8601;
  released_at?: ISO8601;
  created_at: ISO8601;
  updated_at: ISO8601;
  /** Timestamp when the allocation became active (for MIN_RUNTIME immunity) */
  active_since?: ISO8601;
  /** Number of times this allocation has been preempted */
  preemption_count: number;
  /** Current throttle level (0 = none, 1-4 = mild/moderate/severe/critical) */
  throttle_level: number;
  /** Throttle expiry timestamp */
  throttle_until?: ISO8601;
}

// ─── AllocationStateMachine ───────────────────────────────────────────

export class AllocationStateMachine {
  /**
   * Attempt to transition an allocation to a new state.
   * Returns the updated record on success, or an error on invalid transition.
   */
  transition(record: AllocationRecord, newState: AllocationState): Outcome<AllocationRecord> {
    // Cannot transition from terminal states
    if (this.isTerminal(record.state)) {
      return err(
        KER.INVALID_STATE_TRANSITION,
        `Cannot transition from terminal state ${record.state} to ${newState}`,
      );
    }

    const allowed = VALID_TRANSITIONS.get(record.state);
    if (!allowed || !allowed.includes(newState)) {
      return err(
        KER.INVALID_STATE_TRANSITION,
        `Invalid transition: ${record.state} -> ${newState}`,
      );
    }

    const now = new Date().toISOString() as ISO8601;
    const updated: AllocationRecord = {
      ...record,
      state: newState,
      updated_at: now,
    };

    // Set state-specific timestamps
    switch (newState) {
      case AllocationState.GRANTED:
        updated.granted_at = now;
        break;
      case AllocationState.ACTIVE:
        updated.active_since = now;
        break;
      case AllocationState.RELEASED:
        updated.released_at = now;
        break;
      case AllocationState.PREEMPTED:
        updated.preemption_count = (record.preemption_count ?? 0) + 1;
        break;
      case AllocationState.THROTTLED:
        // throttle_level and throttle_until set externally
        break;
    }

    return ok(updated);
  }

  /** Check if a state is terminal */
  isTerminal(state: AllocationState): boolean {
    return ALLOCATION_TERMINAL_STATES.includes(state);
  }

  /** Get valid transitions from a given state */
  getValidTransitions(state: AllocationState): AllocationState[] {
    if (this.isTerminal(state)) return [];
    return VALID_TRANSITIONS.get(state) ?? [];
  }

  /** Create a new allocation record in PENDING state */
  createPending(
    id: AllocationID,
    agentId: AgentID,
    workspaceId: WorkspaceID,
    priority: Priority,
    preemptible: boolean,
    ru: number,
    mu: number,
    eu: number,
    vu: number,
    opts?: { taskId?: TaskID; expiresAt?: ISO8601 },
  ): AllocationRecord {
    const now = new Date().toISOString() as ISO8601;
    return {
      id,
      agent_id: agentId,
      task_id: opts?.taskId,
      workspace_id: workspaceId,
      state: AllocationState.PENDING,
      priority,
      preemptible,
      ru_allocated: ru,
      mu_allocated: mu,
      eu_allocated: eu,
      vu_allocated: vu,
      ru_consumed: 0,
      mu_consumed: 0,
      eu_consumed: 0,
      vu_consumed: 0,
      expires_at: opts?.expiresAt,
      created_at: now,
      updated_at: now,
      preemption_count: 0,
      throttle_level: 0,
    };
  }
}