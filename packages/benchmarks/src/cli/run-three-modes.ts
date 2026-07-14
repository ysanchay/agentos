/**
 * AgentOS Alpha Validation — Three-Mode Benchmark Runner
 *
 * Executes the full 100-benchmark suite three times:
 *   1. ONLINE mode — cloud services, full connectivity
 *   2. OFFLINE mode — local models, cached resources, no connectivity
 *   3. CHAOS mode — connectivity-chaos with random failures, outages, recovery
 *
 * Collects production telemetry from all three runs and produces a
 * comparative report against Alpha success criteria.
 *
 * Usage: npx tsx src/cli/run-three-modes.ts
 */

import { createDefaultBenchmarkSuite, BenchmarkCategory } from '../index.js';
import { ModeController, ExecutionQueue, ExecutionMode, ConnectivityState } from '@agentos/offline';
import { ConnectivityChaosTrack } from '../connectivity-chaos-track.js';
import { InMemoryEventStore } from '@agentos/eventstore';
import type { BenchmarkSuiteResult } from '../types.js';

interface ModeRunResult {
  mode: string;
  result: BenchmarkSuiteResult;
  chaosReport?: ReturnType<ConnectivityChaosTrack['getReport']>;
  durationMs: number;
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  AgentOS Alpha Validation — Three-Mode Benchmark Suite');
  console.log('  ONLINE → OFFLINE → CONNECTIVITY-CHAOS');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const totalBudget = { ru: 1_000_000, mu: 500_000, eu: 100_000, vu: 50_000 };
  const runs: ModeRunResult[] = [];

  // ─── Run 1: ONLINE mode ─────────────────────────────────────────────────
  console.log('  [1/3] Running ONLINE mode benchmarks...');
  const onlineStart = Date.now();
  const onlineSuite = createDefaultBenchmarkSuite({ totalBudget });
  // Force ONLINE mode
  const onlineMC = new ModeController();
  await onlineMC.evaluate(ConnectivityState.FULL, 0);
  const onlineResult = await onlineSuite.runAll();
  const onlineDuration = Date.now() - onlineStart;
  console.log(`    Done in ${onlineDuration}ms — ${onlineResult.summary.totalCompleted}/${onlineResult.summary.totalRun} completed`);
  runs.push({ mode: 'ONLINE', result: onlineResult, durationMs: onlineDuration });

  // ─── Run 2: OFFLINE mode ─────────────────────────────────────────────────
  console.log('  [2/3] Running OFFLINE mode benchmarks...');
  const offlineStart = Date.now();
  const offlineSuite = createDefaultBenchmarkSuite({ totalBudget });
  // Force OFFLINE mode
  const offlineMC = new ModeController();
  await offlineMC.evaluate(ConnectivityState.NONE, 0);
  const offlineResult = await offlineSuite.runAll();
  const offlineDuration = Date.now() - offlineStart;
  console.log(`    Done in ${offlineDuration}ms — ${offlineResult.summary.totalCompleted}/${offlineResult.summary.totalRun} completed`);
  runs.push({ mode: 'OFFLINE', result: offlineResult, durationMs: offlineDuration });

  // ─── Run 3: CHAOS mode ──────────────────────────────────────────────────
  console.log('  [3/3] Running CONNECTIVITY-CHAOS mode benchmarks...');
  const chaosStart = Date.now();
  const chaosEventStore = new InMemoryEventStore();
  const chaosMC = new ModeController({ eventStore: chaosEventStore });
  const chaosQueue = new ExecutionQueue({ eventStore: chaosEventStore });
  const chaosTrack = new ConnectivityChaosTrack(chaosMC, chaosQueue, {
    dropIntervalMs: 500,
    minDropDurationMs: 100,
    maxDropDurationMs: 300,
    totalDrops: 10,
    saturationProbability: 0.3,
    saturationBatchSize: 10,
    modelOutageProbability: 0.2,
  });

  const chaosSuite = createDefaultBenchmarkSuite({
    totalBudget,
    modeController: chaosMC,
  });
  chaosTrack.start();
  const chaosResult = await chaosSuite.runAll();
  chaosTrack.stop();
  const chaosReport = chaosTrack.getReport();
  const chaosDuration = Date.now() - chaosStart;
  console.log(`    Done in ${chaosDuration}ms — ${chaosResult.summary.totalCompleted}/${chaosResult.summary.totalRun} completed`);
  console.log(`    Chaos: ${chaosReport.totalDrops} drops, ${chaosReport.totalRestores} restores, ${chaosReport.totalModeTransitions} mode transitions, max queue depth ${chaosReport.maxQueueDepth}`);
  runs.push({ mode: 'CHAOS', result: chaosResult, chaosReport, durationMs: chaosDuration });

