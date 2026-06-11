/**
 * @agentos/memory — Memory Package Tests
 * Comprehensive tests for all 4 memory tiers, MemoryOrchestrator,
 * artifact generation, semantic search, graph traversal, auto-tiering, eviction.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createUUID, MemoryTier, MemoryType } from '@agentos/types';
import type { AgentID, TaskID, WorkspaceID } from '@agentos/types';
import { L1WorkingMemory } from '../src/l1-working-memory.js';
import { L2WorkspaceMemory } from '../src/l2-workspace-memory.js';
import { L3LongTermMemory } from '../src/l3-long-term-memory.js';
import { L4KnowledgeGraph } from '../src/l4-knowledge-graph.js';
import { MemoryOrchestrator } from '../src/memory-orchestrator.js';
import { DEFAULT_MEMORY_CONFIG } from '../src/types.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────

let currentTime = 1_000_000;
const mockNow = () => currentTime;

function aid(): AgentID { return createUUID() as unknown as AgentID; }
function tid(): TaskID { return createUUID() as unknown as TaskID; }
function wid(): WorkspaceID { return createUUID() as unknown as WorkspaceID; }

// ═══════════════════════════════════════════════════════════════════════════
// L1 Working Memory
// ═══════════════════════════════════════════════════════════════════════════

describe('L1WorkingMemory', () => {
  let l1: L1WorkingMemory;

  beforeEach(() => {
    currentTime = 1_000_000;
    l1 = new L1WorkingMemory(DEFAULT_MEMORY_CONFIG, mockNow);
  });

  it('should store and retrieve entries', () => {
    const a = aid(), w = wid();
    const entry = l1.store(a, { task: 'test' }, MemoryType.CONTEXT, w);

    expect(entry.id).toBeDefined();
    expect(entry.tier).toBe(MemoryTier.L0);
    expect(entry.type).toBe(MemoryType.CONTEXT);

    const retrieved = l1.retrieve(entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toEqual({ task: 'test' });
  });

  it('should track entries by agent', () => {
    const a = aid(), w = wid();
    l1.store(a, { data: 1 }, MemoryType.FACT, w);
    l1.store(a, { data: 2 }, MemoryType.FACT, w);

    expect(l1.getByAgent(a).length).toBe(2);
  });

  it('should track entries by task', () => {
    const a = aid(), t = tid(), w = wid();
    l1.store(a, { task: 'test' }, MemoryType.CONTEXT, w, { taskId: t });
    l1.store(a, { task: 'test2' }, MemoryType.CONTEXT, w, { taskId: t });

    expect(l1.getByTask(t).length).toBe(2);
  });

  it('should evict entries by task', () => {
    const a = aid(), t = tid(), w = wid();
    l1.store(a, { data: 1 }, MemoryType.RESULT, w, { taskId: t });
    l1.store(a, { data: 2 }, MemoryType.RESULT, w, { taskId: t });

    expect(l1.evictByTask(t)).toBe(2);
    expect(l1.size).toBe(0);
  });

  it('should evict entries by agent', () => {
    const a = aid(), w = wid();
    l1.store(a, { data: 1 }, MemoryType.FACT, w);
    l1.store(a, { data: 2 }, MemoryType.FACT, w);

    expect(l1.evictByAgent(a)).toBe(2);
    expect(l1.size).toBe(0);
  });

  it('should evict expired entries', () => {
    const a = aid(), w = wid();
    l1.store(a, { data: 1 }, MemoryType.FACT, w);

    currentTime = 1_000_000 + DEFAULT_MEMORY_CONFIG.l1TtlMs + 1000;
    expect(l1.evictExpired()).toBe(1);
  });

  it('should return null for expired entries on retrieve', () => {
    const a = aid(), w = wid();
    const entry = l1.store(a, { data: 1 }, MemoryType.FACT, w);

    currentTime = 1_000_000 + DEFAULT_MEMORY_CONFIG.l1TtlMs + 1000;
    expect(l1.retrieve(entry.id)).toBeNull();
  });

  it('should update access count on retrieve', () => {
    const a = aid(), w = wid();
    const entry = l1.store(a, { data: 1 }, MemoryType.FACT, w);

    l1.retrieve(entry.id);
    l1.retrieve(entry.id);
    l1.retrieve(entry.id);

    const retrieved = l1.retrieve(entry.id);
    expect(retrieved!.access_count).toBe(4); // 3 prior + this retrieve
  });

  it('should search by text content', () => {
    const a = aid(), w = wid();
    l1.store(a, { description: 'authentication module' }, MemoryType.CONTEXT, w);
    l1.store(a, { description: 'database schema' }, MemoryType.CONTEXT, w);

    const results = l1.search('authentication');
    expect(results.length).toBe(1);
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('should enforce per-agent capacity limit', () => {
    const a = aid(), w = wid();
    const smallL1 = new L1WorkingMemory({ ...DEFAULT_MEMORY_CONFIG, l1MaxPerAgent: 3 }, mockNow);

    for (let i = 0; i < 5; i++) {
      smallL1.store(a, { index: i }, MemoryType.FACT, w);
    }

    expect(smallL1.size).toBe(3);
  });

  it('should return stats', () => {
    const a = aid(), w = wid();
    l1.store(a, { data: 1 }, MemoryType.FACT, w);
    l1.store(a, { data: 2 }, MemoryType.CONTEXT, w);

    const stats = l1.getStats();
    expect(stats.total).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L2 Workspace Memory
// ═══════════════════════════════════════════════════════════════════════════

describe('L2WorkspaceMemory', () => {
  let l2: L2WorkspaceMemory;

  beforeEach(() => {
    currentTime = 1_000_000;
    l2 = new L2WorkspaceMemory(DEFAULT_MEMORY_CONFIG, mockNow);
  });

  it('should store and retrieve entries', () => {
    const a = aid(), w = wid();
    const entry = l2.store(w, { project: 'AgentOS' }, MemoryType.CONTEXT, a);

    expect(entry.tier).toBe(MemoryTier.L1);
    const retrieved = l2.retrieve(entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toEqual({ project: 'AgentOS' });
  });

  it('should track entries by workspace', () => {
    const w1 = wid(), w2 = wid(), a = aid();
    l2.store(w1, { ws: 1 }, MemoryType.FACT, a);
    l2.store(w1, { ws: 1.2 }, MemoryType.FACT, a);
    l2.store(w2, { ws: 2 }, MemoryType.FACT, a);

    expect(l2.getByWorkspace(w1).length).toBe(2);
    expect(l2.getByWorkspace(w2).length).toBe(1);
  });

  it('should search with workspace scoping', () => {
    const w1 = wid(), w2 = wid(), a = aid();
    l2.store(w1, { topic: 'authentication design' }, MemoryType.CONTEXT, a);
    l2.store(w2, { topic: 'authentication testing' }, MemoryType.CONTEXT, a);

    expect(l2.search('authentication', w1).length).toBe(1);
  });

  it('should identify promotable entries', () => {
    const a = aid(), w = wid();
    const entry = l2.store(w, { important: true }, MemoryType.DECISION, a, { confidence: 0.9 });

    for (let i = 0; i < DEFAULT_MEMORY_CONFIG.promotionThreshold; i++) {
      l2.retrieve(entry.id);
    }

    expect(l2.getPromotableEntries().length).toBe(1);
  });

  it('should evict expired entries', () => {
    const a = aid(), w = wid();
    l2.store(w, { data: 1 }, MemoryType.FACT, a);

    currentTime = 1_000_000 + DEFAULT_MEMORY_CONFIG.l2TtlMs + 1000;
    expect(l2.evictExpired()).toBe(1);
  });

  it('should evict by workspace', () => {
    const a = aid(), w = wid();
    l2.store(w, { data: 1 }, MemoryType.FACT, a);
    l2.store(w, { data: 2 }, MemoryType.FACT, a);

    expect(l2.evictByWorkspace(w)).toBe(2);
    expect(l2.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L3 Long-Term Memory
// ═══════════════════════════════════════════════════════════════════════════

describe('L3LongTermMemory', () => {
  let l3: L3LongTermMemory;

  beforeEach(() => {
    currentTime = 1_000_000;
    l3 = new L3LongTermMemory(DEFAULT_MEMORY_CONFIG, mockNow);
  });

  it('should store and retrieve entries', () => {
    const a = aid(), w = wid();
    const entry = l3.store({ pattern: 'retry' }, MemoryType.FACT, a, w);

    expect(entry.tier).toBe(MemoryTier.L2);
    expect(entry.expires_at).toBeUndefined();

    const retrieved = l3.retrieve(entry.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.content).toEqual({ pattern: 'retry' });
  });

  it('should track entries by type', () => {
    const a = aid(), w = wid();
    l3.store({ data: 1 }, MemoryType.FACT, a, w);
    l3.store({ data: 2 }, MemoryType.DECISION, a, w);
    l3.store({ data: 3 }, MemoryType.FACT, a, w);

    expect(l3.getByType(MemoryType.FACT).length).toBe(2);
    expect(l3.getByType(MemoryType.DECISION).length).toBe(1);
  });

  it('should track entries by agent', () => {
    const a1 = aid(), a2 = aid(), w = wid();
    l3.store({ agent: 1 }, MemoryType.FACT, a1, w);
    l3.store({ agent: 2 }, MemoryType.FACT, a2, w);

    expect(l3.getByAgent(a1).length).toBe(1);
    expect(l3.getByAgent(a2).length).toBe(1);
  });

  it('should search with text filter', () => {
    const a = aid(), w = wid();
    l3.store({ topic: 'error handling patterns' }, MemoryType.FACT, a, w);
    l3.store({ topic: 'database optimization' }, MemoryType.FACT, a, w);

    expect(l3.search({ text: 'error' }).length).toBe(1);
  });

  it('should search by type filter', () => {
    const a = aid(), w = wid();
    l3.store({ data: 1 }, MemoryType.FACT, a, w);
    l3.store({ data: 2 }, MemoryType.DECISION, a, w);

    expect(l3.search({ type: MemoryType.FACT }).length).toBe(1);
    expect(l3.search({ type: MemoryType.DECISION }).length).toBe(1);
  });

  it('should search by minimum confidence', () => {
    const a = aid(), w = wid();
    l3.store({ data: 1 }, MemoryType.FACT, a, w, { confidence: 0.5 });
    l3.store({ data: 2 }, MemoryType.FACT, a, w, { confidence: 0.9 });

    expect(l3.search({ minConfidence: 0.8 }).length).toBe(1);
  });

  it('should delete entries', () => {
    const a = aid(), w = wid();
    const entry = l3.store({ data: 1 }, MemoryType.FACT, a, w);

    expect(l3.delete(entry.id)).toBe(true);
    expect(l3.retrieve(entry.id)).toBeNull();
  });

  it('should not expire L3 entries', () => {
    const a = aid(), w = wid();
    const entry = l3.store({ data: 1 }, MemoryType.FACT, a, w);

    currentTime = 1_000_000 + 86_400_000;
    expect(l3.retrieve(entry.id)).not.toBeNull();
  });

  it('should return stats', () => {
    const a = aid(), w = wid();
    l3.store({ data: 1 }, MemoryType.FACT, a, w);
    l3.store({ data: 2 }, MemoryType.DECISION, a, w);

    expect(l3.getStats().total).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// L4 Knowledge Graph
// ═══════════════════════════════════════════════════════════════════════════

describe('L4KnowledgeGraph', () => {
  let graph: L4KnowledgeGraph;

  beforeEach(() => {
    currentTime = 1_000_000;
    graph = new L4KnowledgeGraph(mockNow);
  });

  it('should add and retrieve nodes', () => {
    const node = graph.addNode('agent', 'Test Agent', { role: 'worker' });
    expect(node.id).toBeDefined();
    expect(node.type).toBe('agent');
    expect(node.label).toBe('Test Agent');

    const retrieved = graph.getNode(node.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.properties['role']).toBe('worker');
  });

  it('should add nodes with custom IDs', () => {
    graph.addNode('task', 'Task 1', {}, { id: 'task-1' });
    expect(graph.getNode('task-1')!.label).toBe('Task 1');
  });

  it('should add and retrieve edges', () => {
    graph.addNode('agent', 'Agent 1', {}, { id: 'agent-1' });
    graph.addNode('task', 'Task 1', {}, { id: 'task-1' });

    const edge = graph.addEdge('agent-1', 'task-1', 'completed', 0.95);
    expect(edge).not.toBeNull();
    expect(edge!.type).toBe('completed');
    expect(edge!.weight).toBe(0.95);
  });

  it('should not add edge for missing nodes', () => {
    expect(graph.addEdge('missing-1', 'missing-2', 'relates_to')).toBeNull();
  });

  it('should get nodes by type', () => {
    graph.addNode('agent', 'Agent 1', {});
    graph.addNode('agent', 'Agent 2', {});
    graph.addNode('task', 'Task 1', {});

    expect(graph.getNodesByType('agent').length).toBe(2);
  });

  it('should get outgoing edges', () => {
    graph.addNode('agent', 'Agent 1', {}, { id: 'agent-1' });
    graph.addNode('task', 'Task 1', {}, { id: 'task-1' });
    graph.addNode('task', 'Task 2', {}, { id: 'task-2' });
    graph.addEdge('agent-1', 'task-1', 'completed');
    graph.addEdge('agent-1', 'task-2', 'completed');

    expect(graph.getOutgoingEdges('agent-1').length).toBe(2);
  });

  it('should get incoming edges', () => {
    graph.addNode('agent', 'Agent 1', {}, { id: 'agent-1' });
    graph.addNode('agent', 'Agent 2', {}, { id: 'agent-2' });
    graph.addNode('task', 'Task 1', {}, { id: 'task-1' });
    graph.addEdge('agent-1', 'task-1', 'created');
    graph.addEdge('agent-2', 'task-1', 'validated');

    expect(graph.getIncomingEdges('task-1').length).toBe(2);
  });

  it('should traverse the graph via BFS', () => {
    graph.addNode('agent', 'Chief', {}, { id: 'chief' });
    graph.addNode('agent', 'Manager', {}, { id: 'manager' });
    graph.addNode('task', 'Task 1', {}, { id: 'task-1' });
    graph.addEdge('chief', 'manager', 'assigned_to');
    graph.addEdge('manager', 'task-1', 'created');

    const result = graph.traverse({ startNodeIds: ['chief'], maxDepth: 3 });
    expect(result.nodes.length).toBe(3);
    expect(result.edges.length).toBe(2);
  });

  it('should get neighbors (1-hop)', () => {
    graph.addNode('agent', 'Agent 1', {}, { id: 'agent-1' });
    graph.addNode('task', 'Task 1', {}, { id: 'task-1' });
    graph.addNode('task', 'Task 2', {}, { id: 'task-2' });
    graph.addEdge('agent-1', 'task-1', 'completed');
    graph.addEdge('task-2', 'agent-1', 'validated');

    expect(graph.getNeighbors('agent-1').nodes.length).toBe(2);
  });

  it('should find shortest path', () => {
    graph.addNode('agent', 'A', {}, { id: 'a' });
    graph.addNode('agent', 'B', {}, { id: 'b' });
    graph.addNode('agent', 'C', {}, { id: 'c' });
    graph.addEdge('a', 'b', 'relates_to');
    graph.addEdge('b', 'c', 'relates_to');

    const path = graph.shortestPath('a', 'c');
    expect(path).not.toBeNull();
    expect(path![0]!.nodeIds).toEqual(['a', 'b', 'c']);
  });

  it('should return null when no path exists', () => {
    graph.addNode('agent', 'A', {}, { id: 'a' });
    graph.addNode('agent', 'B', {}, { id: 'b' });
    expect(graph.shortestPath('a', 'b')).toBeNull();
  });

  it('should remove a node and cascade delete its edges', () => {
    graph.addNode('agent', 'A', {}, { id: 'a' });
    graph.addNode('task', 'T1', {}, { id: 't1' });
    graph.addEdge('a', 't1', 'completed');

    expect(graph.removeNode('a')).toBe(1);
    expect(graph.getNode('a')).toBeNull();
  });

  it('should update node properties', () => {
    graph.addNode('agent', 'A', { status: 'idle' }, { id: 'a' });
    expect(graph.updateNode('a', { status: 'busy' })).toBe(true);
    expect(graph.getNode('a')!.properties['status']).toBe('busy');
  });

  it('should filter traversal by edge type', () => {
    graph.addNode('agent', 'A', {}, { id: 'a' });
    graph.addNode('task', 'T1', {}, { id: 't1' });
    graph.addNode('task', 'T2', {}, { id: 't2' });
    graph.addEdge('a', 't1', 'created');
    graph.addEdge('a', 't2', 'completed');

    const result = graph.traverse({ startNodeIds: ['a'], edgeTypes: ['created'], maxDepth: 2 });
    expect(result.edges.length).toBe(1);
    expect(result.edges[0]!.type).toBe('created');
  });

  it('should return stats', () => {
    graph.addNode('agent', 'A', {});
    graph.addNode('task', 'T1', {});
    graph.addNode('agent', 'A2', {}, { id: 'a2' });
    graph.addNode('task', 'T2', {}, { id: 't2' });
    graph.addEdge('a2', 't2', 'completed');

    const stats = graph.getStats();
    expect(stats.nodes).toBe(4);
    expect(stats.edges).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Memory Orchestrator
// ═══════════════════════════════════════════════════════════════════════════

describe('MemoryOrchestrator', () => {
  let orchestrator: MemoryOrchestrator;

  beforeEach(() => {
    currentTime = 1_000_000;
    orchestrator = new MemoryOrchestrator({}, mockNow);
  });

  it('should store entries at the correct tier by default', () => {
    const a = aid(), w = wid();

    // Default: L1 Working (CONTEXT)
    expect(orchestrator.store(a, w, { data: 1 }, MemoryType.CONTEXT).tier).toBe(MemoryTier.L0);

    // Explicit L2
    expect(orchestrator.store(a, w, { data: 2 }, MemoryType.CONTEXT, { tier: MemoryTier.L1 }).tier).toBe(MemoryTier.L1);

    // FACT → auto-routes to L3
    expect(orchestrator.store(a, w, { data: 3 }, MemoryType.FACT).tier).toBe(MemoryTier.L2);
  });

  it('should retrieve from any tier', () => {
    const a = aid(), w = wid();
    const entry = orchestrator.store(a, w, { data: 1 }, MemoryType.CONTEXT);
    expect(orchestrator.retrieve(entry.id)).not.toBeNull();
  });

  it('should search across all tiers', () => {
    const a = aid(), w = wid();
    orchestrator.store(a, w, { topic: 'authentication design' }, MemoryType.CONTEXT);
    orchestrator.store(a, w, { topic: 'authentication patterns' }, MemoryType.CONTEXT, { tier: MemoryTier.L1 });

    const results = orchestrator.search({ text: 'authentication' });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('should generate artifacts from task results', () => {
    const a = aid(), t = tid(), w = wid();
    const artifacts = orchestrator.generateArtifact(
      { type: 'task_result', taskId: t, agentId: a, output: { success: true }, confidence: 0.9 },
      w,
    );

    // High confidence → L1 entry + L3 archive entry
    expect(artifacts.length).toBeGreaterThanOrEqual(2);
  });

  it('should generate only L1 artifact for low-confidence task results', () => {
    const a = aid(), t = tid(), w = wid();
    const artifacts = orchestrator.generateArtifact(
      { type: 'task_result', taskId: t, agentId: a, output: { success: true }, confidence: 0.5 },
      w,
    );

    // Low confidence → only L1 entry, no L3 archive
    expect(artifacts.length).toBe(1);
  });

  it('should generate artifacts from ACP messages', () => {
    const a = aid(), w = wid();
    const artifacts = orchestrator.generateArtifact(
      { type: 'acp_message', messageId: 'msg-1', sender: a, recipient: '*' as any, messageType: 'task.announce' },
      w,
    );
    expect(artifacts.length).toBeGreaterThanOrEqual(1);
  });

  it('should generate artifacts from validations', () => {
    const vId = aid(), tId = tid(), w = wid();
    orchestrator.getL4().addNode('agent', 'Validator', {}, { id: vId as string });
    orchestrator.getL4().addNode('task', 'Task', {}, { id: tId as string });

    const artifacts = orchestrator.generateArtifact(
      { type: 'validation', taskId: tId, validatorId: vId, approved: true, confidence: 0.95 },
      w,
    );
    expect(artifacts.length).toBeGreaterThanOrEqual(1);
  });

  it('should generate artifacts from resource allocations', () => {
    const a = aid(), w = wid();
    const artifacts = orchestrator.generateArtifact(
      { type: 'resource_allocation', agentId: a, allocated: { ru: 100 }, consumed: { ru: 80 } },
      w,
    );
    expect(artifacts.length).toBeGreaterThanOrEqual(1);
  });

  it('should generate artifacts from decisions', () => {
    const a = aid(), w = wid();
    const artifacts = orchestrator.generateArtifact(
      { type: 'decision', agentId: a, decision: 'retry task', reasoning: 'transient error', outcome: { retried: true } },
      w,
    );
    expect(artifacts.length).toBeGreaterThanOrEqual(1);
  });

  it('should generate artifacts from goals', () => {
    const w = wid();
    const artifacts = orchestrator.generateArtifact(
      { type: 'goal', goalId: 'goal-1', title: 'Build auth system', status: 'in_progress' },
      w,
    );
    expect(artifacts.length).toBeGreaterThanOrEqual(1);
  });

  it('should generate artifacts from workstreams', () => {
    const w = wid();
    orchestrator.getL4().addNode('project', 'Auth System', {}, { id: 'goal-1' });

    const artifacts = orchestrator.generateArtifact(
      { type: 'workstream', workstreamId: 'ws-1', title: 'Auth Module', status: 'active', goalId: 'goal-1' },
      w,
    );
    expect(artifacts.length).toBeGreaterThanOrEqual(1);
  });

  it('should run auto-tiering: promote L2→L3 for high-access entries', () => {
    const a = aid(), w = wid();
    const entry = orchestrator.store(a, w, { important: true }, MemoryType.DECISION, {
      tier: MemoryTier.L1,
      confidence: 0.9,
    });

    for (let i = 0; i < DEFAULT_MEMORY_CONFIG.promotionThreshold; i++) {
      orchestrator.getL2().retrieve(entry.id);
    }

    const result = orchestrator.runAutoTiering();
    expect(result.promoted).toBeGreaterThanOrEqual(1);
    expect(orchestrator.getL3().size).toBeGreaterThanOrEqual(1);
  });

  it('should handle task completion lifecycle', () => {
    const a = aid(), t = tid(), w = wid();
    orchestrator.store(a, w, { task: 'work' }, MemoryType.CONTEXT, { taskId: t });

    expect(orchestrator.onTaskCompleted(t)).toBeGreaterThanOrEqual(1);
  });

  it('should handle agent termination lifecycle', () => {
    const a = aid(), w = wid();
    orchestrator.store(a, w, { data: 1 }, MemoryType.CONTEXT);

    expect(orchestrator.onAgentTerminated(a)).toBeGreaterThanOrEqual(1);
  });

  it('should traverse knowledge graph via orchestrator', () => {
    orchestrator.getL4().addNode('agent', 'Chief', {}, { id: 'chief' });
    orchestrator.getL4().addNode('task', 'Task 1', {}, { id: 'task-1' });
    orchestrator.getL4().addEdge('chief', 'task-1', 'created');

    expect(orchestrator.traverse({ startNodeIds: ['chief'] }).nodes.length).toBe(2);
  });

  it('should get neighbors via orchestrator', () => {
    orchestrator.getL4().addNode('agent', 'Chief', {}, { id: 'chief' });
    orchestrator.getL4().addNode('task', 'Task 1', {}, { id: 'task-1' });
    orchestrator.getL4().addEdge('chief', 'task-1', 'created');

    expect(orchestrator.getNeighbors('chief').nodes.length).toBe(1);
  });

  it('should find shortest path via orchestrator', () => {
    orchestrator.getL4().addNode('agent', 'A', {}, { id: 'a' });
    orchestrator.getL4().addNode('task', 'T', {}, { id: 't' });
    orchestrator.getL4().addEdge('a', 't', 'created');

    const path = orchestrator.shortestPath('a', 't');
    expect(path).not.toBeNull();
    expect(path![0]!.nodeIds).toEqual(['a', 't']);
  });

  it('should return comprehensive stats', () => {
    const a = aid(), w = wid();
    orchestrator.store(a, w, { data: 1 }, MemoryType.CONTEXT);
    orchestrator.store(a, w, { data: 2 }, MemoryType.FACT);
    orchestrator.getL4().addNode('agent', 'Test', {});

    const stats = orchestrator.getStats();
    expect(stats.totalEntries).toBeGreaterThanOrEqual(2);
    expect(stats.totalGraphNodes).toBeGreaterThanOrEqual(1);
  });

  it('should disable auto-tiering when configured', () => {
    const noAutoOrch = new MemoryOrchestrator({ enableAutoTiering: false }, mockNow);
    const a = aid(), w = wid();
    const entry = noAutoOrch.store(a, w, { data: 1 }, MemoryType.DECISION, {
      tier: MemoryTier.L1,
      confidence: 0.9,
    });

    for (let i = 0; i < DEFAULT_MEMORY_CONFIG.promotionThreshold; i++) {
      noAutoOrch.getL2().retrieve(entry.id);
    }

    expect(noAutoOrch.runAutoTiering().promoted).toBe(0);
  });
});