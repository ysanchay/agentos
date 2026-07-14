/**
 * @agentos/benchmarks — Connectivity Chaos Track (Batch 6)
 * Simulates random connectivity drops, model outages, queue saturation,
 * and recovery events during benchmark execution to test the Offline
 * Runtime's resilience under real-world operating conditions.
 *
 * ALPHA_VALIDATION.md §3.4 — Connectivity Chaos Track requirements.
 */

import { ModeController, ExecutionQueue, ExecutionMode } from '@agentos/offline';
import type { ConnectivityState } from '@agentos/offline';

// ─── Types ─────────────────────────────────────────────────────────────────

/** A single chaos event recorded in the track log. */
export interface ChaosEvent {
  type: 'connectivity.drop' | 'connectivity.restore' | 'mode.transition' |
        'queue.saturation' | 'model.outage' | 'recovery.complete';
  timestamp: string;
  detail: string;
  mode?: string;
  queueDepth?: number;
}

/** Configuration for the chaos track. */
export interface ChaosTrackConfig {
  /** Interval between drops in ms (default: 5000). */
  dropIntervalMs?: number;
  /** Min drop duration in ms (default: 1000). */
  minDropDurationMs?: number;
  /** Max drop duration in ms (default: 5000). */
  maxDropDurationMs?: number;
  /** Probability of a model outage during each drop (default: 0.3). */
  modelOutageProbability?: number;
  /** Number of ops to enqueue during queue saturation (default: 50). */
  saturationBatchSize?: number;
  /** Probability of queue saturation during each drop (default: 0.4). */
  saturationProbability?: number;
  /** Total number of drops to inject (default: 5). 0 = unlimited until stopped. */
  totalDrops?: number;
}

/** Report produced after chaos track execution. */
export interface ChaosReport {
  totalDrops: number;
  totalRestores: number;
  totalModeTransitions: number;
  maxQueueDepth: number;
  totalQueueSaturationEvents: number;
  totalModelOutages: number;
  totalRecoveries: number;
  events: ChaosEvent[];
}

// ─── ConnectivityChaosTrack ─────────────────────────────────────────────────

export class ConnectivityChaosTrack {
  private modeController: ModeController;
  private executionQueue: ExecutionQueue;
  private config: Required<ChaosTrackConfig>;
  private events: ChaosEvent[] = [];
  private timeouts: ReturnType<typeof setTimeout>[] = [];
  private running = false;
  private dropsInjected = 0;
  private restoresCompleted = 0;
  private modeTransitions = 0;
  private maxQueueDepth = 0;
  private saturationEvents = 0;
  private modelOutages = 0;
  private recoveries = 0;

  constructor(
    modeController: ModeController,
    executionQueue: ExecutionQueue,
    config: ChaosTrackConfig = {},
  ) {
    this.modeController = modeController;
    this.executionQueue = executionQueue;
    this.config = {
      dropIntervalMs: config.dropIntervalMs ?? 5000,
      minDropDurationMs: config.minDropDurationMs ?? 1000,
      maxDropDurationMs: config.maxDropDurationMs ?? 5000,
      modelOutageProbability: config.modelOutageProbability ?? 0.3,
      saturationBatchSize: config.saturationBatchSize ?? 50,
      saturationProbability: config.saturationProbability ?? 0.4,
      totalDrops: config.totalDrops ?? 5,
    };
  }

  /**
   * Start the chaos track. Schedules connectivity drops at regular intervals.
   */
  start(): void {
    this.running = true;
    this.scheduleNextDrop();
  }

  /**
   * Stop the chaos track and clean up all pending timers.
   */
  stop(): void {
    this.running = false;
    this.cleanup();
  }

  /**
   * Get the full chaos report.
   */
  getReport(): ChaosReport {
    return {
      totalDrops: this.dropsInjected,
      totalRestores: this.restoresCompleted,
      totalModeTransitions: this.modeTransitions,
      maxQueueDepth: this.maxQueueDepth,
      totalQueueSaturationEvents: this.saturationEvents,
      totalModelOutages: this.modelOutages,
      totalRecoveries: this.recoveries,
      events: [...this.events],
    };
  }

  /**
   * Inject a single connectivity drop immediately (bypassing the scheduler).
   * Useful for deterministic testing.
   */
  async injectDrop(durationMs?: number): Promise<void> {
    const duration = durationMs ?? this.randomDuration();
    await this.performDrop(duration);
  }