  // ─── Comparative Report ─────────────────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Three-Mode Comparative Report');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const header = '  Metric                       ONLINE          OFFLINE         CHAOS';
  console.log(header);
  console.log('  ' + '─'.repeat(76));

  const metrics = [
    { label: 'Total Run', get: (r: BenchmarkSuiteResult) => `${r.summary.totalRun}` },
    { label: 'Total Completed', get: (r: BenchmarkSuiteResult) => `${r.summary.totalCompleted}` },
    { label: 'Completion Rate', get: (r: BenchmarkSuiteResult) => `${(r.summary.avgCompletionRate * 100).toFixed(1)}%` },
    { label: 'Avg Latency (ms)', get: (r: BenchmarkSuiteResult) => `${r.summary.avgLatency.toFixed(0)}` },
    { label: 'Avg Validation Acc', get: (r: BenchmarkSuiteResult) => `${(r.summary.avgValidationAccuracy * 100).toFixed(1)}%` },
    { label: 'Avg Recovery Success', get: (r: BenchmarkSuiteResult) => `${(r.summary.avgRecoverySuccess * 100).toFixed(1)}%` },
    { label: 'Avg Human Interv', get: (r: BenchmarkSuiteResult) => `${(r.summary.avgHumanInterventionRate * 100).toFixed(1)}%` },
    { label: 'Const. Violations', get: (r: BenchmarkSuiteResult) => `${r.summary.constitutionalViolations}` },
    { label: 'Duration (s)', get: (_r: BenchmarkSuiteResult, d: number) => `${(d / 1000).toFixed(1)}` },
  ];

  for (const m of metrics) {
    const online = m.get(runs[0]!.result, runs[0]!.durationMs).padStart(14);
    const offline = m.get(runs[1]!.result, runs[1]!.durationMs).padStart(14);
    const chaos = m.get(runs[2]!.result, runs[2]!.durationMs).padStart(14);
    console.log(`  ${m.label.padEnd(28)} ${online}     ${offline}     ${chaos}`);
  }

  // Chaos-specific metrics
  if (runs[2]!.chaosReport) {
    const cr = runs[2]!.chaosReport;
    console.log('');
    console.log('  Chaos Track Metrics:');
    console.log(`    Total Drops:              ${cr.totalDrops}`);
    console.log(`    Total Restores:           ${cr.totalRestores}`);
    console.log(`    Total Mode Transitions:   ${cr.totalModeTransitions}`);
    console.log(`    Max Queue Depth:          ${cr.maxQueueDepth}`);
    console.log(`    Queue Saturation Events:  ${cr.totalQueueSaturationEvents}`);
    console.log(`    Model Outages:            ${cr.totalModelOutages}`);
    console.log(`    Total Recoveries:         ${cr.totalRecoveries}`);
  }

  // Alpha success criteria per mode
  console.log('');
  console.log('  Alpha Success Criteria by Mode:');
  console.log('  ' + '─'.repeat(76));
  const criteria = [
    { label: '>=80% completion rate', check: (r: BenchmarkSuiteResult) => r.summary.avgCompletionRate >= 0.8 },
    { label: 'Zero const. violations', check: (r: BenchmarkSuiteResult) => r.summary.constitutionalViolations === 0 },
    { label: 'Recovery success >=90%', check: (r: BenchmarkSuiteResult) => r.summary.avgRecoverySuccess >= 0.9 },
    { label: 'Human intervention <=10%', check: (r: BenchmarkSuiteResult) => r.summary.avgHumanInterventionRate <= 0.1 },
  ];

  const modeNames = ['ONLINE', 'OFFLINE', 'CHAOS'];
  const header2 = '  Criterion' + ' '.repeat(24) + modeNames.map(m => m.padStart(14)).join('     ');
  console.log(header2);
  for (const c of criteria) {
    const statuses = runs.map(r => c.check(r.result) ? 'PASS' : 'FAIL');
    console.log(`  ${c.label.padEnd(28)} ${statuses.map(s => s.padStart(14)).join('     ')}`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});