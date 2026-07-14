/**
 * AgentOS Alpha Validation — Real-World Task Runner
 *
 * Executes real-world tasks (actual API calls, file operations, data processing)
 * instead of synthetic benchmarks. Each task produces a verifiable artifact.
 *
 * Usage: npx tsx src/cli/run-real-world.ts
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRealWorldTaskSuite, executeRealWorldTaskSuite } from '../real-world-tasks.js';

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  AgentOS Alpha — Real-World Task Suite');
  console.log('  Actual API calls, file operations, and data processing');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  const workDir = mkdtempSync(join(tmpdir(), 'agentos-rw-'));
  console.log(`  Working directory: ${workDir}`);
  console.log('');

  const tasks = createRealWorldTaskSuite({ workDir });

  console.log(`  Executing ${tasks.length} real-world tasks...`);
  console.log('');

  const { results, summary } = await executeRealWorldTaskSuite(tasks);

  // Print per-task results
  console.log('  Per-Task Results:');
  console.log('  ─────────────────────────────────────────────────────────');
  for (const { task, result, verification } of results) {
    const status = verification.passed ? 'PASS' : 'FAIL';
    const cat = task.category.padEnd(22);
    console.log(
      `  ${status}  ${task.id}  [${cat}]  ${result.latencyMs}ms  ${verification.detail}`,
    );
  }
  console.log('');

  // Summary
  console.log('  Summary:');
  console.log(`    Total:     ${summary.total}`);
  console.log(`    Passed:    ${summary.passed}`);
  console.log(`    Failed:    ${summary.failed}`);
  console.log(`    Success:   ${((summary.passed / summary.total) * 100).toFixed(1)}%`);
  console.log(`    Avg Lat:   ${summary.avgLatencyMs.toFixed(0)}ms`);
  console.log('');

  // By category
  const byCategory: Record<string, { total: number; passed: number }> = {};
  for (const { task, verification } of results) {
    if (!byCategory[task.category]) {
      byCategory[task.category] = { total: 0, passed: 0 };
    }
    byCategory[task.category]!.total++;
    if (verification.passed) byCategory[task.category]!.passed++;
  }

  console.log('  By Category:');
  for (const [cat, stats] of Object.entries(byCategory)) {
    const pct = ((stats.passed / stats.total) * 100).toFixed(0);
    console.log(`    ${cat.padEnd(28)} ${stats.passed}/${stats.total} (${pct}%)`);
  }
  console.log('');

  // Clean up
  rmSync(workDir, { recursive: true, force: true });
  console.log(`  Working directory cleaned up: ${workDir}`);
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});