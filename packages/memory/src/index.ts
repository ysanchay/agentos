/**
 * @agentos/memory — Four-Tier Memory Engine for AgentOS
 * L1 Working Memory → L2 Workspace Memory → L3 Long-Term Memory → L4 Knowledge Graph
 *
 * Every completed task, ACP message, validation result, resource allocation,
 * and decision generates memory artifacts that can later be retrieved
 * through semantic search and graph traversal.
 */

// ─── Memory Tiers ─────────────────────────────────────────────────────────

export { L1WorkingMemory } from './l1-working-memory.js';
export { L2WorkspaceMemory } from './l2-workspace-memory.js';
export { L3LongTermMemory } from './l3-long-term-memory.js';
export { L4KnowledgeGraph } from './l4-knowledge-graph.js';

// ─── Orchestrator ──────────────────────────────────────────────────────────

export { MemoryOrchestrator } from './memory-orchestrator.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type {
  MemoryQuery,
  MemorySearchResult,
  MemoryStoreOptions,
  GraphNodeType,
  GraphEdgeType,
  GraphNode,
  GraphEdge,
  GraphTraversalOptions,
  GraphTraversalResult,
  MemoryStats,
  MemoryArtifactSource,
  MemoryEngineConfig,
} from './types.js';

export {
  L1_WORKING,
  L2_WORKSPACE,
  L3_LONG_TERM,
  L4_KNOWLEDGE_GRAPH,
  DEFAULT_MEMORY_CONFIG,
} from './types.js';