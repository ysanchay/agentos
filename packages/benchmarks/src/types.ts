/**
 * @agentos/benchmarks — Benchmark Type System
 * Type definitions for the 100-benchmark Alpha Validation Program.
 *
 * Every benchmark exercises the complete AgentOS stack and produces
 * 7 required measurements defined in ALPHA_VALIDATION.md §2.3.
 */

import { z } from 'zod';
import type { ResourceBudget, ResourceConsumption } from '@agentos/types';

// ─── Benchmark Categories ─────────────────────────────────────────────────

/**
 * The 10 benchmark categories (ALPHA_VALIDATION.md §2.1).
 * 10 categories × 10 workflows = 100 total benchmarks.
 */
export enum BenchmarkCategory {
  MARKET_RESEARCH = 'market-research',
  COMPETITIVE_INTELLIGENCE = 'competitive-intelligence',
  DOCUMENT_GENERATION = 'document-generation',
  BROWSER_AUTOMATION = 'browser-automation',
  DESKTOP_AUTOMATION = 'desktop-automation',
  FILE_MANAGEMENT = 'file-management',
  PROJECT_PLANNING = 'project-planning',
  REPORTING = 'reporting',
  DATA_COLLECTION = 'data-collection',
  MULTI_STEP_BUSINESS = 'multi-step-business',
}

/** All category values as a readonly tuple for iteration. */
export const BENCHMARK_CATEGORIES: readonly BenchmarkCategory[] = [
  BenchmarkCategory.MARKET_RESEARCH,
  BenchmarkCategory.COMPETITIVE_INTELLIGENCE,
  BenchmarkCategory.DOCUMENT_GENERATION,
  BenchmarkCategory.BROWSER_AUTOMATION,
  BenchmarkCategory.DESKTOP_AUTOMATION,
  BenchmarkCategory.FILE_MANAGEMENT,
  BenchmarkCategory.PROJECT_PLANNING,
  BenchmarkCategory.REPORTING,
  BenchmarkCategory.DATA_COLLECTION,
  BenchmarkCategory.MULTI_STEP_BUSINESS,
] as const;

/** Category prefix used for benchmark IDs (e.g. MR, CI, DG...). */
export const CATEGORY_PREFIX: Record<BenchmarkCategory, string> = {
  [BenchmarkCategory.MARKET_RESEARCH]: 'MR',
  [BenchmarkCategory.COMPETITIVE_INTELLIGENCE]: 'CI',
  [BenchmarkCategory.DOCUMENT_GENERATION]: 'DG',
  [BenchmarkCategory.BROWSER_AUTOMATION]: 'BA',
  [BenchmarkCategory.DESKTOP_AUTOMATION]: 'DA',
  [BenchmarkCategory.FILE_MANAGEMENT]: 'FM',
  [BenchmarkCategory.PROJECT_PLANNING]: 'PP',
  [BenchmarkCategory.REPORTING]: 'RP',
  [BenchmarkCategory.DATA_COLLECTION]: 'DC',
  [BenchmarkCategory.MULTI_STEP_BUSINESS]: 'MS',
};

// ─── Stack Components ──────────────────────────────────────────────────────

/**
 * The subsystem names that make up the AgentOS stack.
 * A benchmark declares which components it must exercise.
 */
export type StackComponent =
  | 'kernel'
  | 'eventstore'
  | 'blackboard'
  | 'resources'
  | 'swarm'
  | 'capabilities'
  | 'memory'
  | 'llm'
  | 'browser'
  | 'desktop'
  | 'simulation'
  | 'offline'
  | 'security'
  | 'mission-control';

/** All stack component values for validation. */
export const ALL_STACK_COMPONENTS: readonly StackComponent[] = [
  'kernel',
  'eventstore',
  'blackboard',
  'resources',
  'swarm',
  'capabilities',
  'memory',
  'llm',
  'browser',
  'desktop',
  'simulation',
  'offline',
  'security',
  'mission-control',
] as const;

// ─── Output Specification ──────────────────────────────────────────────────

