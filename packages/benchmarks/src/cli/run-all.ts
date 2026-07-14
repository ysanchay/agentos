/**
 * AgentOS Alpha Validation — Full 100-Benchmark Suite Runner
 *
 * Executes all 100 benchmark workflows across all 10 categories
 * through the full AgentOS stack and produces the complete telemetry dataset.
 *
 * Usage: npx tsx src/cli/run-all.ts
 */

import { createDefaultBenchmarkSuite } from '../index.js';

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  AgentOS Alpha Validation — Full 100-Benchmark Suite');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const suite = createDefaultBenchmarkSuite({
    totalBudget: { ru: 1_000_000, mu: 500_000, eu: 100_000, vu: 50_000 },
  });

  console.log('  Initializing AgentOS stack...');
  console.log('    - Kernel (deterministic runtime, 10 invariants)');
  console.log('    - EventStore (SHA-256 hash chain)');
  console.log('    - Blackboard (7 sections, atomic task claiming)');
  console.log('    - ResourceScheduler (RU/MU/EU/VU, budget enforcement)');
  console.log('    - CapabilityExecutor (7-phase resolution, 5 provider types)');
  console.log('    - SecurityHypervisor (9 pre-invoke + 5 post-invoke checks)');
  console.log('    - MemoryOrchestrator (L1-L4 tiered memory)');
  console.log('    - Offline Runtime (ModeController, InferenceRouter, ExecutionQueue)');
  console.log('');

  console.log('  Executing 100 benchmarks across 10 categories...');
  console.log('');

  const result = await suite.runAll();
  const report = suite.formatReport(result);
  console.log(report);

  // Print per-benchmark details
  console.log('  Per-Benchmark Details:');
  console.log('  ─────────────────────────────────────────────────────────');
  for (const r of result.results) {
    const status = r.completed ? 'PASS' : 'FAIL';
    const metrics = r.metrics;
    const completionPct = metrics ? `${(metrics.completionRate * 100).toFixed(0)}%` : 'N/A';
    const compliancePct = metrics ? `${metrics.constitutionalCompliance.toFixed(0)}%` : 'N/A';
    const validationPct = metrics ? `${(metrics.validationAccuracy * 100).toFixed(0)}%` : 'N/A';
    const recoveryPct = metrics ? `${(metrics.recoverySuccess * 100).toFixed(0)}%` : 'N/A';

    console.log(
      `  ${status}  ${r.specId}  ` +
      `completion=${completionPct}  ` +
      `latency=${r.latency}ms  ` +
      `validation=${validationPct}  ` +
      `recovery=${recoveryPct}  ` +
      `compliance=${compliancePct}  ` +
      `${r.errors.length > 0 ? `errors=[${r.errors.join('; ')}]` : ''}`,
    );
  }
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});