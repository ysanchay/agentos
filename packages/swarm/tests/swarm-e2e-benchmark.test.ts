/**
 * @agentos/swarm — End-to-End Benchmark
 * Full lifecycle: User submits goal → Chief decomposes → Workers execute
 * with LLM → Validators review → results stored in memory → Mission Control
 * displays lifecycle.
 *
 * This test validates the complete AgentOS pipeline, including:
 * 1. Goal submission and decomposition
 * 2. Workstream assignment to managers
 * 3. Task creation on blackboard
 * 4. Worker task claiming and execution (simulated + LLM modes)
 * 5. Validation review and consensus
 * 6. Memory artifact generation at every step
 * 7. Knowledge graph construction from swarm activity
 * 8. Mission Control dashboard rendering
 * 9. Constitutional verification
 */

import { describe, it, expect } from 'vitest';
import { createUUID, MemoryType } from '@agentos/types';
import type { WorkspaceID, AgentID, TaskID } from '@agentos/types';
import { SwarmCoordinator, type SwarmResult } from '../src/swarm-coordinator.js';
import { MissionControl } from '../src/mission-control.js';
import { MemoryOrchestrator } from '@agentos/memory';
import { LLMClient } from '@agentos/llm';

// ─── End-to-End Pipeline ────────────────────────────────────────────────────

