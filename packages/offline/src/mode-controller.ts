/**
 * @agentos/offline — Mode Controller
 * The deterministic state machine that owns the current ExecutionMode and is the
 * single authority every other subsystem queries to decide how to behave.
 *
 * ZERO AI logic. The mode is a pure function of two inputs:
 *   1. the debounced ConnectivityState (from the Connectivity Monitor), and
 *   2. the current queue depth (from the Offline Execution Queue).
 *
 * Constitutional alignment (ADR-008 invariants):
 *   #1 Mode determinism      — computeTargetMode is pure; same inputs ⇒ same output.
 *   #5 Reconcile-before-online — a non-empty queue with connectivity is HYBRID, never ONLINE.
 *   #6 Audit completeness    — every transition emits a SYSTEM event to EventStore
 *                              BEFORE listeners run (side effects after the audit record,
 *                              per kernel-api-v1 §3.9 event-before-side-effects ordering).
 */

import { EventDomain, createUUID, type Event, type EventID } from '@agentos/types';
import type { IEventStore } from '@agentos/eventstore';
import {
  ConnectivityState,
  ExecutionMode,
  type ModeChangeListener,
  type ModeTransition,
} from './types.js';

export interface ModeControllerConfig {
  /** Optional event store; when present, every transition is appended as a SYSTEM event. */
  eventStore?: IEventStore;
  /** Injectable clock for deterministic timestamps in tests. Defaults to Date.now ISO. */
  now?: () => string;
  /** Injectable id factory for deterministic event ids in tests. */
  idFactory?: () => string;
  /** Mode to start in. Defaults to ONLINE. */
  initialMode?: ExecutionMode;
  /** Identifier recorded as the event `source`. Defaults to 'offline.mode-controller'. */
  source?: string;
}

export class ModeController {
  private mode: ExecutionMode;
  private readonly listeners: Set<ModeChangeListener> = new Set();
  private readonly eventStore?: IEventStore;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly source: string;

  constructor(config: ModeControllerConfig = {}) {
    this.mode = config.initialMode ?? ExecutionMode.ONLINE;
    this.eventStore = config.eventStore;
    this.now = config.now ?? (() => new Date().toISOString());
    this.idFactory = config.idFactory ?? (() => createUUID());
    this.source = config.source ?? 'offline.mode-controller';
  }

  /** Current execution mode. The value every subsystem branches on. */
  getMode(): ExecutionMode {
    return this.mode;
  }

  /**
   * Pure transition function (ADR-008 invariant #1). Exposed for simulation/tests.
   *
   *   connectivity NONE                       → OFFLINE
   *   connectivity FULL & queue empty         → ONLINE
   *   connectivity FULL & queue non-empty     → HYBRID   (invariant #5)
   *   connectivity PARTIAL                     → HYBRID
   */
  static computeTargetMode(connectivity: ConnectivityState, queueDepth: number): ExecutionMode {
    if (connectivity === ConnectivityState.NONE) return ExecutionMode.OFFLINE;
    if (connectivity === ConnectivityState.PARTIAL) return ExecutionMode.HYBRID;
    // FULL connectivity: cannot be ONLINE until the queue is drained.
    return queueDepth > 0 ? ExecutionMode.HYBRID : ExecutionMode.ONLINE;
  }

  /**
   * Evaluate inputs and transition if the target mode differs from the current one.
   * Returns the transition that occurred, or null if the mode was unchanged.
   *
   * Audit ordering: the SYSTEM event is appended BEFORE listeners are notified, so the
   * immutable record exists before any subsystem reacts to the new mode.
   */
  async evaluate(connectivity: ConnectivityState, queueDepth: number): Promise<ModeTransition | null> {
    const target = ModeController.computeTargetMode(connectivity, queueDepth);
    if (target === this.mode) return null;

    const transition: ModeTransition = {
      from: this.mode,
      to: target,
      connectivity,
      queueDepth,
      timestamp: this.now(),
      reason: this.describe(connectivity, queueDepth, target),
    };

    this.mode = target;

    // 1. Audit first (invariant #6 / event-before-side-effects).
    await this.emit(transition);

    // 2. Then notify subsystems.
    for (const listener of this.listeners) {
      listener(transition);
    }

    return transition;
  }

  /** Subscribe a subsystem to mode changes. Returns an unsubscribe function. */
  onModeChange(listener: ModeChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private describe(connectivity: ConnectivityState, queueDepth: number, target: ExecutionMode): string {
    if (target === ExecutionMode.HYBRID && connectivity === ConnectivityState.FULL && queueDepth > 0) {
      return `full connectivity but ${queueDepth} queued op(s) pending drain — holding HYBRID until reconciled`;
    }
    return `connectivity=${connectivity}, queueDepth=${queueDepth}`;
  }

  private async emit(transition: ModeTransition): Promise<void> {
    if (!this.eventStore) return;
    const event: Event = {
      id: this.idFactory() as EventID,
      domain: EventDomain.SYSTEM,
      type: `system.mode.${transition.to}`,
      source: this.source,
      data: transition,
      timestamp: transition.timestamp,
    };
    await this.eventStore.append(event);
  }
}