/** The kind of artifact a benchmark is expected to produce. */
export type BenchmarkOutputType = 'text' | 'json' | 'file' | 'report';

/**
 * Describes the expected output of a benchmark.
 * Used by the BenchmarkVerifier to check result correctness.
 */
export interface BenchmarkOutputSpec {
  /** The type of output expected. */
  type: BenchmarkOutputType;
  /**
   * Optional Zod schema describing the shape of the output.
   * For 'json' and 'report' types, this validates the structured payload.
   * For 'text' and 'file', it validates metadata about the output if present.
   */
  schema?: z.ZodTypeAny;
  /** Expected file path for 'file' output type. */
  path?: string;
  /** Human-readable description of the expected output. */
  description?: string;
}

// ─── Failure Injection ─────────────────────────────────────────────────────

/**
 * The types of failures that can be injected during a benchmark
 * to test system resilience and recovery (ALPHA_VALIDATION.md §2.5).
 */
export enum FailureType {
  AGENT_CRASH = 'agent-crash',
  NETWORK_DROP = 'network-drop',
  RESOURCE_EXHAUSTION = 'resource-exhaustion',
  CAPABILITY_UNAVAILABLE = 'capability-unavailable',
  VALIDATION_REJECTION = 'validation-rejection',
}

/** All failure type values for validation. */
export const ALL_FAILURE_TYPES: readonly FailureType[] = [
  FailureType.AGENT_CRASH,
  FailureType.NETWORK_DROP,
  FailureType.RESOURCE_EXHAUSTION,
  FailureType.CAPABILITY_UNAVAILABLE,
  FailureType.VALIDATION_REJECTION,
] as const;

/**
 * A failure to inject during benchmark execution.
 * The system must recover without manual intervention.
 */
export interface FailureInjection {
  /** The type of failure to inject. */
  type: FailureType;
  /**
   * The target of the failure.
   * For agent-crash: agent role or ID (e.g. 'worker', 'manager').
   * For network-drop: endpoint or 'all'.
   * For resource-exhaustion: resource unit ('ru' | 'mu' | 'eu' | 'vu').
   * For capability-unavailable: capability path.
   * For validation-rejection: task ID pattern.
   */
  target: string;
  /** Delay in milliseconds from benchmark start before injecting the failure. */
  delay: number;
  /** Duration in milliseconds the failure persists (0 = instantaneous). */
  duration: number;
}

// ─── Offline Scenario ─────────────────────────────────────────────────────

/** The offline mode to simulate during a benchmark. */
export type OfflineMode = 'offline' | 'hybrid' | 'online';

/**
 * A connectivity scenario to simulate during benchmark execution.
 * Tests the offline runtime's ability to handle connectivity changes.
 */
export interface OfflineScenario {
  /** Time in ms from benchmark start to drop connectivity. */
  dropAt: number;
  /** Time in ms from benchmark start to restore connectivity. */
  restoreAt: number;
  /** The mode to transition to during the drop. */
  mode: OfflineMode;
}

// ─── Validation Criteria ───────────────────────────────────────────────────

/**
 * A custom validation check function.
 * Receives the benchmark result and returns whether it passes.
 */
export type CustomCheck = (result: unknown) => { passed: boolean; detail?: string };

/**
 * Criteria used to verify a benchmark result is correct.
 */
export interface ValidationCriteria {
  /** Minimum confidence score (0.0–1.0) the validators must achieve. */
  minConfidence: number;
  /** Expected shape of the output (key names, types, or Zod schema). */
  expectedOutputShape?: Record<string, string> | z.ZodTypeAny;
  /** Custom validation functions to run against the result. */
  customChecks?: CustomCheck[];
}

// ─── Benchmark Specification ────────────────────────────────────────────────

/**
 * The complete specification for a single benchmark.
 * Defined in ALPHA_VALIDATION.md §2.4.
 */
