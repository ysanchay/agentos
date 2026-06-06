/**
 * @agentos/kernel — Task State Machine
 * 9 states, 17 transitions from the constitution.
 * ZERO AI logic — all transitions are deterministic based on explicit inputs and guards.
 */

import { TaskState, KER, MAX_TASK_RETRIES } from '@agentos/types';
import type { Outcome } from '@agentos/types';
import { ok, err } from '@agentos/types';
import { GenericStateMachine, type TransitionDef } from './state-machine.js';

// ─── Task Transition Context ─────────────────────────────────────────

export interface TaskTransitionContext {
  fullyDefined?: boolean;
  depsValid?: boolean;
  creatorHasPermission?: boolean;
  claimAccepted?: boolean;
  goalCancelled?: boolean;
  workStarted?: boolean;
  claimTimeout?: boolean;
  claimReleased?: boolean;
  missingDependency?: boolean;
  resultSubmitted?: boolean;
  resultAccepted?: boolean;
  unrecoverableFailure?: boolean;
  blockerResolved?: boolean;
  blockerUnresolvable?: boolean;
  agentGivesUp?: boolean;
  validatorApproves?: boolean;
  validatorRejects?: boolean;
  retryCount?: number;
  maxRetries?: number;
  retryApproved?: boolean;
}

// ─── Task State Machine ──────────────────────────────────────────────

export class TaskStateMachine {
  private machine: GenericStateMachine<TaskState, TaskTransitionContext>;
  private retryCount: number = 0;

  constructor(
    initialRetryCount: number = 0,
    onTransition?: (from: TaskState, to: TaskState, ctx?: TaskTransitionContext) => void,
  ) {
    this.retryCount = initialRetryCount;

    const self = this;

    const transitions: TransitionDef<TaskState, TaskTransitionContext>[] = [
      // draft -> announced: fully defined, deps valid, creator has permission
      {
        from: TaskState.DRAFT,
        to: TaskState.ANNOUNCED,
        guard: (ctx) =>
          ctx?.fullyDefined === true &&
          ctx?.depsValid === true &&
          ctx?.creatorHasPermission === true,
      },
      // draft -> cancelled: goal cancelled
      {
        from: TaskState.DRAFT,
        to: TaskState.CANCELLED,
        guard: (ctx) => ctx?.goalCancelled === true,
      },
      // announced -> claimed: claim accepted
      {
        from: TaskState.ANNOUNCED,
        to: TaskState.CLAIMED,
        guard: (ctx) => ctx?.claimAccepted === true,
      },
      // announced -> cancelled: goal cancelled
      {
        from: TaskState.ANNOUNCED,
        to: TaskState.CANCELLED,
        guard: (ctx) => ctx?.goalCancelled === true,
      },
      // claimed -> in_progress: work starts within CLAIM_TIMEOUT
      {
        from: TaskState.CLAIMED,
        to: TaskState.IN_PROGRESS,
        guard: (ctx) => ctx?.workStarted === true,
      },
      // claimed -> announced: claim released (voluntary/timeout)
      {
        from: TaskState.CLAIMED,
        to: TaskState.ANNOUNCED,
        guard: (ctx) => ctx?.claimReleased === true || ctx?.claimTimeout === true,
      },
      // claimed -> cancelled
      {
        from: TaskState.CLAIMED,
        to: TaskState.CANCELLED,
        guard: (ctx) => ctx?.goalCancelled === true,
      },
      // in_progress -> blocked: missing dependency
      {
        from: TaskState.IN_PROGRESS,
        to: TaskState.BLOCKED,
        guard: (ctx) => ctx?.missingDependency === true,
      },
      // in_progress -> review: result submitted
      {
        from: TaskState.IN_PROGRESS,
        to: TaskState.REVIEW,
        guard: (ctx) => ctx?.resultSubmitted === true,
      },
      // in_progress -> completed: result accepted (auto-accept path)
      {
        from: TaskState.IN_PROGRESS,
        to: TaskState.COMPLETED,
        guard: (ctx) => ctx?.resultAccepted === true,
      },
      // in_progress -> failed: unrecoverable failure
      {
        from: TaskState.IN_PROGRESS,
        to: TaskState.FAILED,
        guard: (ctx) => ctx?.unrecoverableFailure === true,
        sideEffect: () => { self.retryCount++; },
      },
      // blocked -> in_progress: blocker resolved
      {
        from: TaskState.BLOCKED,
        to: TaskState.IN_PROGRESS,
        guard: (ctx) => ctx?.blockerResolved === true,
      },
      // blocked -> failed: blocker unresolvable
      {
        from: TaskState.BLOCKED,
        to: TaskState.FAILED,
        guard: (ctx) => ctx?.blockerUnresolvable === true,
        sideEffect: () => { self.retryCount++; },
      },
      // blocked -> announced: agent gives up
      {
        from: TaskState.BLOCKED,
        to: TaskState.ANNOUNCED,
        guard: (ctx) => ctx?.agentGivesUp === true,
      },
      // review -> completed: validator approves
      {
        from: TaskState.REVIEW,
        to: TaskState.COMPLETED,
        guard: (ctx) => ctx?.validatorApproves === true,
      },
      // review -> failed: validator rejects; if retry_count < max_retries -> announced
      {
        from: TaskState.REVIEW,
        to: TaskState.FAILED,
        guard: (ctx) => ctx?.validatorRejects === true,
        sideEffect: () => { self.retryCount++; },
      },
      // failed -> announced: retry_count < max_retries AND retry approved
      {
        from: TaskState.FAILED,
        to: TaskState.ANNOUNCED,
        guard: (ctx) => {
          const rc = ctx?.retryCount ?? self.retryCount;
          const mr = ctx?.maxRetries ?? MAX_TASK_RETRIES;
          return rc < mr && ctx?.retryApproved === true;
        },
      },
    ];

    this.machine = new GenericStateMachine(
      TaskState.DRAFT,
      transitions,
      [TaskState.COMPLETED, TaskState.CANCELLED],
      onTransition,
    );
  }

