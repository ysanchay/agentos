/**
 * @agentos/benchmarks — Benchmark Suite
 * Runs all 100 benchmarks (or a category subset) and produces structured results
 * (ALPHA_VALIDATION.md §2.5).
 *
 * Provides:
 *   - runAll(): run all 100 benchmarks
 *   - runCategory(category): run benchmarks for one category
 *   - runOne(id): run a single benchmark
 *   - Produces a structured BenchmarkSuiteResult with aggregate summary
 */

import {
  createUUID,
  type ResourceBudget,
} from '@agentos/types';
import { Kernel } from '@agentos/kernel';
import { InMemoryEventStore } from '@agentos/eventstore';
import { Blackboard } from '@agentos/blackboard';
import { ResourceScheduler } from '@agentos/resources';
import { CapabilityRegistry } from '@agentos/capabilities';
import { CapabilityResolver } from '@agentos/capabilities';
import { CapabilityExecutor } from '@agentos/capabilities';
import { SecurityHypervisor } from '@agentos/capabilities';
import { SandboxManager } from '@agentos/capabilities';
import { ConsumptionTracker } from '@agentos/capabilities';
import { createProductionPolicy } from '@agentos/capabilities';
import { MemoryOrchestrator } from '@agentos/memory';
import type { LLMClient } from '@agentos/llm';
import type { BrowserProvider } from '@agentos/browser';
import type { DesktopProvider } from '@agentos/desktop';
import type { SimulationClock } from '@agentos/simulation';
import type { ModeController } from '@agentos/offline';

import {
  BenchmarkCategory,
  BENCHMARK_CATEGORIES,
  type BenchmarkSpec,
  type BenchmarkResult,
  type BenchmarkSuiteResult,
  type CategorySummary,
} from './types.js';
import { BENCHMARK_SPECS, getSpecsByCategory, getSpecById, TOTAL_BENCHMARKS } from './benchmark-specs.js';
import { BenchmarkRunner, type BenchmarkRunnerDeps } from './benchmark-runner.js';
import { BenchmarkVerifier } from './benchmark-verifier.js';

/**
 * Configuration for the BenchmarkSuite.
 * Same as BenchmarkRunnerDeps plus suite-level options.
 */
export interface BenchmarkSuiteConfig extends BenchmarkRunnerDeps {
  /** Whether to stop on first failure (default: false). */
  stopOnFailure?: boolean;
  /** Delay between benchmarks in ms (default: 100). */
  delayBetweenBenchmarks?: number;
  /** Whether to verify results after execution (default: true). */
  verifyResults?: boolean;
}

// ─── BenchmarkSuite ────────────────────────────────────────────────────────

/**
 * BenchmarkSuite — runs benchmarks and aggregates results.
 *
 * Usage:
 *   const suite = new BenchmarkSuite(deps);
 *   const result = await suite.runAll();
 *   console.log(suite.formatReport(result));
 */
export class BenchmarkSuite {
  private config: Required<BenchmarkSuiteConfig>;
  private runner: BenchmarkRunner;
  private verifier: BenchmarkVerifier;

  constructor(config: BenchmarkSuiteConfig) {
    this.config = {
      stopOnFailure: false,
      delayBetweenBenchmarks: 100,
      verifyResults: true,
      ...config,
    } as Required<BenchmarkSuiteConfig>;
    this.runner = new BenchmarkRunner(config);
    this.verifier = new BenchmarkVerifier();
  }

  /**
   * Run all 100 benchmarks.
   */
  async runAll(): Promise<BenchmarkSuiteResult> {
    return this.runSpecs(BENCHMARK_SPECS);
  }

  /**
   * Run benchmarks for a single category.
   */
  async runCategory(category: BenchmarkCategory): Promise<BenchmarkSuiteResult> {
    const specs = getSpecsByCategory(category);
    return this.runSpecs(specs);
  }

  /**
   * Run a single benchmark by ID.
   */
  async runOne(id: string): Promise<BenchmarkResult> {
    const spec = getSpecById(id);
    if (!spec) {
      return {
        specId: id,
        completed: false,
        latency: 0,
        resourceConsumption: { ru: 0, mu: 0, eu: 0, vu: 0 },
        validationAccuracy: 0,
        humanInterventionRate: 0,
        recoverySuccess: 0,
        constitutionalCompliance: 0,
        errors: [`Benchmark spec "${id}" not found`],
      };
    }
    return this.runner.run(spec);
  }

