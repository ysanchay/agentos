/**
 * @agentos/swarm — Scaling Benchmarks
 * Tests swarm at 100, 500, and 1000 agents with deterministic simulation.
 * Measures: completion rate, resource utilization, task duplication, latency,
 * deadlock frequency, recovery success, validation accuracy, message throughput.
 */

import { describe, it, expect } from 'vitest';
import { SwarmCoordinator, type SwarmRunConfig, type SwarmResult } from '../src/swarm-coordinator.js';
import { MemoryOrchestrator } from '@agentos/memory';
import type { WorkspaceID, AgentID, TaskID } from '@agentos/types';
import { createUUID } from '@agentos/types';

// ─── Benchmark Configurations ──────────────────────────────────────────────

interface BenchmarkScale {
  name: string;
  chiefCount: number;
  managerCount: number;
  workerCount: number;
  validatorCount: number;
  workspaceCount: number;
  totalBudget: { ru: number; mu: number; eu: number; vu: number };
}

const SCALES: BenchmarkScale[] = [
  {
    name: '100-agent swarm',
    chiefCount: 1,
    managerCount: 5,
    workerCount: 84,
    validatorCount: 10,
    workspaceCount: 3,
    totalBudget: { ru: 500_000, mu: 200_000, eu: 50_000, vu: 10_000 },
  },
  {
    name: '500-agent swarm',
    chiefCount: 1,
    managerCount: 10,
    workerCount: 469,
    validatorCount: 20,
    workspaceCount: 5,
    totalBudget: { ru: 2_500_000, mu: 1_000_000, eu: 250_000, vu: 50_000 },
  },
  {
    name: '1000-agent swarm',
    chiefCount: 1,
    managerCount: 20,
    workerCount: 959,
    validatorCount: 20,
    workspaceCount: 10,
    totalBudget: { ru: 5_000_000, mu: 2_000_000, eu: 500_000, vu: 100_000 },
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

async function runBenchmark(scale: BenchmarkScale): Promise<SwarmResult & { scale: BenchmarkScale }> {
  const config: SwarmRunConfig = {
    chiefCount: scale.chiefCount,
    managerCount: scale.managerCount,
    workerCount: scale.workerCount,
    validatorCount: scale.validatorCount,
    workspaceCount: scale.workspaceCount,
    totalBudget: scale.totalBudget,
    randomSeed: 42,
    clockSpeed: 10,
  };

  const coordinator = new SwarmCoordinator(config);

  const result = await coordinator.run({
    title: `${scale.name} benchmark goal`,
    description: 'Build the authentication system with proper security, testing, and documentation',
    priority: 3 as any,
  });

  return { ...result, scale };
}

function formatBenchmarkResult(result: SwarmResult & { scale: BenchmarkScale }): string {
  const m = result.metrics;
  const totalAgents = result.scale.chiefCount + result.scale.managerCount +
    result.scale.workerCount + result.scale.validatorCount;

  return [
    `=== ${result.scale.name} ===`,
    `  Agents:            ${totalAgents} (${result.scale.chiefCount} chief, ${result.scale.managerCount} managers, ${result.scale.workerCount} workers, ${result.scale.validatorCount} validators)`,
    `  Total agents:      ${m.totalAgents}`,
    `  Duration:          ${result.durationMs}ms`,
    `  Tasks total:       ${m.totalTasks}`,
    `  Tasks completed:   ${m.completedTasks}`,
    `  Tasks failed:      ${m.failedTasks}`,
    `  Completion rate:   ${(m.completionRate * 100).toFixed(1)}%`,
    `  RU allocated:      ${m.ruAllocated}`,
    `  RU consumed:       ${m.ruConsumed}`,
    `  MU consumed:       ${m.muConsumed}`,
    `  Messages:          ${m.messagesSent}`,
    `  Validations:       ${m.validationRequests} (${m.validationApprovals} approved, ${m.validationRejections} rejected)`,
    `  Validation rate:    ${(m.validationAccuracy * 100).toFixed(1)}%`,
    `  Task duplication:  ${m.taskDuplication}`,
    `  Deadlocks:         ${m.deadlockCount}`,
    `  Recovery rate:     ${(m.recoverySuccessRate * 100).toFixed(1)}%`,
    `  Verification:      ${result.verification.allPassed ? 'ALL PASSED' : 'FAILED'}`,
    `-----------------------------------`,
  ].join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// Scaling Benchmarks
// ═══════════════════════════════════════════════════════════════════════════

describe('Swarm Scaling Benchmarks', () => {
  it('should run 100-agent swarm to completion', async () => {
    const result = await runBenchmark(SCALES[0]!);
    console.log(formatBenchmarkResult(result));

    expect(result.success).toBe(true);
    expect(result.verification.allPassed).toBe(true);
    expect(result.metrics.totalAgents).toBe(100);
  }, 30_000);

  it('should run 500-agent swarm to completion', async () => {
    const result = await runBenchmark(SCALES[1]!);
    console.log(formatBenchmarkResult(result));

    expect(result.success).toBe(true);
    expect(result.verification.allPassed).toBe(true);
    expect(result.metrics.totalAgents).toBe(500);
  }, 60_000);

  it('should run 1000-agent swarm to completion', async () => {
    const result = await runBenchmark(SCALES[2]!);
    console.log(formatBenchmarkResult(result));

    expect(result.success).toBe(true);
    expect(result.verification.allPassed).toBe(true);
    expect(result.metrics.totalAgents).toBe(1000);
  }, 120_000);

  it('should have agents spawned at all scales', async () => {
    for (const scale of SCALES) {
      const result = await runBenchmark(scale);
      const totalAgents = scale.chiefCount + scale.managerCount +
        scale.workerCount + scale.validatorCount;
      expect(result.metrics.totalAgents).toBe(totalAgents);
    }
  }, 300_000);

  it('should maintain resource conservation at all scales', async () => {
    for (const scale of SCALES) {
      const result = await runBenchmark(scale);
      expect(result.metrics.ruConsumed).toBeLessThanOrEqual(result.metrics.ruAllocated);
      expect(result.metrics.muConsumed).toBeLessThanOrEqual(result.metrics.muAllocated);
    }
  }, 300_000);

  it('should produce deterministic results with same seed', async () => {
    const scale = SCALES[0]!;
    const result1 = await runBenchmark(scale);
    const result2 = await runBenchmark(scale);

    expect(result1.metrics.totalTasks).toBe(result2.metrics.totalTasks);
    expect(result1.metrics.completedTasks).toBe(result2.metrics.completedTasks);
    expect(result1.metrics.totalAgents).toBe(result2.metrics.totalAgents);
  }, 30_000);

  it('should generate memory artifacts from swarm results', async () => {
    const scale = SCALES[0]!;
    const coordinator = new SwarmCoordinator({
      chiefCount: scale.chiefCount,
      managerCount: scale.managerCount,
      workerCount: scale.workerCount,
      validatorCount: scale.validatorCount,
      workspaceCount: scale.workspaceCount,
      totalBudget: scale.totalBudget,
      randomSeed: 42,
    });

    const result = await coordinator.run({
      title: 'Memory integration benchmark',
      description: 'Test memory artifact generation',
      priority: 3 as any,
    });

    // Generate memory artifacts from the metrics data
    const memoryOrchestrator = new MemoryOrchestrator({}, () => Date.now());
    const wId = createUUID() as unknown as WorkspaceID;

    // Generate goal artifact
    const goalArtifacts = memoryOrchestrator.generateArtifact(
      { type: 'goal', goalId: 'bench-goal', title: 'Memory integration benchmark', status: 'completed' },
      wId,
    );
    expect(goalArtifacts.length).toBeGreaterThanOrEqual(1);

    // Generate decision artifacts from metrics
    if (result.metrics.completedTasks > 0) {
      const aId = createUUID() as unknown as AgentID;
      const tId = createUUID() as unknown as TaskID;
      const artifacts = memoryOrchestrator.generateArtifact(
        { type: 'task_result', taskId: tId, agentId: aId, output: { completedTasks: result.metrics.completedTasks }, confidence: 0.85 },
        wId,
      );
      expect(artifacts.length).toBeGreaterThanOrEqual(1);
    }

    // Graph should have nodes and edges
    const stats = memoryOrchestrator.getStats();
    expect(stats.totalGraphNodes).toBeGreaterThan(0);
  }, 30_000);

  it('should produce benchmark comparison across scales', async () => {
    const results: Array<SwarmResult & { scale: BenchmarkScale }> = [];
    for (const scale of SCALES) {
      results.push(await runBenchmark(scale));
    }

    console.log('\n==========================================');
    console.log('  AgentOS Swarm Scaling Benchmark Report');
    console.log('==========================================\n');

    for (const result of results) {
      console.log(formatBenchmarkResult(result));
    }

    console.log('==========================================');
    console.log('  Comparison Table');
    console.log('==========================================');
    console.log('  Scale     | Tasks | Completed | Failed | Duration');

    for (const result of results) {
      const totalAgents = result.scale.chiefCount + result.scale.managerCount +
        result.scale.workerCount + result.scale.validatorCount;
      console.log(
        `  ${totalAgents.toString().padStart(4)} agents | ${result.metrics.totalTasks.toString().padStart(5)} | ` +
        `${result.metrics.completedTasks.toString().padStart(9)} | ${result.metrics.failedTasks.toString().padStart(6)} | ` +
        `${result.durationMs.toString().padStart(6)}ms`,
      );
    }

    console.log('==========================================\n');

    for (const result of results) {
      expect(result.success).toBe(true);
    }
  }, 300_000);
});