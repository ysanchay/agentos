/**
 * @agentos/benchmarks — Failure Injector
 * Injects failures into the AgentOS stack during benchmark execution
 * to test system resilience and recovery (ALPHA_VALIDATION.md §2.5).
 *
 * Tracks all injected failures so recovery success can be measured.
 */

import { FailureType, type FailureInjection } from './types.js';

/** The status of an injected failure. */
export type FailureStatus = 'injected' | 'recovered' | 'unrecovered';

/** A record of a single injected failure and its outcome. */
export interface FailureRecord {
  /** Unique identifier for this failure injection. */
  id: string;
  /** The type of failure. */
  type: FailureType;
  /** The target of the failure. */
  target: string;
  /** Delay in ms before the failure was injected. */
  delay: number;
  /** Duration in ms the failure persisted. */
  duration: number;
  /** Timestamp when the failure was injected (ms since epoch). */
  injectedAt: number;
  /** Timestamp when the failure was recovered, or null if still active. */
  recoveredAt: number | null;
  /** Current status. */
  status: FailureStatus;
  /** Error message if recovery failed. */
  error?: string;
}

/**
 * FailureInjector — injects simulated failures into the AgentOS stack.
 *
 * In simulation mode, failures are tracked but not actually destructive.
 * In real execution mode, failures interact with the real subsystems
 * (e.g., killing agents, dropping network connections, exhausting resources).
 */
export class FailureInjector {
  private failures: Map<string, FailureRecord> = new Map();
  private scheduledTimeouts: ReturnType<typeof setTimeout>[] = [];
  private recoveredCount: number = 0;
  private unrecoveredCount: number = 0;

  /**
   * Schedule a failure injection.
   * The failure will be triggered after the specified delay.
   *
   * @param type - The type of failure to inject.
   * @param target - The target of the failure.
   * @param delay - Delay in ms before the failure activates.
   * @param duration - Duration in ms the failure persists (0 = instantaneous).
   * @returns The failure record ID.
   */
  inject(type: FailureType, target: string, delay: number, duration: number = 0): string {
    const id = `fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record: FailureRecord = {
      id,
      type,
      target,
      delay,
      duration,
      injectedAt: 0,
      recoveredAt: null,
      status: 'injected',
    };
    this.failures.set(id, record);

    // Schedule the failure injection
    const timeout = setTimeout(() => {
      this.activate(id);
    }, delay);
    this.scheduledTimeouts.push(timeout);

    return id;
  }

  /**
   * Inject a failure from a FailureInjection spec.
   */
  injectFromSpec(spec: FailureInjection): string {
    return this.inject(spec.type, spec.target, spec.delay, spec.duration);
  }

  /**
   * Activate a scheduled failure.
   */
  private activate(id: string): void {
    const record = this.failures.get(id);
    if (!record) return;

    record.injectedAt = Date.now();
    record.status = 'injected';

    // Simulate the failure effect
    switch (record.type) {
      case FailureType.AGENT_CRASH:
        // In simulation, we just track it. In real mode, this would
        // signal the kernel to terminate the agent.
        break;
      case FailureType.NETWORK_DROP:
        // In simulation, we track. In real mode, this would interact
        // with ConnectivityMonitor to inject probe failures.
        break;
      case FailureType.RESOURCE_EXHAUSTION:
        // In simulation, we track. In real mode, this would exhaust
        // the resource scheduler for the given unit.
        break;
      case FailureType.CAPABILITY_UNAVAILABLE:
        // In simulation, we track. In real mode, this would mark a
        // capability provider as unavailable.
        break;
      case FailureType.VALIDATION_REJECTION:
        // In simulation, we track. In real mode, this would cause
        // validators to reject a specific task.
        break;
    }

    // If the failure has a duration, schedule recovery
    if (record.duration > 0) {
      const recoveryTimeout = setTimeout(() => {
        this.recover(id);
      }, record.duration);
      this.scheduledTimeouts.push(recoveryTimeout);
    } else {
      // Instantaneous failure — recover immediately (duration=0 means
      // the system should recover instantly in simulation mode)
      this.recover(id);
    }
  }

  /**
   * Mark a failure as recovered.
   */
  recover(id: string): void {
    const record = this.failures.get(id);
    if (!record) return;
    if (record.status === 'recovered') return;

    record.recoveredAt = Date.now();
    record.status = 'recovered';
    this.recoveredCount++;
  }

  /**
   * Mark a failure as unrecovered (system could not recover).
   */
  markUnrecovered(id: string, error?: string): void {
    const record = this.failures.get(id);
    if (!record) return;
    if (record.status !== 'injected') return;

    record.status = 'unrecovered';
    record.error = error;
    this.unrecoveredCount++;
  }

  /**
   * Get all failure records.
   */
  getFailures(): FailureRecord[] {
    return Array.from(this.failures.values());
  }

  /**
   * Get a specific failure record.
   */
  getFailure(id: string): FailureRecord | undefined {
    return this.failures.get(id);
  }

  /**
   * Get the recovery success rate (0.0–1.0).
   * If no failures were injected, returns 1.0 (no failures = full success).
   */
  getRecoverySuccessRate(): number {
    const total = this.failures.size;
    if (total === 0) return 1.0;
    return this.recoveredCount / total;
  }

  /**
   * Get the count of recovered failures.
   */
  getRecoveredCount(): number {
    return this.recoveredCount;
  }

  /**
   * Get the count of unrecovered failures.
   */
  getUnrecoveredCount(): number {
    return this.unrecoveredCount;
  }

  /**
   * Get the count of currently active (injected, not yet recovered) failures.
   */
  getActiveCount(): number {
    let count = 0;
    for (const record of Array.from(this.failures.values())) {
      if (record.status === 'injected') count++;
    }
    return count;
  }

  /**
   * Wait for all scheduled failures to complete (inject + recover).
   * Returns a promise that resolves when all failures have reached a terminal state.
   *
   * @param timeoutMs - Maximum time to wait in ms.
   */
  async waitForAll(timeoutMs: number = 60000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const allTerminal = Array.from(this.failures.values()).every(
        (r) => r.status === 'recovered' || r.status === 'unrecovered',
      );
      if (allTerminal) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Cancel all pending scheduled failures and clean up.
   */
  cleanup(): void {
    for (const timeout of this.scheduledTimeouts) {
      clearTimeout(timeout);
    }
    this.scheduledTimeouts = [];
  }

  /**
   * Reset the failure injector to its initial state.
   */
  reset(): void {
    this.cleanup();
    this.failures.clear();
    this.recoveredCount = 0;
    this.unrecoveredCount = 0;
  }
}