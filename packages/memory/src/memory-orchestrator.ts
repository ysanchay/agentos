/**
 * @agentos/memory — Memory Orchestrator
 * Coordinates all 4 memory tiers: L1 Working, L2 Workspace, L3 Long-Term,
 * L4 Knowledge Graph. Handles auto-tiering (promote/demote), artifact
 * generation from ACP messages/task results/validations/allocations,
 * semantic search across L2+L3, and graph traversal on L4.
 *
 * Every completed task, ACP message, validation result, resource allocation,
 * and decision generates memory artifacts that can later be retrieved
 * through semantic search and graph traversal.
 */

import type {
  AgentID,
  TaskID,
  WorkspaceID,
  MemoryID,
} from '@agentos/types';
import { MemoryTier, MemoryType, createUUID } from '@agentos/types';
import type { MemoryEntry, MemoryRelation } from '@agentos/types';
import { L1WorkingMemory } from './l1-working-memory.js';
import { L2WorkspaceMemory } from './l2-workspace-memory.js';
import { L3LongTermMemory } from './l3-long-term-memory.js';
import { L4KnowledgeGraph } from './l4-knowledge-graph.js';
import type {
  MemoryEngineConfig,
  MemoryQuery,
  MemorySearchResult,
  MemoryArtifactSource,
  MemoryStats,
  GraphNode,
  GraphEdge,
  GraphTraversalOptions,
  GraphTraversalResult,
} from './types.js';
import { DEFAULT_MEMORY_CONFIG } from './types.js';

// ─── Memory Orchestrator ───────────────────────────────────────────────────

export class MemoryOrchestrator {
  private config: MemoryEngineConfig;
  private l1: L1WorkingMemory;
  private l2: L2WorkspaceMemory;
  private l3: L3LongTermMemory;
  private l4: L4KnowledgeGraph;
  private now: () => number;

  // Stats tracking
  private evictions: number = 0;
  private promotions: number = 0;
  private demotions: number = 0;