  /** Attempt a state transition. */
  transition(from: TaskState, to: TaskState, ctx?: TaskTransitionContext): Outcome<TaskState> {
    // For failed state, check if it should be terminal (max retries exhausted)
    if (to === TaskState.FAILED) {
      const mr = ctx?.maxRetries ?? MAX_TASK_RETRIES;
      const nextRetryCount = this.retryCount + 1;
      if (nextRetryCount >= mr) {
        // This will be the terminal failed state
        const result = this.machine.transition(from, to, ctx);
        if (result.ok) {
          // Mark as terminal by re-creating with failed as terminal
          // We handle this by checking retry count externally
        }
        return result;
      }
    }

    return this.machine.transition(from, to, ctx);
  }

  /** Check if a transition is possible. */
  canTransition(from: TaskState, to: TaskState, ctx?: TaskTransitionContext): boolean {
    return this.machine.canTransition(from, to, ctx);
  }

  /** Get the current task state. */
  getCurrentState(): TaskState {
    return this.machine.getCurrentState();
  }

  /** Get transition history. */
  getHistory() {
    return this.machine.getHistory();
  }

  /** Get the current retry count. */
  getRetryCount(): number {
    return this.retryCount;
  }

  /** Check if the task is in a terminal state. */
  isTerminal(): boolean {
    const state = this.machine.getCurrentState();
    if (state === TaskState.COMPLETED || state === TaskState.CANCELLED) return true;
    // Failed is terminal when max retries exhausted
    if (state === TaskState.FAILED && this.retryCount >= MAX_TASK_RETRIES) return true;
    return false;
  }

  /** Reset the state machine. */
  reset(): void {
    this.machine.reset(TaskState.DRAFT);
    this.retryCount = 0;
  }
}