  /**
   * Run a set of benchmark specs and produce a suite result.
   */
  async runSpecs(specs: BenchmarkSpec[]): Promise<BenchmarkSuiteResult> {
    const results: BenchmarkResult[] = [];

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!;
      const result = await this.runner.run(spec);
      results.push(result);

      // Verify if enabled
      if (this.config.verifyResults) {
        const verification = this.verifier.verify(spec, result);
        if (!verification.passed) {
          // Append verification issues to result errors
          result.errors.push(...verification.issues);
        }
      }

      // Stop on failure if configured
      if (this.config.stopOnFailure && !result.completed) {
        // Skip remaining benchmarks
        for (let j = i + 1; j < specs.length; j++) {
          const skippedSpec = specs[j]!;
          results.push({
            specId: skippedSpec.id,
            completed: false,
            latency: 0,
            resourceConsumption: { ru: 0, mu: 0, eu: 0, vu: 0 },
            validationAccuracy: 0,
            humanInterventionRate: 0,
            recoverySuccess: 0,
            constitutionalCompliance: 0,
            errors: ['Skipped due to stopOnFailure'],
          });
        }
        break;
      }

      // Delay between benchmarks
      if (this.config.delayBetweenBenchmarks > 0 && i < specs.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, this.config.delayBetweenBenchmarks));
      }
    }

    return this.buildSuiteResult(results);
  }

  /**
   * Build a BenchmarkSuiteResult from individual results.
   */
  private buildSuiteResult(results: BenchmarkResult[]): BenchmarkSuiteResult {
    const totalRun = results.length;
    const totalCompleted = results.filter((r) => r.completed).length;
    const avgLatency = totalRun > 0
      ? results.reduce((sum, r) => sum + r.latency, 0) / totalRun
      : 0;
    const avgCompletionRate = totalRun > 0 ? totalCompleted / totalRun : 0;
    const avgValidationAccuracy = totalRun > 0
      ? results.reduce((sum, r) => sum + r.validationAccuracy, 0) / totalRun
      : 0;
    const avgRecoverySuccess = totalRun > 0
      ? results.reduce((sum, r) => sum + r.recoverySuccess, 0) / totalRun
      : 0;
    const avgHumanInterventionRate = totalRun > 0
      ? results.reduce((sum, r) => sum + r.humanInterventionRate, 0) / totalRun
      : 0;
    const constitutionalViolations = results.filter(
      (r) => r.constitutionalCompliance < 100,
    ).length;

    // Per-category breakdown
    const byCategory = {} as Record<BenchmarkCategory, CategorySummary>;
    for (const category of BENCHMARK_CATEGORIES) {
      const categoryResults = results.filter((r) => {
        const spec = getSpecById(r.specId);
        return spec?.category === category;
      });
      const run = categoryResults.length;
      const completed = categoryResults.filter((r) => r.completed).length;
      const avgLat = run > 0
        ? categoryResults.reduce((sum, r) => sum + r.latency, 0) / run
        : 0;
      byCategory[category] = { run, completed, avgLatency: avgLat };
    }

    return {
      results,
      summary: {
        totalRun,
        totalCompleted,
        avgLatency,
        avgCompletionRate,
        avgValidationAccuracy,
        avgRecoverySuccess,
        avgHumanInterventionRate,
        constitutionalViolations,
        byCategory,
      },
    };
  }

  /**
   * Format a suite result as a human-readable report.
   */
  formatReport(result: BenchmarkSuiteResult): string {
    const lines: string[] = [];
    const s = result.summary;

    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('  AgentOS Alpha Validation — Benchmark Suite Report');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');
    lines.push('  Overall Summary:');
    lines.push(`    Total Run:           ${s.totalRun} / ${TOTAL_BENCHMARKS}`);
    lines.push(`    Total Completed:     ${s.totalCompleted} / ${s.totalRun}`);
    lines.push(`    Avg Completion Rate: ${(s.avgCompletionRate * 100).toFixed(1)}%`);
    lines.push(`    Avg Latency:         ${s.avgLatency.toFixed(0)}ms`);
    lines.push(`    Avg Validation Acc:  ${(s.avgValidationAccuracy * 100).toFixed(1)}%`);
    lines.push(`    Avg Recovery Success: ${(s.avgRecoverySuccess * 100).toFixed(1)}%`);
    lines.push(`    Avg Human Interv:    ${(s.avgHumanInterventionRate * 100).toFixed(1)}%`);
    lines.push(`    Const. Violations:   ${s.constitutionalViolations}`);
    lines.push('');

    lines.push('  By Category:');
    for (const category of BENCHMARK_CATEGORIES) {
      const cat = s.byCategory[category];
      if (!cat || cat.run === 0) continue;
      const completionPct = cat.run > 0 ? ((cat.completed / cat.run) * 100).toFixed(1) : '0.0';
      lines.push(
        `    ${category.padEnd(28)} ${cat.completed}/${cat.run} (${completionPct}%)  avg ${cat.avgLatency.toFixed(0)}ms`,
      );
    }
    lines.push('');

    // Success criteria check (ALPHA_VALIDATION.md §8)
    lines.push('  Alpha Success Criteria:');
    const criteria = [
      { label: '≥80% completion rate', passed: s.avgCompletionRate >= 0.8, value: `${(s.avgCompletionRate * 100).toFixed(1)}%` },
      { label: 'Zero constitutional violations', passed: s.constitutionalViolations === 0, value: `${s.constitutionalViolations}` },
      { label: 'Recovery success ≥90%', passed: s.avgRecoverySuccess >= 0.9, value: `${(s.avgRecoverySuccess * 100).toFixed(1)}%` },
      { label: 'Human intervention ≤10%', passed: s.avgHumanInterventionRate <= 0.1, value: `${(s.avgHumanInterventionRate * 100).toFixed(1)}%` },
    ];
    for (const c of criteria) {
      const status = c.passed ? '✓' : '✗';
      lines.push(`    ${status} ${c.label.padEnd(35)} ${c.value}`);
    }
    lines.push('');

    // Failed benchmarks
    const failed = result.results.filter((r) => !r.completed || r.errors.length > 0);
    if (failed.length > 0) {
      lines.push(`  Failed/Errored Benchmarks (${failed.length}):`);
      for (const f of failed.slice(0, 20)) {
        lines.push(`    ${f.specId}: ${f.errors[0] ?? 'incomplete'}`);
      }
      if (failed.length > 20) {
        lines.push(`    ... and ${failed.length - 20} more`);
      }
      lines.push('');
    }

    lines.push('═══════════════════════════════════════════════════════════');
    return lines.join('\n');
  }
}

