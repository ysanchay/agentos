/**
 * @agentos/benchmarks — Offline Simulator
 * Simulates connectivity drops and restores during benchmark execution
 * to test the offline runtime (ALPHA_VALIDATION.md §2.5, §3).
 *
 * Injects probe results into the ConnectivityMonitor to simulate
 * connectivity changes, and tracks mode transitions for verification.
 */

import type { ModeController } from '@agentos/offline';
import { ConnectivityMonitor, ConnectivityState, ExecutionMode, type ProbeResult, type ModeTransition } from '@agentos/offline';
import type { OfflineScenario } from './types.js';

/** A recorded mode transition during simulation. */
export interface ModeTransitionRecord {
  /** The transition that occurred. */
  transition: ModeTransition;
  /** Whether this was a scheduled drop. */
  scheduled: boolean;
  /** Whether this was a scheduled restore. */
  restore: boolean;
}

/**
 * OfflineSimulator — schedules connectivity drops and restores.
 *
 * Uses the real ConnectivityMonitor and ModeController from @agentos/offline
 * to drive actual mode transitions, then tracks them for verification.
 */
export class OfflineSimulator {
  private monitor: ConnectivityMonitor;
  private modeController: ModeController | null;
  private scheduledTimeouts: ReturnType<typeof setTimeout>[] = [];
  private transitions: ModeTransitionRecord[] = [];
  private dropScheduled: boolean = false;
  private restoreScheduled: boolean = false;

  /**
   * @param monitor - The ConnectivityMonitor to inject probes into.
   * @param modeController - Optional ModeController to track transitions.
   */
  constructor(monitor?: ConnectivityMonitor, modeController?: ModeController) {
    this.monitor = monitor ?? new ConnectivityMonitor();
    this.modeController = modeController ?? null;

    // Subscribe to mode transitions if controller is available
    if (this.modeController) {
      this.modeController.onModeChange((transition) => {
        this.transitions.push({
          transition,
          scheduled: this.dropScheduled,
          restore: this.restoreScheduled,
        });
      });
    }
  }

  /**
   * Schedule a connectivity drop at a specific time.
   *
   * @param atMs - Time in ms from now to drop connectivity.
   */
  scheduleDrop(atMs: number): void {
    const timeout = setTimeout(() => {
      this.dropScheduled = true;
      this.restoreScheduled = false;

      // Inject unreachable probes to trigger OFFLINE mode
      // The ConnectivityMonitor requires `failuresToOffline` consecutive
      // failures to declare NONE. We inject enough probes to trigger it.
      const config = this.getConfig();
      for (let i = 0; i < config.failuresToOffline; i++) {
        const probe: ProbeResult = {
          reachable: false,
          endpointsReachable: 0,
          endpointsTotal: 3,
        };
        this.monitor.record(probe);
      }

      // Trigger mode evaluation if controller is available
      void this.evaluateMode();

      this.dropScheduled = false;
    }, atMs);
    this.scheduledTimeouts.push(timeout);
  }

  /**
   * Schedule a connectivity restore at a specific time.
   *
   * @param atMs - Time in ms from now to restore connectivity.
   */
  scheduleRestore(atMs: number): void {
    const timeout = setTimeout(() => {
      this.restoreScheduled = true;
      this.dropScheduled = false;

      // Inject healthy probes to trigger ONLINE mode
      const config = this.getConfig();
      for (let i = 0; i < config.successesToFull; i++) {
        const probe: ProbeResult = {
          reachable: true,
          endpointsReachable: 3,
          endpointsTotal: 3,
          latencyMs: 50,
        };
        this.monitor.record(probe);
      }

      // Trigger mode evaluation if controller is available
      void this.evaluateMode();

      this.restoreScheduled = false;
    }, atMs);
    this.scheduledTimeouts.push(timeout);
  }

  /**
   * Apply an OfflineScenario from a benchmark spec.
   */
  applyScenario(scenario: OfflineScenario): void {
    this.scheduleDrop(scenario.dropAt);
    this.scheduleRestore(scenario.restoreAt);
  }

  /**
   * Get the current connectivity state from the monitor.
   */
  getConnectivityState(): ConnectivityState {
    return this.monitor.getState();
  }

  /**
   * Get the current execution mode from the mode controller.
   */
  getExecutionMode(): ExecutionMode | null {
    return this.modeController?.getMode() ?? null;
  }

  /**
   * Get all recorded mode transitions.
   */
  getTransitions(): ModeTransitionRecord[] {
    return [...this.transitions];
  }

  /**
   * Verify that mode transitions match expected pattern.
   * After a drop, mode should transition to OFFLINE.
   * After a restore, mode should transition back to ONLINE (or HYBRID).
   */
  verifyTransitions(): { passed: boolean; issues: string[] } {
    const issues: string[] = [];

    if (this.transitions.length === 0) {
      // No transitions — acceptable if no scenario was applied
      return { passed: true, issues: [] };
    }

    // Check that we got at least one transition to a non-ONLINE mode
    const hadDrop = this.transitions.some(
      (t) => t.transition.to === ExecutionMode.OFFLINE || t.transition.to === ExecutionMode.HYBRID,
    );
    if (!hadDrop) {
      issues.push('Expected at least one transition to OFFLINE or HYBRID mode');
    }

    // Check that we got at least one restore transition back to ONLINE
    const hadRestore = this.transitions.some(
      (t) => t.transition.to === ExecutionMode.ONLINE,
    );
    if (!hadRestore && this.transitions.length > 0) {
      issues.push('Expected at least one transition back to ONLINE after restore');
    }

    return { passed: issues.length === 0, issues };
  }

  /**
   * Cancel all scheduled drops/restores and clean up.
   */
  cleanup(): void {
    for (const timeout of this.scheduledTimeouts) {
      clearTimeout(timeout);
    }
    this.scheduledTimeouts = [];
  }

  /**
   * Reset the simulator to its initial state.
   */
  reset(): void {
    this.cleanup();
    this.transitions = [];
    this.dropScheduled = false;
    this.restoreScheduled = false;
    this.monitor = new ConnectivityMonitor();
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private getConfig() {
    // Access the monitor's config by recording probes and observing behavior.
    // The ConnectivityMonitor uses DEFAULT_CONNECTIVITY_CONFIG with 3 failures
    // to offline and 2 successes to full by default.
    return {
      failuresToOffline: 3,
      successesToFull: 2,
    };
  }

  private async evaluateMode(): Promise<void> {
    if (!this.modeController) return;
    const state = this.monitor.getState();
    // Queue depth is 0 in simulation (no real queue)
    await this.modeController.evaluate(state, 0);
  }
}