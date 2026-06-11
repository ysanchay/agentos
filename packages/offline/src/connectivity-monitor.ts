/**
 * @agentos/offline — Connectivity Monitor
 * Turns a stream of raw connectivity probes into a debounced, hysteresis-stable
 * ConnectivityState. This is the ONLY input that legitimately drives mode changes
 * (ADR-008: "Transitions are driven only by the Connectivity Monitor's debounced
 * signal plus queue state — never by an agent or a model").
 *
 * ZERO network I/O — probes are injected. This keeps the monitor deterministic:
 * the same ordered sequence of ProbeResults always yields the same states.
 *
 * Hysteresis prevents mode flapping on a flaky link: distinct thresholds gate the
 * transitions toward-healthy (successesToFull) and toward-degraded (failuresToOffline).
 */

import {
  ConnectivityState,
  DEFAULT_CONNECTIVITY_CONFIG,
  type ConnectivityMonitorConfig,
  type ProbeResult,
} from './types.js';

export class ConnectivityMonitor {
  private readonly config: ConnectivityMonitorConfig;
  private state: ConnectivityState;

  /** Consecutive fully-healthy probes. */
  private successStreak = 0;
  /** Consecutive fully-unreachable probes. */
  private failureStreak = 0;

  constructor(config?: Partial<ConnectivityMonitorConfig>, initial: ConnectivityState = ConnectivityState.FULL) {
    this.config = { ...DEFAULT_CONNECTIVITY_CONFIG, ...config };
    this.state = initial;
  }

  /** Current debounced verdict. */
  getState(): ConnectivityState {
    return this.state;
  }

  /**
   * Feed one probe result; returns the (possibly unchanged) debounced state.
   *
   * Classification of a single probe:
   *   - unreachable           → counts toward NONE
   *   - reachable but degraded → immediate PARTIAL (latency over budget, or some endpoints down)
   *   - reachable and healthy  → counts toward FULL
   *
   * Hysteresis:
   *   - NONE is declared only after `failuresToOffline` consecutive unreachable probes.
   *   - FULL is declared only after `successesToFull` consecutive healthy probes.
   *   - PARTIAL is entered immediately on any degraded-but-reachable probe, and is the
   *     resting state while streaks are still building toward NONE/FULL.
   */
  record(probe: ProbeResult): ConnectivityState {
    const classification = this.classify(probe);

    if (classification === 'unreachable') {
      this.failureStreak += 1;
      this.successStreak = 0;
      if (this.failureStreak >= this.config.failuresToOffline) {
        this.state = ConnectivityState.NONE;
      } else if (this.state === ConnectivityState.FULL) {
        // Reachability just dropped but not yet confirmed offline → degrade to PARTIAL.
        this.state = ConnectivityState.PARTIAL;
      }
      return this.state;
    }

    if (classification === 'degraded') {
      // A degraded-but-reachable probe resets the failure streak (we CAN reach something)
      // but does not count toward FULL.
      this.failureStreak = 0;
      this.successStreak = 0;
      this.state = ConnectivityState.PARTIAL;
      return this.state;
    }

    // classification === 'healthy'
    this.successStreak += 1;
    this.failureStreak = 0;
    if (this.successStreak >= this.config.successesToFull) {
      this.state = ConnectivityState.FULL;
    } else if (this.state === ConnectivityState.NONE) {
      // Coming back from offline: don't jump straight to FULL — pass through PARTIAL
      // until the success streak confirms stability.
      this.state = ConnectivityState.PARTIAL;
    }
    return this.state;
  }

  private classify(probe: ProbeResult): 'unreachable' | 'degraded' | 'healthy' {
    if (!probe.reachable) return 'unreachable';

    // Partial endpoint reachability → degraded.
    if (
      probe.endpointsTotal !== undefined &&
      probe.endpointsReachable !== undefined &&
      probe.endpointsReachable < probe.endpointsTotal
    ) {
      return probe.endpointsReachable === 0 ? 'unreachable' : 'degraded';
    }

    // High latency → degraded.
    if (probe.latencyMs !== undefined && probe.latencyMs > this.config.degradedLatencyMs) {
      return 'degraded';
    }

    return 'healthy';
  }

  /** Reset streaks and state — used when re-seeding the monitor (e.g. after host sleep). */
  reset(state: ConnectivityState = ConnectivityState.FULL): void {
    this.state = state;
    this.successStreak = 0;
    this.failureStreak = 0;
  }
}
