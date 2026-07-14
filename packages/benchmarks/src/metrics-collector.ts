/**
 * @agentos/benchmarks — Metrics Collector
 * Collects the 7 required measurements per benchmark
 * (ALPHA_VALIDATION.md §2.3).
 *
 * The 7 metrics:
 *   1. Completion Rate — % of tasks that reach terminal 'completed' state
 *   2. Latency — wall-clock time from goal submission to validated result
 *   3. Resource Consumption — RU/MU/EU/VU consumed vs allocated
 *   4. Validation Accuracy — % of validator approvals that are correct
 *   5. Human Intervention Rate — % of benchmarks requiring manual intervention
 *   6. Recovery Success — % of injected failures that the system recovered from
 *   7. Constitutional Compliance — % of invariants that held throughout
 */

import type { ResourceConsumption } from '@agentos/types';
import { ZERO_CONSUMPTION } from '@agentos/types';
import type { BenchmarkSpec, BenchmarkMetrics } from './types.js';

/** A tracked event during benchmark execution. */
export interface TrackedEvent {
  /** Event type. */
  type: string;
  /** Timestamp in ms since benchmark start. */
  timestampMs: number;
  /** Event data. */
  data?: unknown;
}

/**
 * MetricsCollector — gathers the 7 required benchmark metrics.
 *
 * Usage:
 *   const collector = new MetricsCollector();
 *   collector.start(spec);
 *   // ... execute benchmark, recording events ...
 *   collector.recordTaskCompleted();
 *   collector.recordTaskFailed();
 *   collector.recordValidationResult(true);
 *   collector.recordHumanIntervention();
 *   const metrics = collector.finish();
 */
export class MetricsCollector {
  private startTime: number = 0;
  private endTime: number = 0;
  private spec: BenchmarkSpec | null = null;
  private events: TrackedEvent[] = [];
  private totalTasks: number = 0;
  private completedTasks: number = 0;
  private failedTasks: number = 0;
  private resourceConsumption: ResourceConsumption = { ...ZERO_CONSUMPTION };
  private resourceAllocated: ResourceConsumption = { ...ZERO_CONSUMPTION };
  private validationResults: boolean[] = [];
  private humanInterventions: number = 0;
  private failuresInjected: number = 0;
  private failuresRecovered: number = 0;
  private invariantChecks: boolean[] = [];
  private running: boolean = false;

  /**
   * Start collecting metrics for a benchmark spec.
   */
  start(spec: BenchmarkSpec): void {
    this.reset();
    this.spec = spec;
    this.startTime = Date.now();
    this.running = true;
    this.recordEvent('benchmark.started', { specId: spec.id });
  }

  /**
   * Record an event during benchmark execution.
   */
  recordEvent(type: string, data?: unknown): void {
    if (!this.running) return;
    const timestampMs = Date.now() - this.startTime;
    this.events.push({ type, timestampMs, data });
  }

  /**
   * Record that a task was created.
   */
  recordTaskCreated(): void {
    this.totalTasks++;
    this.recordEvent('task.created');
  }

  /**
   * Record that a task completed successfully.
   */
  recordTaskCompleted(): void {
    this.completedTasks++;
    this.recordEvent('task.completed');
  }

  /**
   * Record that a task failed.
   */
  recordTaskFailed(): void {
    this.failedTasks++;
    this.recordEvent('task.failed');
  }

  /**
   * Record resource consumption.
   */
  recordResourceConsumption(consumption: ResourceConsumption): void {
    this.resourceConsumption.ru += consumption.ru;
    this.resourceConsumption.mu += consumption.mu;
    this.resourceConsumption.eu += consumption.eu;
    this.resourceConsumption.vu += consumption.vu;
  }

  /**
   * Record allocated resources.
   */
  recordResourceAllocated(allocated: ResourceConsumption): void {
    this.resourceAllocated.ru += allocated.ru;
    this.resourceAllocated.mu += allocated.mu;
    this.resourceAllocated.eu += allocated.eu;
    this.resourceAllocated.vu += allocated.vu;
  }

