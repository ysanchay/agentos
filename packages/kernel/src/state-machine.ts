/**
 * @agentos/kernel — Generic State Machine
 * Deterministic finite state machine with guards, side effects, and history.
 * ZERO AI logic — all transitions are explicit and deterministic.
 */

import { ok, err } from '@agentos/types';
import type { Outcome } from '@agentos/types';
import { KER } from '@agentos/types';

// ─── Transition Definition ──────────────────────────────────────────

export interface TransitionDef<S extends string, C = unknown> {
  from: S;
  to: S;
  guard?: (ctx?: C) => boolean;
  sideEffect?: (ctx?: C) => void;
}

export interface TransitionRecord<S extends string> {
  from: S;
  to: S;
  timestamp: string;
  ctx?: unknown;
}

// ─── GenericStateMachine ──────────────────────────────────────────────

export class GenericStateMachine<S extends string, C = unknown> {
  private currentState: S;
  private transitions: TransitionDef<S, C>[];
  private history: TransitionRecord<S>[] = [];
  private terminalStates: Set<S>;
  private onTransition?: (from: S, to: S, ctx?: C) => void;

  constructor(
    initialState: S,
    transitions: TransitionDef<S, C>[],
    terminalStates: S[],
    onTransition?: (from: S, to: S, ctx?: C) => void,
  ) {
    this.currentState = initialState;
    this.transitions = transitions;
    this.terminalStates = new Set(terminalStates);
    this.onTransition = onTransition;
  }

  /** Attempt a state transition. Returns the new state or an error. */
  transition(from: S, to: S, ctx?: C): Outcome<S> {
    // Reject transitions from terminal states
    if (this.terminalStates.has(this.currentState)) {
      return err(KER.INVALID_STATE_TRANSITION, `Cannot transition from terminal state "${this.currentState}"`, {
        retryable: false,
        details: { from: this.currentState, to },
      });
    }

    // Current state must match 'from'
    if (this.currentState !== from) {
      return err(KER.INVALID_STATE_TRANSITION, `Current state is "${this.currentState}", expected "${from}"`, {
        retryable: false,
        details: { current: this.currentState, expectedFrom: from, to },
      });
    }

    // Find matching transition definition
    const def = this.transitions.find((t) => t.from === from && t.to === to);
    if (!def) {
      return err(KER.INVALID_STATE_TRANSITION, `No transition defined from "${from}" to "${to}"`, {
        retryable: false,
        details: { from, to, validTargets: this.getValidTargets(from) },
      });
    }

    // Check guard if present
    if (def.guard && !def.guard(ctx)) {
      return err(KER.INVALID_STATE_TRANSITION, `Guard rejected transition from "${from}" to "${to}"`, {
        retryable: false,
        details: { from, to, guardFailed: true },
      });
    }

    // Execute side effect if present
    if (def.sideEffect) {
      def.sideEffect(ctx);
    }

    // Perform the transition
    const prev = this.currentState;
    this.currentState = to;

    // Record in history
    this.history.push({
      from: prev,
      to,
      timestamp: new Date().toISOString(),
      ctx,
    });

    // Notify listener
    if (this.onTransition) {
      this.onTransition(prev, to, ctx);
    }

    return ok(to);
  }

  /** Force a state change without guards or history. Used for admin overrides like ANY->suspended. */
  forceTransition(to: S): Outcome<S> {
    // Still reject transitions from terminal states
    if (this.terminalStates.has(this.currentState)) {
      return err(KER.INVALID_STATE_TRANSITION, `Cannot transition from terminal state "${this.currentState}"`, {
        retryable: false,
        details: { from: this.currentState, to },
      });
    }

    const prev = this.currentState;
    this.currentState = to;

    this.history.push({
      from: prev,
      to,
      timestamp: new Date().toISOString(),
    });

    if (this.onTransition) {
      this.onTransition(prev, to, undefined);
    }

    return ok(to);
  }

  /** Check if a transition from one state to another is valid (guard-aware). */
  canTransition(from: S, to: S, ctx?: C): boolean {
    if (this.terminalStates.has(this.currentState)) return false;
    if (this.currentState !== from) return false;

    const def = this.transitions.find((t) => t.from === from && t.to === to);
    if (!def) return false;

    if (def.guard && !def.guard(ctx)) return false;

    return true;
  }

  /** Get the current state. */
  getCurrentState(): S {
    return this.currentState;
  }

  /** Get all transition history. */
  getHistory(): TransitionRecord<S>[] {
    return [...this.history];
  }

  /** Reset the state machine to its initial state, clearing history. */
  reset(initialState: S): void {
    this.currentState = initialState;
    this.history = [];
  }

  /** Check if the current state is terminal. */
  isTerminal(): boolean {
    return this.terminalStates.has(this.currentState);
  }

  /** Get valid target states from a given state. */
  getValidTargets(from: S): S[] {
    return this.transitions
      .filter((t) => t.from === from)
      .map((t) => t.to);
  }
}