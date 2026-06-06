/**
 * @agentos/kernel — Agent State Machine
 * 10 states, 18 transitions from the constitution.
 * ZERO AI logic — all transitions are deterministic based on explicit inputs and guards.
 */

import { AgentState, KER, AGENT_MAX_RETRIES } from '@agentos/types';
import type { Outcome } from '@agentos/types';
import { ok, err } from '@agentos/types';
import { GenericStateMachine, type TransitionDef } from './state-machine.js';

// ─── Agent Transition Context ────────────────────────────────────────

export interface AgentTransitionContext {
  processCreated?: boolean;
  creationFailed?: boolean;
  capabilitiesLoaded?: boolean;
  crashed?: boolean;
  timedOut?: boolean;
  taskAssigned?: boolean;
  resourcesAllocated?: boolean;
  shutdownSignal?: boolean;
  pauseSignal?: boolean;
  preemption?: boolean;
  resumeSignal?: boolean;
  resourcesAvailable?: boolean;
  killSignal?: boolean;
  adminAction?: boolean;
  suspensionLifted?: boolean;
  failureCount?: number;
  budgetAllows?: boolean;
  cleanupComplete?: boolean;
}

// ─── Agent State Machine ─────────────────────────────────────────────

export class AgentStateMachine {
  private machine: GenericStateMachine<AgentState, AgentTransitionContext>;
  private failureCount: number = 0;

  constructor(onTransition?: (from: AgentState, to: AgentState, ctx?: AgentTransitionContext) => void) {
    const transitions: TransitionDef<AgentState, AgentTransitionContext>[] = [
      // spawning -> initializing: process created
      {
        from: AgentState.SPAWNING,
        to: AgentState.INITIALIZING,
        guard: (ctx) => ctx?.processCreated === true,
      },
      // spawning -> errored: creation failed
      {
        from: AgentState.SPAWNING,
        to: AgentState.ERRORED,
        guard: (ctx) => ctx?.creationFailed === true,
        sideEffect: (ctx) => { this.failureCount++; },
      },
      // initializing -> ready: capabilities loaded
      {
        from: AgentState.INITIALIZING,
        to: AgentState.READY,
        guard: (ctx) => ctx?.capabilitiesLoaded === true,
      },
      // initializing -> errored: crash/timeout
      {
        from: AgentState.INITIALIZING,
        to: AgentState.ERRORED,
        guard: (ctx) => ctx?.crashed === true || ctx?.timedOut === true,
        sideEffect: (ctx) => { this.failureCount++; },
      },
      // ready -> running: task assigned AND resources allocated
      {
        from: AgentState.READY,
        to: AgentState.RUNNING,
        guard: (ctx) => ctx?.taskAssigned === true && ctx?.resourcesAllocated === true,
      },
      // ready -> paused: (explicit transition for admin pause from ready)
      {
        from: AgentState.READY,
        to: AgentState.PAUSED,
      },
      // ready -> terminating: shutdown signal
      {
        from: AgentState.READY,
        to: AgentState.TERMINATING,
        guard: (ctx) => ctx?.shutdownSignal === true,
      },
      // running -> paused: pause signal OR preemption
      {
        from: AgentState.RUNNING,
        to: AgentState.PAUSED,
        guard: (ctx) => ctx?.pauseSignal === true || ctx?.preemption === true,
      },
      // running -> errored: unrecoverable error
      {
        from: AgentState.RUNNING,
        to: AgentState.ERRORED,
        guard: (ctx) => ctx?.crashed === true,
        sideEffect: (ctx) => { this.failureCount++; },
      },
      // running -> ready: task completed
      {
        from: AgentState.RUNNING,
        to: AgentState.READY,
        guard: (ctx) => ctx?.taskAssigned === false || ctx?.taskAssigned === undefined,
      },
      // paused -> running: resume AND resources available
      {
        from: AgentState.PAUSED,
        to: AgentState.RUNNING,
        guard: (ctx) => ctx?.resumeSignal === true && ctx?.resourcesAvailable === true,
      },
      // paused -> terminating: kill signal
      {
        from: AgentState.PAUSED,
        to: AgentState.TERMINATING,
        guard: (ctx) => ctx?.killSignal === true,
      },
      // suspended -> ready: suspension lifted
      {
        from: AgentState.SUSPENDED,
        to: AgentState.READY,
        guard: (ctx) => ctx?.suspensionLifted === true,
      },
      // suspended -> terminating (added: admin kill while suspended)
      {
        from: AgentState.SUSPENDED,
        to: AgentState.TERMINATING,
        guard: (ctx) => ctx?.killSignal === true,
      },
      // errored -> recovering: failure_count < MAX_RETRIES AND budget allows
      {
        from: AgentState.ERRORED,
        to: AgentState.RECOVERING,
        guard: (ctx) => {
          const fc = ctx?.failureCount ?? this.failureCount;
          return fc < AGENT_MAX_RETRIES && (ctx?.budgetAllows !== false);
        },
      },
      // errored -> terminating: failure_count >= MAX_RETRIES OR budget exhausted
      {
        from: AgentState.ERRORED,
        to: AgentState.TERMINATING,
        guard: (ctx) => {
          const fc = ctx?.failureCount ?? this.failureCount;
          return fc >= AGENT_MAX_RETRIES || ctx?.budgetAllows === false;
        },
      },
      // recovering -> initializing: recovery initiated
      {
        from: AgentState.RECOVERING,
        to: AgentState.INITIALIZING,
      },
      // recovering -> errored: recovery failed
      {
        from: AgentState.RECOVERING,
        to: AgentState.ERRORED,
        sideEffect: (ctx) => { this.failureCount++; },
      },
      // recovering -> terminating: abort during recovery
      {
        from: AgentState.RECOVERING,
        to: AgentState.TERMINATING,
        guard: (ctx) => ctx?.killSignal === true || ctx?.shutdownSignal === true,
      },
      // terminating -> terminated: cleanup complete
      {
        from: AgentState.TERMINATING,
        to: AgentState.TERMINATED,
        guard: (ctx) => ctx?.cleanupComplete !== false,
      },
    ];

    this.machine = new GenericStateMachine(
      AgentState.SPAWNING,
      transitions,
      [AgentState.TERMINATED],
      onTransition,
    );
  }

  /** Attempt a state transition with context. */
  transition(from: AgentState, to: AgentState, ctx?: AgentTransitionContext): Outcome<AgentState> {
    return this.machine.transition(from, to, ctx);
  }

  /** Force transition to suspended (admin override from ANY state). */
  suspend(): Outcome<AgentState> {
    if (this.machine.isTerminal()) {
      return err(KER.INVALID_STATE_TRANSITION, 'Cannot suspend a terminated agent', {
        retryable: false,
      });
    }
    return this.machine.forceTransition(AgentState.SUSPENDED);
  }

  /** Check if a transition is possible. */
  canTransition(from: AgentState, to: AgentState, ctx?: AgentTransitionContext): boolean {
    return this.machine.canTransition(from, to, ctx);
  }

  /** Get the current agent state. */
  getCurrentState(): AgentState {
    return this.machine.getCurrentState();
  }

  /** Get transition history. */
  getHistory() {
    return this.machine.getHistory();
  }

  /** Get the current failure count. */
  getFailureCount(): number {
    return this.failureCount;
  }

  /** Reset the state machine. */
  reset(): void {
    this.machine.reset(AgentState.SPAWNING);
    this.failureCount = 0;
  }

  /** Check if the agent is in a terminal state. */
  isTerminal(): boolean {
    return this.machine.isTerminal();
  }
}