  /**
   * Record a validation result (true = correct approval, false = false positive/negative).
   */
  recordValidationResult(correct: boolean): void {
    this.validationResults.push(correct);
    this.recordEvent('validation.result', { correct });
  }

  /**
   * Record that a human intervention was required.
   */
  recordHumanIntervention(): void {
    this.humanInterventions++;
    this.recordEvent('human.intervention');
  }

  /**
   * Record that a failure was injected.
   */
  recordFailure(): void {
    this.failuresInjected++;
    this.recordEvent('failure.injected');
  }

  /**
   * Record that a previously injected failure was recovered.
   */
  recordRecovery(): void {
    this.failuresRecovered++;
    this.recordEvent('failure.recovered');
  }

  /**
   * Record a constitutional invariant check result.
   */
  recordInvariantCheck(passed: boolean): void {
    this.invariantChecks.push(passed);
    this.recordEvent('invariant.check', { passed });
  }

  /**
   * Finish collecting metrics and return the 7 measurements.
   */
  finish(): BenchmarkMetrics {
    this.endTime = Date.now();
    this.running = false;
    this.recordEvent('benchmark.finished');

    const latencyMs = this.endTime - this.startTime;

    // 1. Completion Rate
    const completionRate = this.totalTasks > 0
      ? this.completedTasks / this.totalTasks
      : 0;

    // 2. Latency — already computed above

    // 3. Resource Consumption
    const resourceConsumption: ResourceConsumption = {
      ru: this.resourceConsumption.ru,
      mu: this.resourceConsumption.mu,
      eu: this.resourceConsumption.eu,
      vu: this.resourceConsumption.vu,
    };

    // 4. Validation Accuracy
    const validationAccuracy = this.validationResults.length > 0
      ? this.validationResults.filter((v) => v).length / this.validationResults.length
      : 0;

    // 5. Human Intervention Rate
    // If the spec expects intervention, 1 intervention = rate 1.0
    // If not expected, rate is interventions / total benchmarks (but per-benchmark, it's 0 or 1)
    const humanInterventionRate = this.spec
      ? (this.humanInterventions > 0 ? 1 : 0)
      : 0;

    // 6. Recovery Success
    const recoverySuccess = this.failuresInjected > 0
      ? this.failuresRecovered / this.failuresInjected
      : 1.0; // No failures = full recovery success

    // 7. Constitutional Compliance
    const constitutionalCompliance = this.invariantChecks.length > 0
      ? (this.invariantChecks.filter((v) => v).length / this.invariantChecks.length) * 100
      : 100; // No checks = full compliance

    return {
      completionRate,
      latencyMs,
      resourceConsumption,
      validationAccuracy,
      humanInterventionRate,
      recoverySuccess,
      constitutionalCompliance,
    };
  }

  /**
   * Get all recorded events.
   */
  getEvents(): TrackedEvent[] {
    return [...this.events];
  }

  /**
   * Get the total number of tasks created.
   */
  getTotalTasks(): number {
    return this.totalTasks;
  }

  /**
   * Get the number of completed tasks.
   */
  getCompletedTasks(): number {
    return this.completedTasks;
  }

  /**
   * Get the number of failed tasks.
   */
  getFailedTasks(): number {
    return this.failedTasks;
  }

  /**
   * Reset the collector to its initial state.
   */
  reset(): void {
    this.startTime = 0;
    this.endTime = 0;
    this.spec = null;
    this.events = [];
    this.totalTasks = 0;
    this.completedTasks = 0;
    this.failedTasks = 0;
    this.resourceConsumption = { ...ZERO_CONSUMPTION };
    this.resourceAllocated = { ...ZERO_CONSUMPTION };
    this.validationResults = [];
    this.humanInterventions = 0;
    this.failuresInjected = 0;
    this.failuresRecovered = 0;
    this.invariantChecks = [];
    this.running = false;
  }
}