// ─── Factory: create a default suite with real subsystems ──────────────────

/**
 * Create a BenchmarkSuite with default subsystem instances.
 * This is the easiest way to get started — all subsystems are created
 * with sensible defaults.
 *
 * @param overrides - Optional overrides for specific subsystems.
 */
export function createDefaultBenchmarkSuite(overrides?: {
  llmClient?: LLMClient;
  browserProvider?: BrowserProvider;
  desktopProvider?: DesktopProvider;
  modeController?: ModeController;
  simulationClock?: SimulationClock;
  totalBudget?: ResourceBudget;
}): BenchmarkSuite {
  const eventStore = new InMemoryEventStore();
  const kernel = new Kernel({ eventStore });
  const workspaceId = createUUID() as unknown as import('@agentos/types').WorkspaceID;
  const blackboard = new Blackboard(workspaceId);
  const totalBudget = overrides?.totalBudget ?? { ru: 100000, mu: 50000, eu: 20000, vu: 5000 };
  const scheduler = new ResourceScheduler({ totalCapacity: totalBudget });

  const registry = new CapabilityRegistry();
  const resolver = new CapabilityResolver(registry);
  const policy = createProductionPolicy();
  const hypervisor = new SecurityHypervisor(policy);
  const sandboxManager = new SandboxManager();
  const consumptionTracker = new ConsumptionTracker();
  const capabilityExecutor = new CapabilityExecutor({
    registry,
    resolver,
    hypervisor,
    sandboxManager,
    consumptionTracker,
  });

  const memoryOrchestrator = new MemoryOrchestrator();

  return new BenchmarkSuite({
    kernel,
    eventStore,
    blackboard,
    scheduler,
    capabilityExecutor,
    memoryOrchestrator,
    securityHypervisor: hypervisor,
    llmClient: overrides?.llmClient,
    browserProvider: overrides?.browserProvider,
    desktopProvider: overrides?.desktopProvider,
    modeController: overrides?.modeController,
    simulationClock: overrides?.simulationClock,
  });
}