export interface BenchmarkSpec {
  /** Unique benchmark identifier (e.g. "MR-001"). */
  id: string;
  /** The benchmark category. */
  category: BenchmarkCategory;
  /** Human-readable benchmark name. */
  title: string;
  /** User-facing goal statement — what the agent swarm must accomplish. */
  objective: string;
  /** Description of the expected output. */
  expectedOutput: BenchmarkOutputSpec;
  /** Required capability paths (e.g. 'perceive.browser.text'). */
  capabilities: string[];
  /** Which subsystems must be exercised. */
  stackComponents: StackComponent[];
  /** Optional failures to inject during execution. */
  injectFailures?: FailureInjection[];
  /** Optional connectivity disruption scenario. */
  injectOffline?: OfflineScenario;
  /** Resource budget for the benchmark (RU/MU/EU/VU). */
  budget: ResourceBudget;
  /** Maximum execution time in milliseconds. */
  timeout: number;
  /** How to verify the result is correct. */
  validationCriteria: ValidationCriteria;
  /** Whether approval gates (human intervention) are expected. */
  humanInterventionExpected: boolean;
}

// ─── Zod Schema for BenchmarkSpec validation ──────────────────────────────

export const FailureInjectionSchema = z.object({
  type: z.enum([
    FailureType.AGENT_CRASH,
    FailureType.NETWORK_DROP,
    FailureType.RESOURCE_EXHAUSTION,
    FailureType.CAPABILITY_UNAVAILABLE,
    FailureType.VALIDATION_REJECTION,
  ]),
  target: z.string().min(1),
  delay: z.number().nonnegative(),
  duration: z.number().nonnegative(),
});

export const OfflineScenarioSchema = z.object({
  dropAt: z.number().nonnegative(),
  restoreAt: z.number().nonnegative(),
  mode: z.enum(['offline', 'hybrid', 'online']),
});

export const BenchmarkOutputSpecSchema = z.object({
  type: z.enum(['text', 'json', 'file', 'report']),
  path: z.string().optional(),
  description: z.string().optional(),
});

export const ValidationCriteriaSchema = z.object({
  minConfidence: z.number().min(0).max(1),
  expectedOutputShape: z.any().optional(),
});

export const BenchmarkSpecSchema = z.object({
  id: z.string().regex(/^[A-Z]{2}-\d{3}$/),
  category: z.enum([
    BenchmarkCategory.MARKET_RESEARCH,
    BenchmarkCategory.COMPETITIVE_INTELLIGENCE,
    BenchmarkCategory.DOCUMENT_GENERATION,
    BenchmarkCategory.BROWSER_AUTOMATION,
    BenchmarkCategory.DESKTOP_AUTOMATION,
    BenchmarkCategory.FILE_MANAGEMENT,
    BenchmarkCategory.PROJECT_PLANNING,
    BenchmarkCategory.REPORTING,
    BenchmarkCategory.DATA_COLLECTION,
    BenchmarkCategory.MULTI_STEP_BUSINESS,
  ]),
  title: z.string().min(1),
  objective: z.string().min(1),
  expectedOutput: BenchmarkOutputSpecSchema,
  capabilities: z.array(z.string().min(1)).min(1),
  stackComponents: z.array(z.string()).min(1),
  injectFailures: z.array(FailureInjectionSchema).optional(),
  injectOffline: OfflineScenarioSchema.optional(),
  budget: z.object({
    ru: z.number().nonnegative(),
    mu: z.number().nonnegative(),
    eu: z.number().nonnegative(),
    vu: z.number().nonnegative(),
  }),
  timeout: z.number().positive(),
  validationCriteria: ValidationCriteriaSchema,
  humanInterventionExpected: z.boolean(),
});

// ─── Benchmark Metrics (7 required measurements) ──────────────────────────

/**
 * The 7 required measurements per benchmark (ALPHA_VALIDATION.md §2.3).
 * Collected by the MetricsCollector during execution.
 */