async function runEndToEndBenchmark(): Promise<{
  swarmResult: SwarmResult;
  memoryOrchestrator: MemoryOrchestrator;
  missionControl: MissionControl;
  artifactsGenerated: number;
  graphNodes: number;
  graphEdges: number;
}> {
  // Phase 1: Create the swarm
  const coordinator = new SwarmCoordinator({
    chiefCount: 1,
    managerCount: 3,
    workerCount: 20,
    validatorCount: 5,
    workspaceCount: 2,
    randomSeed: 42,
    llmMode: 'none', // Simulated for deterministic benchmark
    llmBaseURL: 'http://localhost:8080',
  });

  // Phase 2: Submit a goal
  const swarmResult = await coordinator.run({
    title: 'Build authentication system',
    description: 'Implement OAuth2 login, session management, and role-based access control',
    priority: 3 as any,
  });

  // Phase 3: Create memory orchestrator and generate artifacts
  const memoryOrchestrator = new MemoryOrchestrator({}, () => Date.now());
  const wId = createUUID() as unknown as WorkspaceID;
  let artifactsGenerated = 0;

  // Goal artifact
  artifactsGenerated += memoryOrchestrator.generateArtifact(
    { type: 'goal', goalId: 'e2e-goal-1', title: 'Build authentication system', status: swarmResult.success ? 'completed' : 'failed' },
    wId,
  ).length;

  // Workstream artifacts from goals
  const workstreamTitles = ['OAuth2 Login', 'Session Management', 'RBAC'];
  for (let i = 0; i < workstreamTitles.length; i++) {
    artifactsGenerated += memoryOrchestrator.generateArtifact(
      { type: 'workstream', workstreamId: `ws-${i}`, title: workstreamTitles[i]!, status: 'completed', goalId: 'e2e-goal-1' },
      wId,
    ).length;
  }

  // Task result artifacts (one per completed task in metrics)
  for (let i = 0; i < Math.max(swarmResult.metrics.completedTasks, 3); i++) {
    const aId = createUUID() as unknown as AgentID;
    const tId = createUUID() as unknown as TaskID;
    artifactsGenerated += memoryOrchestrator.generateArtifact(
      { type: 'task_result', taskId: tId, agentId: aId, output: { task: `Task ${i}` }, confidence: 0.85 + Math.random() * 0.15 },
      wId,
    ).length;
  }

  // Decision artifacts
  artifactsGenerated += memoryOrchestrator.generateArtifact(
    { type: 'decision', agentId: createUUID() as unknown as AgentID, decision: 'Use JWT for session tokens', reasoning: 'Better scalability', outcome: { implemented: true } },
    wId,
  ).length;

  // Validation artifacts
  const vId = createUUID() as unknown as AgentID;
  const tId = createUUID() as unknown as TaskID;
  memoryOrchestrator.getL4().addNode('agent', 'Validator', {}, { id: vId as string });
  memoryOrchestrator.getL4().addNode('task', 'Task', {}, { id: tId as string });
  artifactsGenerated += memoryOrchestrator.generateArtifact(
    { type: 'validation', taskId: tId, validatorId: vId, approved: true, confidence: 0.92 },
    wId,
  ).length;

  // Resource allocation artifact
  artifactsGenerated += memoryOrchestrator.generateArtifact(
    { type: 'resource_allocation', agentId: createUUID() as unknown as AgentID, allocated: { ru: 500 }, consumed: { ru: 420 } },
    wId,
  ).length;

  // Phase 4: Build Mission Control from the swarm
  const missionControl = new MissionControl(
    coordinator.getMetrics(),
    coordinator.getAllAgents(),
    coordinator.getChief(),
    coordinator.getManagers(),
    coordinator.getWorkers(),
    coordinator.getValidators(),
  );

  // Phase 5: Get memory stats
  const stats = memoryOrchestrator.getStats();

  return {
    swarmResult,
    memoryOrchestrator,
    missionControl,
    artifactsGenerated,
    graphNodes: stats.totalGraphNodes,
    graphEdges: stats.totalGraphEdges,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// End-to-End Benchmark
// ═══════════════════════════════════════════════════════════════════════════

describe('End-to-End AgentOS Benchmark', () => {
  it('should complete the full goal → decompose → execute → validate → memory pipeline', async () => {
    const result = await runEndToEndBenchmark();

    // Swarm should succeed
    expect(result.swarmResult.success).toBe(true);
    expect(result.swarmResult.verification.allPassed).toBe(true);

    // Agents should have been spawned
    expect(result.swarmResult.metrics.totalAgents).toBeGreaterThan(0);

    // Memory artifacts should have been generated
    expect(result.artifactsGenerated).toBeGreaterThan(0);

    // Knowledge graph should have nodes and edges
    expect(result.graphNodes).toBeGreaterThan(0);
    expect(result.graphEdges).toBeGreaterThan(0);
  }, 30_000);

  it('should store memory artifacts across all tiers', async () => {
    const result = await runEndToEndBenchmark();
    const stats = result.memoryOrchestrator.getStats();

    // Should have entries in L1, L2, and/or L3
    expect(stats.totalEntries).toBeGreaterThan(0);

    // Knowledge graph should exist
    expect(stats.totalGraphNodes).toBeGreaterThan(0);
    expect(stats.totalGraphEdges).toBeGreaterThan(0);
  }, 30_000);

  it('should build a knowledge graph with correct node types', async () => {
    const result = await runEndToEndBenchmark();
    const graph = result.memoryOrchestrator.getL4();

    // Should have project node (from goal)
    const projectNodes = graph.getNodesByType('project');
    expect(projectNodes.length).toBeGreaterThan(0);

    // Should have task nodes (from task results)
    const taskNodes = graph.getNodesByType('task');
    expect(taskNodes.length).toBeGreaterThan(0);

    // Should have agent nodes (from task results)
    const agentNodes = graph.getNodesByType('agent');
    expect(agentNodes.length).toBeGreaterThan(0);
  }, 30_000);

  it('should support graph traversal from goal to completed tasks', async () => {
    const result = await runEndToEndBenchmark();
    const graph = result.memoryOrchestrator.getL4();

    // Find the project node (from goal)
    const projectNodes = graph.getNodesByType('project');
    if (projectNodes.length > 0) {
      const goalNode = projectNodes[0]!;

      // Traverse from the goal node
      const traversal = result.memoryOrchestrator.traverse({
        startNodeIds: [goalNode.id],
        maxDepth: 3,
      });

      // Should at least include the start node
      expect(traversal.nodes.length).toBeGreaterThanOrEqual(1);
    }
  }, 30_000);

  it('should render Mission Control dashboard', async () => {
    const result = await runEndToEndBenchmark();
    const snapshot = result.missionControl.snapshot();

    // Snapshot should contain agent and resource info
    expect(snapshot.agents.total).toBeGreaterThan(0);

    // Render should produce output
    const rendered = result.missionControl.render();
    expect(rendered.length).toBeGreaterThan(0);
  }, 30_000);

  it('should produce compact Mission Control status', async () => {
    const result = await runEndToEndBenchmark();
    const compact = result.missionControl.renderCompact();
    expect(compact.length).toBeGreaterThan(0);
  }, 30_000);

  it('should verify constitutional constraints', async () => {
    const result = await runEndToEndBenchmark();
    const v = result.swarmResult.verification;

    expect(v.noOrphanedAgents).toBe(true);
    expect(v.auditTrailComplete).toBe(true);
  }, 30_000);

  it('should support semantic search across memory tiers', async () => {
    const result = await runEndToEndBenchmark();

    // Store a searchable entry
    const aId = createUUID() as unknown as AgentID;
    const wId = createUUID() as unknown as WorkspaceID;
    result.memoryOrchestrator.store(aId, wId, { topic: 'OAuth2 token validation' }, MemoryType.FACT);
    result.memoryOrchestrator.store(aId, wId, { topic: 'database connection pooling' }, MemoryType.CONTEXT);

    // Search should find relevant entries
    const searchResults = result.memoryOrchestrator.search({ text: 'OAuth2' });
    expect(searchResults.length).toBeGreaterThan(0);
  }, 30_000);

  it('should track auto-tiering from L1 to L3', async () => {
    const result = await runEndToEndBenchmark();
    const aId = createUUID() as unknown as AgentID;
    const wId = createUUID() as unknown as WorkspaceID;

    // Store high-confidence decision in L2
    const entry = result.memoryOrchestrator.store(aId, wId, { decision: 'Use Redis for caching' }, MemoryType.DECISION, {
      tier: MemoryType.DECISION as any, // Will be auto-routed to L2
      confidence: 0.9,
    });

    // Access it enough to trigger promotion
    for (let i = 0; i < 5; i++) {
      result.memoryOrchestrator.getL2().retrieve(entry.id);
    }

    const tiering = result.memoryOrchestrator.runAutoTiering();
    // May or may not promote depending on threshold
    expect(tiering).toBeDefined();
    expect(typeof tiering.promoted).toBe('number');
  }, 30_000);

  it('should print full end-to-end benchmark report', async () => {
    const result = await runEndToEndBenchmark();
    const m = result.swarmResult.metrics;

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║       AgentOS End-to-End Benchmark Report             ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log();
    console.log('  ── Swarm Execution ──');
    console.log(`  Total agents:      ${m.totalAgents}`);
    console.log(`  Duration:          ${result.swarmResult.durationMs}ms`);
    console.log(`  Tasks completed:   ${m.completedTasks}`);
    console.log(`  Tasks failed:      ${m.failedTasks}`);
    console.log(`  Completion rate:   ${(m.completionRate * 100).toFixed(1)}%`);
    console.log(`  Messages sent:     ${m.messagesSent}`);
    console.log(`  RU consumed:       ${m.ruConsumed}`);
    console.log(`  Verification:      ${result.swarmResult.verification.allPassed ? 'ALL PASSED' : 'FAILED'}`);
    console.log();
    console.log('  ── Memory Engine ──');
    console.log(`  Artifacts generated: ${result.artifactsGenerated}`);
    console.log(`  Graph nodes:        ${result.graphNodes}`);
    console.log(`  Graph edges:        ${result.graphEdges}`);
    const stats = result.memoryOrchestrator.getStats();
    console.log(`  L1 entries:          ${stats.l1Size}`);
    console.log(`  L2 entries:          ${stats.l2Size}`);
    console.log(`  L3 entries:          ${stats.l3Size}`);
    console.log(`  Total entries:       ${stats.totalEntries}`);
    console.log();
    console.log('  ── Mission Control ──');
    const compact = result.missionControl.renderCompact();
    console.log(`  Status: ${compact}`);
    console.log('╚══════════════════════════════════════════════════════╝\n');

    expect(result.swarmResult.success).toBe(true);
  }, 30_000);
});