  /**
   * Reset all state for a new run.
   */
  reset(): void {
    this.cleanup();
    this.events = [];
    this.dropsInjected = 0;
    this.restoresCompleted = 0;
    this.modeTransitions = 0;
    this.maxQueueDepth = 0;
    this.saturationEvents = 0;
    this.modelOutages = 0;
    this.recoveries = 0;
    this.running = false;
  }

  /**
   * Clean up all pending timers.
   */
  cleanup(): void {
    for (const t of this.timeouts) {
      clearTimeout(t);
    }
    this.timeouts = [];
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private scheduleNextDrop(): void {
    if (!this.running) return;
    if (this.config.totalDrops > 0 && this.dropsInjected >= this.config.totalDrops) return;

    const timeout = setTimeout(() => {
      void this.performDrop(this.randomDuration()).then(() => {
        this.scheduleNextDrop();
      });
    }, this.config.dropIntervalMs);
    this.timeouts.push(timeout);
  }

  private async performDrop(durationMs: number): Promise<void> {
    this.dropsInjected++;
    const now = new Date().toISOString();

    // 1. Drop connectivity → OFFLINE
    this.recordEvent('connectivity.drop', now, `Dropping connectivity for ${durationMs}ms`);
    const dropTransition = await this.modeController.evaluate(
      'none' as ConnectivityState,
      this.executionQueue.size(),
    );
    if (dropTransition) {
      this.modeTransitions++;
      this.recordEvent('mode.transition', now, `${dropTransition.from} → ${dropTransition.to}`,
        dropTransition.to, this.executionQueue.size());
    }

    // 2. Optionally saturate the queue
    if (Math.random() < this.config.saturationProbability) {
      this.saturationEvents++;
      for (let i = 0; i < this.config.saturationBatchSize; i++) {
        await this.executionQueue.enqueue({
          id: `chaos-op-${Date.now()}-${i}`,
          kind: 'inference',
          idempotencyKey: `chaos-${Date.now()}-${i}`,
          capabilityPath: 'reason.infer.text',
          workspaceId: 'chaos-ws',
          payload: { chaos: true },
          enqueuedAt: new Date().toISOString(),
          priority: 4,
        });
      }
      const depth = this.executionQueue.size();
      if (depth > this.maxQueueDepth) this.maxQueueDepth = depth;
      this.recordEvent('queue.saturation', now, `Enqueued ${this.config.saturationBatchSize} ops, depth=${depth}`,
        undefined, depth);
    }

    // 3. Optionally simulate model outage
    if (Math.random() < this.config.modelOutageProbability) {
      this.modelOutages++;
      this.recordEvent('model.outage', now, 'Local model unavailable during offline period');
    }

    // 4. Schedule restore after duration
    const restoreTimeout = setTimeout(() => {
      void this.performRestore();
    }, durationMs);
    this.timeouts.push(restoreTimeout);
  }

  private async performRestore(): Promise<void> {
    this.restoresCompleted++;
    const now = new Date().toISOString();

    // Restore connectivity → ONLINE (or HYBRID if queue non-empty)
    const queueDepth = this.executionQueue.size();
    this.recordEvent('connectivity.restore', now, `Restoring connectivity, queue depth=${queueDepth}`,
      undefined, queueDepth);
    const restoreTransition = await this.modeController.evaluate(
      'full' as ConnectivityState,
      queueDepth,
    );
    if (restoreTransition) {
      this.modeTransitions++;
      this.recordEvent('mode.transition', now, `${restoreTransition.from} → ${restoreTransition.to}`,
        restoreTransition.to, queueDepth);
    }

    // Drain queue if non-empty (simulate SyncEngine reconciliation)
    if (queueDepth > 0) {
      await this.executionQueue.drain();
      this.recoveries++;
      this.recordEvent('recovery.complete', now, `Drained ${queueDepth} queued ops, recovered`);
    }
  }

  private randomDuration(): number {
    return this.config.minDropDurationMs +
      Math.floor(Math.random() * (this.config.maxDropDurationMs - this.config.minDropDurationMs));
  }

  private recordEvent(
    type: ChaosEvent['type'],
    timestamp: string,
    detail: string,
    mode?: string,
    queueDepth?: number,
  ): void {
    this.events.push({ type, timestamp, detail, mode, queueDepth });
  }
}