export interface BenchmarkMetrics {
  /** 1. Completion Rate — % of tasks that reach terminal 'completed' state. */
  completionRate: number;
  /** 2. Latency — wall-clock time (ms) from goal submission to validated result. */
  latencyMs: number;
  /** 3. Resource Consumption — RU/MU/EU/VU consumed vs allocated. */
  resourceConsumption: ResourceConsumption;
  /** 4. Validation Accuracy — % of validator approvals that are correct. */
  validationAccuracy: number;
  /** 5. Human Intervention Rate — % of benchmarks requiring manual intervention. */
  humanInterventionRate: number;
  /** 6. Recovery Success — % of injected failures the system recovered from. */
  recoverySuccess: number;
  /** 7. Constitutional Compliance — % of invariants that held throughout. */
  constitutionalCompliance: number;
}

// ─── Benchmark Result ──────────────────────────────────────────────────────

/**
 * The result of running a single benchmark.
 */
export interface BenchmarkResult {
  /** ID of the benchmark spec that was run. */
  specId: string;
  /** Whether the benchmark completed successfully. */
  completed: boolean;
  /** Wall-clock latency in milliseconds. */
  latency: number;
  /** Resources consumed during execution. */
  resourceConsumption: ResourceConsumption;
  /** Validation accuracy (0.0–1.0). */
  validationAccuracy: number;
  /** Human intervention rate (0.0–1.0). */
  humanInterventionRate: number;
  /** Recovery success rate for injected failures (0.0–1.0). */
  recoverySuccess: number;
  /** Constitutional compliance percentage (0–100). */
  constitutionalCompliance: number;
  /** Errors encountered during execution. */
  errors: string[];
  /** The 7 required metrics. */
  metrics?: BenchmarkMetrics;
  /** The actual output produced (for verification). */
  output?: unknown;
  /** Timestamp when the benchmark started (ISO8601). */
  startedAt?: string;
  /** Timestamp when the benchmark finished (ISO8601). */
  finishedAt?: string;
}

// ─── Benchmark Suite Result ────────────────────────────────────────────────

/** Per-category summary within a suite result. */
export interface CategorySummary {
  /** Number of benchmarks run in this category. */
  run: number;
  /** Number of benchmarks completed successfully. */
  completed: number;
  /** Average latency in milliseconds. */
  avgLatency: number;
}

/**
 * The result of running a full benchmark suite (all 100 or a category).
 */
export interface BenchmarkSuiteResult {
  /** Individual benchmark results. */
  results: BenchmarkResult[];
  /** Aggregate summary across all benchmarks. */
  summary: {
    /** Total benchmarks run. */
    totalRun: number;
    /** Total benchmarks completed successfully. */
    totalCompleted: number;
    /** Average latency across all benchmarks (ms). */
    avgLatency: number;
    /** Average completion rate (0.0–1.0). */
    avgCompletionRate: number;
    /** Average validation accuracy (0.0–1.0). */
    avgValidationAccuracy: number;
    /** Average recovery success rate (0.0–1.0). */
    avgRecoverySuccess: number;
    /** Average human intervention rate (0.0–1.0). */
    avgHumanInterventionRate: number;
    /** Number of constitutional violations detected. */
    constitutionalViolations: number;
    /** Per-category breakdown. */
    byCategory: Record<BenchmarkCategory, CategorySummary>;
  };
}

// ─── Runner Configuration ──────────────────────────────────────────────────

/** The status of a benchmark during or after execution. */
export type BenchmarkStatus = 'pending' | 'running' | 'completed' | 'failed' | 'timeout';

/**
 * Configuration for the BenchmarkRunner.
 * All subsystem dependencies are injected.
 */
export interface BenchmarkRunnerConfig {
  /** Whether to actually execute capabilities or simulate them. */
  simulateExecution?: boolean;
  /** Clock speed multiplier for simulation mode. */
  clockSpeed?: number;
  /** Whether to verify constitutional invariants after execution. */
  verifyInvariants?: boolean;
  /** Maximum retries for failed tasks within a benchmark. */
  maxRetries?: number;
  /** Number of validators to use per result. */
  validatorsPerResult?: number;
}