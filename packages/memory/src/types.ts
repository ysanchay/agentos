/**
 * @agentos/memory — Extended Memory Types
 * Extends the constitutional MemoryTier/MemoryType/MemoryEntry with
 * operational types for the four-tier memory engine.
 *
 * Constitutional mapping:
 *   L0_hot     → L1 Working Memory (active task context)
 *   L1_working → L2 Workspace Memory (project-level state)
 *   L2_persistent → L3 Long-Term Memory (persistent knowledge)
 *   L3_archival → L4 Knowledge Graph (entity relationships)
 */

import type {
  AgentID,
  TaskID,
  WorkspaceID,
  MemoryID,
  ISO8601,
} from '@agentos/types';
import { MemoryTier, MemoryType } from '@agentos/types';
import type { MemoryEntry, MemoryRelation } from '@agentos/types';

// ─── Tier Aliases (semantic mapping) ──────────────────────────────────────

/** L1 Working Memory — active task context, per-agent, evicts on task completion */
export const L1_WORKING = MemoryTier.L0;

/** L2 Workspace Memory — project-level state, shared across workspace agents */
export const L2_WORKSPACE = MemoryTier.L1;

/** L3 Long-Term Memory — persistent knowledge and prior decisions */
export const L3_LONG_TERM = MemoryTier.L2;

/** L4 Knowledge Graph — entity relationships and graph traversal */
export const L4_KNOWLEDGE_GRAPH = MemoryTier.L3;

// ─── Memory Query ──────────────────────────────────────────────────────────

export interface MemoryQuery {
  /** Text to search for (semantic or keyword) */
  text?: string;
  /** Filter by tier */
  tier?: MemoryTier;
  /** Filter by memory type */
  type?: MemoryType;
  /** Filter by source agent */
  sourceAgentId?: AgentID;
  /** Filter by workspace */
  workspaceId?: WorkspaceID;
  /** Filter by task */
  taskId?: TaskID;
  /** Filter by tags */
  tags?: string[];
  /** Minimum confidence threshold */
  minConfidence?: number;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number; // 0.0 - 1.0 relevance
  highlights?: string[];
}

// ─── Memory Store Options ──────────────────────────────────────────────────

export interface MemoryStoreOptions {
  /** Override the auto-determined tier */
  tier?: MemoryTier;
  /** Custom tags */
  tags?: string[];
  /** Custom confidence */
  confidence?: number;
  /** Expiration time */
  expiresAt?: ISO8601;
  /** Relations to other memories */
  relations?: MemoryRelation[];
}

// ─── Knowledge Graph Types ─────────────────────────────────────────────────

export type GraphNodeType =
  | 'agent'
  | 'task'
  | 'workspace'
  | 'capability'
  | 'decision'
  | 'result'
  | 'project'
  | 'memory'
  | 'outcome'
  | 'validation';

export type GraphEdgeType =
  | 'created'
  | 'completed'
  | 'depends_on'
  | 'relates_to'
  | 'causes'
  | 'contradicts'
  | 'extends'
  | 'supersedes'
  | 'validated'
  | 'allocated'
  | 'consumed'
  | 'produced'
  | 'assigned_to'
  | 'belongs_to'
  | 'reviewed_by'
  | 'parent_of';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  properties: Record<string, unknown>;
  memoryId?: MemoryID; // Link back to MemoryEntry
  createdAt: number;
  updatedAt: number;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: GraphEdgeType;
  weight: number; // 0.0 - 1.0 confidence/strength
  properties: Record<string, unknown>;
  createdAt: number;
}

// ─── Graph Traversal ───────────────────────────────────────────────────────

export interface GraphTraversalOptions {
  /** Starting node ID(s) */
  startNodeIds: string[];
  /** Edge types to follow (all if not specified) */
  edgeTypes?: GraphEdgeType[];
  /** Node types to include (all if not specified) */
  nodeTypes?: GraphNodeType[];
  /** Maximum depth */
  maxDepth?: number;
  /** Maximum results */
  limit?: number;
  /** Direction: 'outgoing', 'incoming', or 'both' */
  direction?: 'outgoing' | 'incoming' | 'both';
}

export interface GraphTraversalResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  paths: Array<{ nodeIds: string[]; edgeIds: string[] }>;
}

// ─── Memory Stats ──────────────────────────────────────────────────────────

export interface MemoryStats {
  totalEntries: number;
  entriesByTier: Record<string, number>;
  entriesByType: Record<string, number>;
  totalRelations: number;
  totalGraphNodes: number;
  totalGraphEdges: number;
  l1Size: number;
  l2Size: number;
  l3Size: number;
  l4Size: number;
  evictions: number;
  promotions: number;
  demotions: number;
}

// ─── Memory Artifact Source ────────────────────────────────────────────────

export type MemoryArtifactSource =
  | { type: 'task_result'; taskId: TaskID; agentId: AgentID; output: unknown; confidence: number }
  | { type: 'acp_message'; messageId: string; sender: AgentID; recipient: AgentID | '*'; messageType: string }
  | { type: 'validation'; taskId: TaskID; validatorId: AgentID; approved: boolean; confidence: number }
  | { type: 'resource_allocation'; agentId: AgentID; allocated: Record<string, number>; consumed: Record<string, number> }
  | { type: 'decision'; agentId: AgentID; decision: string; reasoning: string; outcome: unknown }
  | { type: 'goal'; goalId: string; title: string; status: string }
  | { type: 'workstream'; workstreamId: string; title: string; status: string; goalId: string };

// ─── Memory Engine Config ──────────────────────────────────────────────────

export interface MemoryEngineConfig {
  /** Maximum entries in L1 Working Memory per agent */
  l1MaxPerAgent: number;
  /** Maximum entries in L2 Workspace Memory per workspace */
  l2MaxPerWorkspace: number;
  /** Maximum entries in L3 Long-Term Memory */
  l3MaxEntries: number;
  /** L1 entry TTL in milliseconds (default: 5 minutes) */
  l1TtlMs: number;
  /** L2 entry TTL in milliseconds (default: 1 hour) */
  l2TtlMs: number;
  /** L3 has no TTL (persistent) */
  /** Minimum access count for promotion to next tier */
  promotionThreshold: number;
  /** Confidence threshold for auto-archival to L3 */
  archivalConfidenceThreshold: number;
  /** Enable auto-tiering (promote/demote based on access patterns) */
  enableAutoTiering: boolean;
}

export const DEFAULT_MEMORY_CONFIG: MemoryEngineConfig = {
  l1MaxPerAgent: 100,
  l2MaxPerWorkspace: 1000,
  l3MaxEntries: 100_000,
  l1TtlMs: 300_000, // 5 minutes
  l2TtlMs: 3_600_000, // 1 hour
  promotionThreshold: 3,
  archivalConfidenceThreshold: 0.8,
  enableAutoTiering: true,
};