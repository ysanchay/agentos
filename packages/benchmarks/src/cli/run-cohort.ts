/**
 * AgentOS Alpha Validation — First Benchmark Cohort Runner
 *
 * Executes the first 10 benchmark workflows (Market Research category,
 * MR-001 through MR-010) through the full AgentOS stack and produces
 * the initial telemetry dataset.
 *
 * Usage: npx tsx src/cli/run-cohort.ts
 */

import { createDefaultBenchmarkSuite, BenchmarkCategory } from '../index.js';

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  AgentOS Alpha Validation — First Benchmark Cohort');
  console.log('  Category: Market Research (MR-001 through MR-010)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Create the benchmark suite with default subsystems
  const suite = createDefaultBenchmarkSuite({
    totalBudget: { ru: 500_000, mu: 200_000, eu: 50_000, vu: 10_000 },
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

  // Run the Market Research category (first 10 benchmarks)
  console.log('  Executing 10 benchmarks...');
  console.log('');

  const result = await suite.runCategory(BenchmarkCategory.MARKET_RESEARCH);

  // Print the report
  const report = suite.formatReport(result);
  console.log(report);

  // Print per-benchmark details
  console.log('  Per-Benchmark Details:');
  console.log('  ─────────────────────────────────────────────────────────');
  for (const r of result.results) {
    const status = r.completed ? 'PASS' : 'FAIL';
    const metrics = r.metrics;
    const completionPct = metrics
      ? `${(metrics.completionRate * 100).toFixed(0)}%`
      : 'N/A';
    const compliancePct = metrics
      ? `${metrics.constitutionalCompliance.toFixed(0)}%`
      : 'N/A';
    const validationPct = metrics
      ? `${(metrics.validationAccuracy * 100).toFixed(0)}%`
      : 'N/A';
    const recoveryPct = metrics
      ? `${(metrics.recoverySuccess * 100).toFixed(0)}%`
      : 'N/A';

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

  // Print telemetry summary for Reputation Engine calibration
  console.log('  Telemetry Summary (for Reputation Engine / Agent Economy calibration):');
  console.log('  ─────────────────────────────────────────────────────────');
  const s = result.summary;
  console.log(`    Total Run:              ${s.totalRun}`);
  console.log(`    Total Completed:        ${s.totalCompleted}`);
  console.log(`    Completion Rate:       ${(s.avgCompletionRate * 100).toFixed(1)}%`);
  console.log(`    Avg Latency:            ${s.avgLatency.toFixed(0)}ms`);
  console.log(`    Avg Validation Accuracy: ${(s.avgValidationAccuracy * 100).toFixed(1)}%`);
  console.log(`    Avg Recovery Success:   ${(s.avgRecoverySuccess * 100).toFixed(1)}%`);
  console.log(`    Avg Human Intervention: ${(s.avgHumanInterventionRate * 100).toFixed(1)}%`);
  console.log(`    Constitutional Violations: ${s.constitutionalViolations}`);
  console.log('');

  // Resource consumption telemetry
  console.log('  Resource Consumption Telemetry:');
  console.log('  ─────────────────────────────────────────────────────────');
  let totalRU = 0, totalMU = 0, totalEU = 0, totalVU = 0;
  for (const r of result.results) {
    totalRU += r.resourceConsumption.ru;
    totalMU += r.resourceConsumption.mu;
    totalEU += r.resourceConsumption.eu;
    totalVU += r.resourceConsumption.vu;
  }
  console.log(`    Total RU consumed:     ${totalRU}`);
  console.log(`    Total MU consumed:     ${totalMU}`);
  console.log(`    Total EU consumed:     ${totalEU}`);
  console.log(`    Total VU consumed:     ${totalVU}`);
  console.log(`    RU:MU:EU:VU ratio:     ${totalRU > 0 ? (totalMU / totalRU).toFixed(2) : '0'}:${totalRU > 0 ? (totalEU / totalRU).toFixed(2) : '0'}:${totalRU > 0 ? (totalVU / totalRU).toFixed(2) : '0'}`);
  console.log('');

  // Success criteria evaluation
  console.log('  Alpha Success Criteria Evaluation:');
  console.log('  ─────────────────────────────────────────────────────────');
  const criteria = [
    { label: '>=80% completion rate', passed: s.avgCompletionRate >= 0.8, value: `${(s.avgCompletionRate * 100).toFixed(1)}%` },
    { label: 'Zero constitutional violations', passed: s.constitutionalViolations === 0, value: `${s.constitutionalViolations}` },
    { label: 'Recovery success >=90%', passed: s.avgRecoverySuccess >= 0.9, value: `${(s.avgRecoverySuccess * 100).toFixed(1)}%` },
    { label: 'Human intervention <=10%', passed: s.avgHumanInterventionRate <= 0.1, value: `${(s.avgHumanInterventionRate * 100).toFixed(1)}%` },
  ];
  for (const c of criteria) {
    const status = c.passed ? 'PASS' : 'FAIL';
    console.log(`    ${status}  ${c.label}  ${c.value}`);
  }
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});