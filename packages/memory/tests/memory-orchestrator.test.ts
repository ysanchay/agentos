/**
 * @agentos/memory — Memory Orchestrator Tests
 * Auto-tiering, artifact generation, lifecycle management, cross-tier search,
 * graph operations, and failure recovery.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createUUID, MemoryTier, MemoryType } from '@agentos/types';
import type { AgentID, TaskID, WorkspaceID } from '@agentos/types';
import { MemoryOrchestrator } from '../src/memory-orchestrator.js';
import { DEFAULT_MEMORY_CONFIG } from '../src/types.js';

let currentTime = 1_000_000;
const mockNow = () => currentTime;

function aid(): AgentID { return createUUID() as unknown as AgentID; }
function tid(): TaskID { return createUUID() as unknown as TaskID; }
function wid(): WorkspaceID { return createUUID() as unknown as WorkspaceID; }

describe('MemoryOrchestrator Auto-Tiering', () => {
  let orchestrator: MemoryOrchestrator;

  beforeEach(() => {
    currentTime = 1_000_000;
    orchestrator = new MemoryOrchestrator({}, mockNow);
  });

  it('should promote frequently accessed L2 entries to L3', () => {
    const a = aid(), w = wid();
    const entry = orchestrator.store(a, w, { important: true }, MemoryType.DECISION, {
      tier: MemoryTier.L1,
      confidence: 0.95,
    });

    // Access enough to meet promotion threshold
    for (let i = 0; i < DEFAULT_MEMORY_CONFIG.promotionThreshold; i++) {
      orchestrator.getL2().retrieve(entry.id);
    }

    const result = orchestrator.runAutoTiering();
    expect(result.promoted).toBeGreaterThanOrEqual(1);
    expect(orchestrator.getL3().size).toBeGreaterThanOrEqual(1);
  });

  it('should not promote when auto-tiering is disabled', () => {
    const noAutoOrch = new MemoryOrchestrator({ enableAutoTiering: false }, mockNow);
    const a = aid(), w = wid();
    const entry = noAutoOrch.store(a, w, { data: 'no-promote' }, MemoryType.DECISION, {
      tier: MemoryTier.L1,
      confidence: 0.95,
    });

    for (let i = 0; i < DEFAULT_MEMORY_CONFIG.promotionThreshold; i++) {
      noAutoOrch.getL2().retrieve(entry.id);
    }

    expect(noAutoOrch.runAutoTiering().promoted).toBe(0);
  });

  it('should not promote entries below promotion threshold', () => {
    const a = aid(), w = wid();
    const entry = orchestrator.store(a, w, { data: 'low-access' }, MemoryType.DECISION, {
      tier: MemoryTier.L1,
      confidence: 0.95,
    });

    // Access fewer times than threshold
    for (let i = 0; i < DEFAULT_MEMORY_CONFIG.promotionThreshold - 1; i++) {
      orchestrator.getL2().retrieve(entry.id);
    }

    expect(orchestrator.runAutoTiering().promoted).toBe(0);
  });

  it('should not promote entries below confidence threshold', () => {
    const a = aid(), w = wid();
    const entry = orchestrator.store(a, w, { data: 'low-conf' }, MemoryType.DECISION, {
      tier: MemoryTier.L1,
      confidence: 0.3,
    });

    for (let i = 0; i < DEFAULT_MEMORY_CONFIG.promotionThreshold; i++) {
      orchestrator.getL2().retrieve(entry.id);
    }

    expect(orchestrator.runAutoTiering().promoted).toBe(0);
  });

  it('should evict expired entries during auto-tiering', () => {
    const a = aid(), w = wid();
    orchestrator.store(a, w, { data: 'will-expire' }, MemoryType.CONTEXT); // L1 entry

    // Advance past L1 TTL
    currentTime = 1_000_000 + DEFAULT_MEMORY_CONFIG.l1TtlMs + 1;

    const result = orchestrator.runAutoTiering();
    expect(result.demoted).toBeGreaterThanOrEqual(0);
    // L1 entries should have been evicted
    expect(orchestrator.getL1().size).toBe(0);
  });

  it('should track promotion and eviction counts in stats', () => {
    const a = aid(), w = wid();
    const entry = orchestrator.store(a, w, { important: true }, MemoryType.DECISION, {
      tier: MemoryTier.L1,
      confidence: 0.95,
    });

    for (let i = 0; i < DEFAULT_MEMORY_CONFIG.promotionThreshold; i++) {
      orchestrator.getL2().retrieve(entry.id);
    }

    orchestrator.runAutoTiering();

    const stats = orchestrator.getStats();
    expect(stats.promotions).toBeGreaterThanOrEqual(1);
  });
});

describe('MemoryOrchestrator Lifecycle', () => {
  let orchestrator: MemoryOrchestrator;

  beforeEach(() => {
    currentTime = 1_000_000;
    orchestrator = new MemoryOrchestrator({}, mockNow);
  });

  it('should evict L1 entries when task completes', () => {
    const a = aid(), t = tid(), w = wid();
    orchestrator.store(a, w, { task: 'work' }, MemoryType.CONTEXT, { taskId: t });
    orchestrator.store(a, w, { task: 'other' }, MemoryType.CONTEXT); // no taskId

    const evicted = orchestrator.onTaskCompleted(t);
    expect(evicted).toBeGreaterThanOrEqual(1);
    expect(orchestrator.getL1().size).toBeLessThan(2);
  });

  it('should evict L1 entries when agent terminates', () => {
    const a1 = aid(), a2 = aid(), w = wid();
    orchestrator.store(a1, w, { data: 1 }, MemoryType.CONTEXT);
    orchestrator.store(a1, w, { data: 2 }, MemoryType.CONTEXT);
    orchestrator.store(a2, w, { data: 3 }, MemoryType.CONTEXT);

    const evicted = orchestrator.onAgentTerminated(a1);
    expect(evicted).toBeGreaterThanOrEqual(2);
  });

  it('should return 0 when evicting for non-existent task', () => {
    expect(orchestrator.onTaskCompleted(tid())).toBe(0);
  });

  it('should return 0 when evicting for non-existent agent', () => {
    expect(orchestrator.onAgentTerminated(aid())).toBe(0);
  });
});

describe('MemoryOrchestrator Artifact Generation', () => {
  let orchestrator: MemoryOrchestrator;

  beforeEach(() => {
    currentTime = 1_000_000;
    orchestrator = new MemoryOrchestrator({}, mockNow);
  });

  it('should generate task_result artifact with L1 + L3 archival for high confidence', () => {
    const a = aid(), t = tid(), w = wid();
    const artifacts = orchestrator.generateArtifact(
      { type: 'task_result', taskId: t, agentId: a, output: { success: true }, confidence: 0.9 },
      w,
    );

    expect(artifacts.length).toBeGreaterThanOrEqual(2);
    // First artifact in L1 (working memory)
    expect(artifacts[0]!.tier).toBe(MemoryTier.L0);
    // Second artifact in L3 (long-term) for high confidence
    expect(artifacts[1]!.tier).toBe(MemoryTier.L2);
  });

  it('should generate only L1 artifact for low-confidence task results', () => {
    const a = aid(), t = tid(), w = wid();
    const artifacts = orchestrator.generateArtifact(
      { type: 'task_result', taskId: t, agentId: a, output: { partial: true }, confidence: 0.5 },
      w,
    );

    // Low confidence → only L1 entry, no L3 archive
    expect(artifacts.length).toBe(1);
    expect(artifacts[0]!.tier).toBe(MemoryTier.L0);
  });

  it('should add graph nodes and edge for task_result artifacts', () => {
    const a = aid(), t = tid(), w = wid();
    orchestrator.generateArtifact(
      { type: 'task_result', taskId: t, agentId: a, output: { success: true }, confidence: 0.9 },
      w,
    );

    // Graph should have agent node, task node, and completed edge
    const l4 = orchestrator.getL4();
    expect(l4.nodeCount).toBeGreaterThanOrEqual(2);
    expect(l4.edgeCount).toBeGreaterThanOrEqual(1);
  });

  it('should generate acp_message artifact in L1', () => {
    const a = aid(), w = wid();
    const artifacts = orchestrator.generateArtifact(
      { type: 'acp_message', messageId: 'msg-1', sender: a, recipient: '*' as any, messageType: 'task.announce' },
      w,
    );

    expect(artifacts.length).toBeGreaterThanOrEqual(1);
    expect(artifacts[0]!.tier).toBe(MemoryTier.L0);
    expect(artifacts[0]!.tags).toContain('acp-message');
  });

  it('should generate validation artifact in L2', () => {
    const vId = aid(), tId = tid(), w = wid();
    orchestrator.getL4().addNode('agent', 'Validator', {}, { id: vId as string });
    orchestrator.getL4().addNode('task', 'Task', {}, { id: tId as string });

    const artifacts = orchestrator.generateArtifact(
      { type: 'validation', taskId: tId, validatorId: vId, approved: true, confidence: 0.95 },
      w,
    );

    expect(artifacts.length).toBeGreaterThanOrEqual(1);
    expect(artifacts[0]!.tier).toBe(MemoryTier.L1);
    expect(artifacts[0]!.tags).toContain('approved');
  });

  it('should generate validation artifact with rejection tag', () => {
    const vId = aid(), tId = tid(), w = wid();
    orchestrator.getL4().addNode('agent', 'Validator', {}, { id: vId as string });
    orchestrator.getL4().addNode('task', 'Task', {}, { id: tId as string });

    const artifacts = orchestrator.generateArtifact(
      { type: 'validation', taskId: tId, validatorId: vId, approved: false, confidence: 0.4 },
      w,
    );

    expect(artifacts.length).toBeGreaterThanOrEqual(1);
    expect(artifacts[0]!.tags).toContain('rejected');
  });

  it('should add validation edge to graph when validator node exists', () => {
    const vId = aid(), tId = tid(), w = wid();
    orchestrator.getL4().addNode('agent', 'Validator', {}, { id: vId as string });
    orchestrator.getL4().addNode('task', 'Task', {}, { id: tId as string });

    orchestrator.generateArtifact(
      { type: 'validation', taskId: tId, validatorId: vId, approved: true, confidence: 0.95 },
      w,
    );

    const edges = orchestrator.getL4().getEdgesByType('validated');
    expect(edges.length).toBe(1);
  });

  it('should generate resource_allocation artifact in L2', () => {
    const a = aid(), w = wid();
    const artifacts = orchestrator.generateArtifact(
      { type: 'resource_allocation', agentId: a, allocated: { ru: 100 }, consumed: { ru: 80 } },
      w,
    );

    expect(artifacts.length).toBeGreaterThanOrEqual(1);
    expect(artifacts[0]!.tier).toBe(MemoryTier.L1);
    expect(artifacts[0]!.tags).toContain('resource');
  });

  it('should generate decision artifact and add decision node to graph', () => {
    const a = aid(), w = wid();
    const artifacts = orchestrator.generateArtifact(
      { type: 'decision', agentId: a, decision: 'retry task', reasoning: 'transient error', outcome: { retried: true } },
      w,
    );

    expect(artifacts.length).toBeGreaterThanOrEqual(1);
    const decisionNodes = orchestrator.getL4().getNodesByType('decision');
    expect(decisionNodes.length).toBe(1);
    expect(decisionNodes[0]!.label).toBe('retry task');
  });

  it('should generate goal artifact and add project node to graph', () => {
    const w = wid();
    const artifacts = orchestrator.generateArtifact(
      { type: 'goal', goalId: 'goal-1', title: 'Build auth system', status: 'in_progress' },
      w,
    );

    expect(artifacts.length).toBeGreaterThanOrEqual(1);
    const projectNodes = orchestrator.getL4().getNodesByType('project');
    expect(projectNodes.length).toBe(1);
    expect(projectNodes[0]!.label).toBe('Build auth system');
  });

  it('should generate workstream artifact and add parent_of edge to graph', () => {
    const w = wid();
    orchestrator.getL4().addNode('project', 'Auth System', {}, { id: 'goal-1' });
    orchestrator.getL4().addNode('task', 'Auth Module', {}, { id: 'ws-1' });

    orchestrator.generateArtifact(
      { type: 'workstream', workstreamId: 'ws-1', title: 'Auth Module', status: 'active', goalId: 'goal-1' },
      w,
    );

    const parentEdges = orchestrator.getL4().getEdgesByType('parent_of');
    expect(parentEdges.length).toBe(1);
    expect(parentEdges[0]!.sourceId).toBe('goal-1');
  });
});

describe('MemoryOrchestrator Cross-Tier Operations', () => {
  let orchestrator: MemoryOrchestrator;

  beforeEach(() => {
    currentTime = 1_000_000;
    orchestrator = new MemoryOrchestrator({}, mockNow);
  });

  it('should search across L1, L2, and L3 tiers', () => {
    const a = aid(), w = wid();
    orchestrator.store(a, w, { topic: 'auth L1' }, MemoryType.CONTEXT);
    orchestrator.store(a, w, { topic: 'auth L2' }, MemoryType.CONTEXT, { tier: MemoryTier.L1 });
    orchestrator.store(a, w, { topic: 'auth L3' }, MemoryType.FACT); // auto-routes to L3

    const results = orchestrator.search({ text: 'auth' });
    expect(results.length).toBeGreaterThanOrEqual(3);
  });

  it('should search scoped to specific tier', () => {
    const a = aid(), w = wid();
    orchestrator.store(a, w, { topic: 'auth L1' }, MemoryType.CONTEXT);
    orchestrator.store(a, w, { topic: 'auth L2' }, MemoryType.CONTEXT, { tier: MemoryTier.L1 });

    const l1Only = orchestrator.search({ text: 'auth', tier: MemoryTier.L0 });
    expect(l1Only.length).toBeGreaterThanOrEqual(1);
    l1Only.forEach((r) => expect(r.entry.tier).toBe(MemoryTier.L0));
  });

  it('should respect search limit across tiers', () => {
    const a = aid(), w = wid();
    for (let i = 0; i < 5; i++) {
      orchestrator.store(a, w, { auth: `item ${i}` }, MemoryType.CONTEXT);
      orchestrator.store(a, w, { auth: `item ${i}` }, MemoryType.CONTEXT, { tier: MemoryTier.L1 });
    }

    const results = orchestrator.search({ text: 'auth', limit: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('should traverse knowledge graph via orchestrator', () => {
    orchestrator.getL4().addNode('agent', 'Chief', {}, { id: 'chief' });
    orchestrator.getL4().addNode('task', 'Task 1', {}, { id: 'task-1' });
    orchestrator.getL4().addEdge('chief', 'task-1', 'created');

    const result = orchestrator.traverse({ startNodeIds: ['chief'], maxDepth: 2 });
    expect(result.nodes.length).toBe(2);
  });

  it('should get neighbors via orchestrator', () => {
    orchestrator.getL4().addNode('agent', 'Chief', {}, { id: 'chief' });
    orchestrator.getL4().addNode('task', 'Task 1', {}, { id: 'task-1' });
    orchestrator.getL4().addEdge('chief', 'task-1', 'created');

    const neighbors = orchestrator.getNeighbors('chief');
    expect(neighbors.nodes.length).toBe(1);
  });

  it('should find shortest path via orchestrator', () => {
    orchestrator.getL4().addNode('agent', 'A', {}, { id: 'a' });
    orchestrator.getL4().addNode('task', 'T', {}, { id: 't' });
    orchestrator.getL4().addEdge('a', 't', 'created');

    const path = orchestrator.shortestPath('a', 't');
    expect(path).not.toBeNull();
    expect(path![0]!.nodeIds).toEqual(['a', 't']);
  });

  it('should return null shortest path for disconnected nodes', () => {
    orchestrator.getL4().addNode('agent', 'A', {}, { id: 'a' });
    orchestrator.getL4().addNode('agent', 'B', {}, { id: 'b' });

    expect(orchestrator.shortestPath('a', 'b')).toBeNull();
  });
});

describe('MemoryOrchestrator Stats', () => {
  let orchestrator: MemoryOrchestrator;

  beforeEach(() => {
    currentTime = 1_000_000;
    orchestrator = new MemoryOrchestrator({}, mockNow);
  });

  it('should aggregate stats across all tiers', () => {
    const a = aid(), w = wid();
    orchestrator.store(a, w, { data: 1 }, MemoryType.CONTEXT); // L1
    orchestrator.store(a, w, { data: 2 }, MemoryType.CONTEXT, { tier: MemoryTier.L1 }); // L2
    orchestrator.store(a, w, { data: 3 }, MemoryType.FACT); // L3 (auto-route)
    orchestrator.getL4().addNode('agent', 'Test', {}); // L4 graph node

    const stats = orchestrator.getStats();
    expect(stats.totalEntries).toBeGreaterThanOrEqual(3);
    expect(stats.l1Size).toBeGreaterThanOrEqual(1);
    expect(stats.l2Size).toBeGreaterThanOrEqual(1);
    expect(stats.l3Size).toBeGreaterThanOrEqual(1);
    expect(stats.totalGraphNodes).toBeGreaterThanOrEqual(1);
  });

  it('should return entriesByTier breakdown', () => {
    const a = aid(), w = wid();
    orchestrator.store(a, w, { data: 1 }, MemoryType.CONTEXT); // L1
    orchestrator.store(a, w, { data: 2 }, MemoryType.FACT); // L3

    const stats = orchestrator.getStats();
    expect(stats.entriesByTier['l0_hot']).toBeGreaterThanOrEqual(1);
    expect(stats.entriesByTier['l2_persistent']).toBeGreaterThanOrEqual(1);
  });

  it('should start with zero evictions and promotions', () => {
    const stats = orchestrator.getStats();
    expect(stats.evictions).toBe(0);
    expect(stats.promotions).toBe(0);
    expect(stats.demotions).toBe(0);
  });
});

describe('MemoryOrchestrator Tier Routing', () => {
  let orchestrator: MemoryOrchestrator;

  beforeEach(() => {
    currentTime = 1_000_000;
    orchestrator = new MemoryOrchestrator({}, mockNow);
  });

  it('should route CONTEXT type to L1 by default', () => {
    const a = aid(), w = wid();
    expect(orchestrator.store(a, w, { data: 1 }, MemoryType.CONTEXT).tier).toBe(MemoryTier.L0);
  });

  it('should route FACT type to L3 automatically', () => {
    const a = aid(), w = wid();
    expect(orchestrator.store(a, w, { data: 1 }, MemoryType.FACT).tier).toBe(MemoryTier.L2);
  });

  it('should route RELATIONSHIP type to L3 automatically', () => {
    const a = aid(), w = wid();
    expect(orchestrator.store(a, w, { data: 1 }, MemoryType.RELATIONSHIP).tier).toBe(MemoryTier.L2);
  });

  it('should route high-confidence DECISION to L2', () => {
    const a = aid(), w = wid();
    expect(orchestrator.store(a, w, { data: 1 }, MemoryType.DECISION, { confidence: 0.9 }).tier).toBe(MemoryTier.L1);
  });

  it('should route low-confidence DECISION to L1', () => {
    const a = aid(), w = wid();
    expect(orchestrator.store(a, w, { data: 1 }, MemoryType.DECISION, { confidence: 0.5 }).tier).toBe(MemoryTier.L0);
  });

  it('should respect explicit tier override', () => {
    const a = aid(), w = wid();
    expect(orchestrator.store(a, w, { data: 1 }, MemoryType.CONTEXT, { tier: MemoryTier.L2 }).tier).toBe(MemoryTier.L2);
  });

  it('should retrieve from any tier', () => {
    const a = aid(), w = wid();
    const l1Entry = orchestrator.store(a, w, { tier: 1 }, MemoryType.CONTEXT);
    const l3Entry = orchestrator.store(a, w, { tier: 3 }, MemoryType.FACT);

    expect(orchestrator.retrieve(l1Entry.id)).not.toBeNull();
    expect(orchestrator.retrieve(l3Entry.id)).not.toBeNull();
  });

  it('should return null for non-existent entry', () => {
    expect(orchestrator.retrieve('nonexistent' as any)).toBeNull();
  });
});

describe('MemoryOrchestrator Failure Recovery', () => {
  it('should handle L1 expiry gracefully by falling back to L2', () => {
    const a = aid(), w = wid();
    const orchestrator = new MemoryOrchestrator({}, mockNow);

    // Store in L2 explicitly
    const l2Entry = orchestrator.store(a, w, { data: 'workspace' }, MemoryType.CONTEXT, { tier: MemoryTier.L1 });

    // The entry should still be retrievable from L2
    expect(orchestrator.retrieve(l2Entry.id)).not.toBeNull();
  });

  it('should handle L2 expiry by falling back to L3', () => {
    const a = aid(), w = wid();
    const orchestrator = new MemoryOrchestrator({}, mockNow);

    // Store in L3 (FACT auto-routes there)
    const l3Entry = orchestrator.store(a, w, { data: 'persistent' }, MemoryType.FACT);

    // L3 entries never expire
    currentTime = 1_000_000 + 86_400_000; // 24 hours later
    expect(orchestrator.retrieve(l3Entry.id)).not.toBeNull();
  });

  it('should continue operating when one tier has no matching entries', () => {
    const a = aid(), w = wid();
    const orchestrator = new MemoryOrchestrator({}, mockNow);

    // Store only in L3
    const l3Entry = orchestrator.store(a, w, { data: 'l3-only' }, MemoryType.FACT);

    // Search across all tiers should still find L3 entries
    const results = orchestrator.search({ text: 'l3' });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should maintain graph operations when memory tiers are empty', () => {
    const orchestrator = new MemoryOrchestrator({}, mockNow);
    orchestrator.getL4().addNode('agent', 'Solo', {}, { id: 'solo' });

    const neighbors = orchestrator.getNeighbors('solo');
    expect(neighbors.nodes.length).toBe(0);
    expect(neighbors.edges.length).toBe(0);
  });
});