  constructor(config?: Partial<MemoryEngineConfig>, now?: () => number) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    this.now = now ?? Date.now;
    this.l1 = new L1WorkingMemory(this.config, this.now);
    this.l2 = new L2WorkspaceMemory(this.config, this.now);
    this.l3 = new L3LongTermMemory(this.config, this.now);
    this.l4 = new L4KnowledgeGraph(this.now);
  }

  // ─── Store ──────────────────────────────────────────────────────────────

  /**
   * Store a memory entry at the appropriate tier.
   */
  store(
    agentId: AgentID,
    workspaceId: WorkspaceID,
    content: unknown,
    type: MemoryType,
    options?: {
      tier?: MemoryTier;
      taskId?: TaskID;
      summary?: string;
      confidence?: number;
      tags?: string[];
      relations?: MemoryRelation[];
    },
  ): MemoryEntry {
    const tier = options?.tier ?? this.determineTier(type, options?.confidence);

    switch (tier) {
      case MemoryTier.L0:
        return this.l1.store(agentId, content, type, workspaceId, options);
      case MemoryTier.L1:
        return this.l2.store(workspaceId, content, type, agentId, options);
      case MemoryTier.L2:
        return this.l3.store(content, type, agentId, workspaceId, options);
      default:
        return this.l1.store(agentId, content, type, workspaceId, options);
    }
  }

  // ─── Artifact Generation ────────────────────────────────────────────────

  /**
   * Generate memory artifacts from various AgentOS events.
   */
  generateArtifact(source: MemoryArtifactSource, workspaceId: WorkspaceID): MemoryEntry[] {
    const artifacts: MemoryEntry[] = [];

    switch (source.type) {
      case 'task_result':
        artifacts.push(this.store(
          source.agentId,
          workspaceId,
          { output: source.output, taskId: source.taskId },
          MemoryType.RESULT,
          {
            tier: MemoryTier.L0, // Start in L1 working
            taskId: source.taskId,
            summary: `Task ${source.taskId} completed with confidence ${source.confidence}`,
            confidence: source.confidence,
            tags: ['task-result', 'completed'],
          },
        ));
        // Also store in L3 for persistence
        if (source.confidence >= this.config.archivalConfidenceThreshold) {
          artifacts.push(this.l3.store(
            { output: source.output, taskId: source.taskId },
            MemoryType.RESULT,
            source.agentId,
            workspaceId,
            {
              summary: `Task ${source.taskId} result (confidence: ${source.confidence})`,
              confidence: source.confidence,
              tags: ['task-result', 'completed', 'archived'],
            },
          ));
        }
        // Add graph nodes
        this.l4.addNode('task', `Task ${source.taskId}`, { taskId: source.taskId }, { id: source.taskId as string });
        this.l4.addNode('agent', `Agent ${source.agentId}`, { agentId: source.agentId }, { id: source.agentId as string });
        this.l4.addEdge(source.agentId as string, source.taskId as string, 'completed', source.confidence);
        break;

      case 'acp_message':
        artifacts.push(this.l1.store(
          source.sender,
          { messageId: source.messageId, messageType: source.messageType },
          MemoryType.OBSERVATION,
          workspaceId,
          {
            summary: `ACP message: ${source.messageType} from ${source.sender}`,
            tags: ['acp-message', source.messageType],
          },
        ));
        break;

      case 'validation':
        artifacts.push(this.store(
          source.validatorId,
          workspaceId,
          { taskId: source.taskId, approved: source.approved },
          MemoryType.FEEDBACK,
          {
            tier: MemoryTier.L1, // Workspace-level
            summary: `Validation of task ${source.taskId}: ${source.approved ? 'approved' : 'rejected'}`,
            confidence: source.confidence,
            tags: ['validation', source.approved ? 'approved' : 'rejected'],
          },
        ));
        // Add graph edge
        if (this.l4.getNode(source.validatorId as string)) {
          this.l4.addEdge(source.validatorId as string, source.taskId as string, 'validated', source.confidence);
        }
        break;

      case 'resource_allocation':
        artifacts.push(this.l2.store(
          workspaceId,
          { agentId: source.agentId, allocated: source.allocated, consumed: source.consumed },
          MemoryType.OBSERVATION,
          source.agentId,
          {
            summary: `Resource allocation for ${source.agentId}`,
            tags: ['resource', 'allocation'],
          },
        ));
        break;

      case 'decision':
        artifacts.push(this.store(
          source.agentId,
          workspaceId,
          { decision: source.decision, reasoning: source.reasoning, outcome: source.outcome },
          MemoryType.DECISION,
          {
            summary: `Decision: ${source.decision}`,
            tags: ['decision'],
          },
        ));
        // Add decision node to graph
        this.l4.addNode('decision', source.decision, {
          reasoning: source.reasoning,
          outcome: source.outcome,
        });
        break;

      case 'goal':
        artifacts.push(this.l2.store(
          workspaceId,
          { goalId: source.goalId, title: source.title, status: source.status },
          MemoryType.CONTEXT,
          createUUID() as unknown as AgentID,
          {
            summary: `Goal: ${source.title} (${source.status})`,
            tags: ['goal', source.status],
          },
        ));
        this.l4.addNode('project', source.title, { goalId: source.goalId, status: source.status }, { id: source.goalId });
        break;

      case 'workstream':
        artifacts.push(this.l2.store(
          workspaceId,
          { workstreamId: source.workstreamId, title: source.title, status: source.status, goalId: source.goalId },
          MemoryType.CONTEXT,
          createUUID() as unknown as AgentID,
          {
            summary: `Workstream: ${source.title} (${source.status})`,
            tags: ['workstream', source.status],
          },
        ));
        this.l4.addEdge(source.goalId, source.workstreamId, 'parent_of', 1.0);
        break;
    }

    return artifacts;
  }

  // ─── Retrieve ──────────────────────────────────────────────────────────

  /**
   * Retrieve a memory entry by ID (searches all tiers).
   */
  retrieve(memoryId: MemoryID): MemoryEntry | null {
    // Try L1 first (fastest)
    let entry = this.l1.retrieve(memoryId);
    if (entry) return entry;

    // Try L2
    entry = this.l2.retrieve(memoryId);
    if (entry) return entry;

    // Try L3
    entry = this.l3.retrieve(memoryId);
    if (entry) return entry;

    return null;
  }

  // ─── Search ────────────────────────────────────────────────────────────

  /**
   * Search across L1, L2, and L3 memory tiers.
   */
  search(query: MemoryQuery): MemorySearchResult[] {
    const results: MemorySearchResult[] = [];

    // Search L1
    if (!query.tier || query.tier === MemoryTier.L0) {
      if (query.text) {
        results.push(...this.l1.search(query.text, query.limit));
      }
    }

    // Search L2
    if (!query.tier || query.tier === MemoryTier.L1) {
      if (query.text) {
        results.push(...this.l2.search(query.text, query.workspaceId, query.limit));
      }
    }

    // Search L3
    if (!query.tier || query.tier === MemoryTier.L2) {
      results.push(...this.l3.search({
        text: query.text,
        type: query.type,
        workspaceId: query.workspaceId,
        agentId: query.sourceAgentId,
        minConfidence: query.minConfidence,
        tags: query.tags,
        limit: query.limit,
      }));
    }

    // Sort by score and apply limit
    const limit = query.limit ?? 50;
    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ─── Graph Operations ──────────────────────────────────────────────────

  /**
   * Traverse the knowledge graph.
   */
  traverse(options: GraphTraversalOptions): GraphTraversalResult {
    return this.l4.traverse(options);
  }

  /**
   * Get neighbors of a node in the knowledge graph.
   */
  getNeighbors(nodeId: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return this.l4.getNeighbors(nodeId);
  }

  /**
   * Find the shortest path between two nodes.
   */
  shortestPath(fromId: string, toId: string): Array<{ nodeIds: string[]; edgeIds: string[] }> | null {
    return this.l4.shortestPath(fromId, toId);
  }

  // ─── Auto-Tiering ────────────────────────────────────────────────────────

  /**
   * Run auto-tiering: promote frequently accessed entries, demote stale ones.
   */
  runAutoTiering(): { promoted: number; demoted: number } {
    let promoted = 0;
    let demoted = 0;

    if (!this.config.enableAutoTiering) {
      return { promoted, demoted };
    }

    // Promote L2 entries with high access to L3
    const promotable = this.l2.getPromotableEntries();
    for (const entry of promotable) {
      this.l3.store(
        entry.content,
        entry.type,
        entry.source_agent_id,
        entry.workspace_id,
        {
          summary: entry.summary,
          confidence: entry.confidence,
          tags: entry.tags,
          relations: entry.relations,
        },
      );
      promoted++;
      this.promotions++;
    }

    // Evict expired entries
    this.evictions += this.l1.evictExpired();
    this.evictions += this.l2.evictExpired();

    // Demote: entries in L1 that haven't been accessed recently
    // (they'll naturally expire via TTL)

    return { promoted, demoted };
  }

  // ─── Task Lifecycle ──────────────────────────────────────────────────────

  /**
   * Called when a task is completed — evict L1 entries for that task.
   */
  onTaskCompleted(taskId: TaskID): number {
    const evicted = this.l1.evictByTask(taskId);
    this.evictions += evicted;
    return evicted;
  }

  /**
   * Called when an agent terminates — evict L1 entries for that agent.
   */
  onAgentTerminated(agentId: AgentID): number {
    const evicted = this.l1.evictByAgent(agentId);
    this.evictions += evicted;
    return evicted;
  }

  // ─── Stats ─────────────────────────────────────────────────────────────

  getStats(): MemoryStats {
    const entriesByTier: Record<string, number> = {
      l0_hot: this.l1.size,
      l1_working: this.l2.size,
      l2_persistent: this.l3.size,
    };

    const l1Stats = this.l1.getStats();
    const l2Stats = this.l2.getStats();
    const l3Stats = this.l3.getStats();
    const l4Stats = this.l4.getStats();

    const entriesByType: Record<string, number> = {};
    for (const [type, count] of Object.entries(l1Stats.byType)) {
      entriesByType[type] = (entriesByType[type] ?? 0) + count;
    }
    for (const [type, count] of Object.entries(l2Stats.byType)) {
      entriesByType[type] = (entriesByType[type] ?? 0) + count;
    }
    for (const [type, count] of Object.entries(l3Stats.byType)) {
      entriesByType[type] = (entriesByType[type] ?? 0) + count;
    }

    return {
      totalEntries: this.l1.size + this.l2.size + this.l3.size,
      entriesByTier,
      entriesByType,
      totalRelations: 0, // Computed on demand
      totalGraphNodes: l4Stats.nodes,
      totalGraphEdges: l4Stats.edges,
      l1Size: this.l1.size,
      l2Size: this.l2.size,
      l3Size: this.l3.size,
      l4Size: l4Stats.nodes + l4Stats.edges,
      evictions: this.evictions,
      promotions: this.promotions,
      demotions: this.demotions,
    };
  }

  // ─── Tier Accessors ─────────────────────────────────────────────────────

  getL1(): L1WorkingMemory { return this.l1; }
  getL2(): L2WorkspaceMemory { return this.l2; }
  getL3(): L3LongTermMemory { return this.l3; }
  getL4(): L4KnowledgeGraph { return this.l4; }

  // ─── Private ───────────────────────────────────────────────────────────

  private determineTier(type: MemoryType, confidence?: number): MemoryTier {
    // High-confidence decisions and facts go straight to L2 (workspace)
    if (type === MemoryType.DECISION && (confidence ?? 0) >= 0.8) {
      return MemoryTier.L1;
    }

    // Facts and relationships go to L3 (long-term)
    if (type === MemoryType.FACT || type === MemoryType.RELATIONSHIP) {
      return MemoryTier.L2;
    }

    // Default: L1 (working memory)
    return MemoryTier.L0;
  }
}

