/**
 * @agentos/benchmarks — Alpha Validation Program
 * 100-benchmark validation suite for AgentOS Alpha.
 *
 * Implements the benchmark harness defined in ALPHA_VALIDATION.md §2.5:
 *   - BenchmarkRunner — orchestrates a single benchmark through the full stack
 *   - BenchmarkSuite — runs all 100 benchmarks, collects metrics, generates report
 *   - FailureInjector — injects agent crashes, network drops, resource exhaustion
 *   - OfflineSimulator — toggles connectivity during benchmark execution
 *   - MetricsCollector — gathers the 7 required metrics per benchmark
 *   - BenchmarkVerifier — validates results against expected outputs
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export {
  BenchmarkCategory,
  BENCHMARK_CATEGORIES,
  CATEGORY_PREFIX,
  ALL_STACK_COMPONENTS,
  FailureType,
  ALL_FAILURE_TYPES,
  BenchmarkSpecSchema,
  FailureInjectionSchema,
  OfflineScenarioSchema,
  BenchmarkOutputSpecSchema,
  ValidationCriteriaSchema,
} from './types.js';

export type {
  StackComponent,
  BenchmarkOutputType,
  BenchmarkOutputSpec,
  FailureInjection,
  OfflineMode,
  OfflineScenario,
  ValidationCriteria,
  CustomCheck,
  BenchmarkSpec,
  BenchmarkMetrics,
  BenchmarkResult,
  BenchmarkSuiteResult,
  CategorySummary,
  BenchmarkStatus,
  BenchmarkRunnerConfig,
} from './types.js';

// ─── Benchmark Specs ──────────────────────────────────────────────────────

export {
  BENCHMARK_SPECS,
  TOTAL_BENCHMARKS,
  getSpecsByCategory,
  getSpecById,
} from './benchmark-specs.js';

// ─── Runner ───────────────────────────────────────────────────────────────

export { BenchmarkRunner } from './benchmark-runner.js';
export type { BenchmarkRunnerDeps } from './benchmark-runner.js';

// ─── Suite ────────────────────────────────────────────────────────────────

export { BenchmarkSuite, createDefaultBenchmarkSuite } from './benchmark-suite.js';
export type { BenchmarkSuiteConfig } from './benchmark-suite.js';

// ─── Failure Injector ─────────────────────────────────────────────────────

export { FailureInjector } from './failure-injector.js';
export type { FailureRecord, FailureStatus } from './failure-injector.js';

// ─── Offline Simulator ────────────────────────────────────────────────────

export { OfflineSimulator } from './offline-simulator.js';
export type { ModeTransitionRecord } from './offline-simulator.js';

// ─── Metrics Collector ────────────────────────────────────────────────────

export { MetricsCollector } from './metrics-collector.js';
export type { TrackedEvent } from './metrics-collector.js';

// ─── Verifier ─────────────────────────────────────────────────────────────

export { BenchmarkVerifier } from './benchmark-verifier.js';
export type { VerificationResult } from './benchmark-verifier.js';

// ─── Connectivity Chaos Track (Batch 6) ─────────────────────────────────────

export { ConnectivityChaosTrack } from './connectivity-chaos-track.js';
export type { ChaosTrackConfig, ChaosReport, ChaosEvent } from './connectivity-chaos-track.js';

// ─── Production Telemetry Collector ───────────────────────────────────────

export { TelemetryCollector } from './telemetry-collector.js';
export type {
  TaskTelemetry,
  SessionTelemetry,
  TelemetrySummary,
  CapabilityUsageRecord,
} from './telemetry-collector.js';

// ─── Real-World Task Framework ──────────────────────────────────────────────

export {
  createRealWorldTaskSuite,
  executeRealWorldTaskSuite,
} from './real-world-tasks.js';
export type {
  RealWorldTask,
  RealWorldTaskResult,
  RealWorldTaskCategory,
  RealWorldTaskSuiteConfig,
} from './real-world-tasks.js';