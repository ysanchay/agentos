/**
 * @agentos/memory — L3 Long-Term Memory
 * Persistent knowledge and prior decisions. Stores completed task results,
 * learned patterns, decision history, capability performance data.
 * Survives across sessions. Supports semantic retrieval.
 *
 * Constitutional basis: MemoryTier.L2 (persistent) — slower access, large capacity.
 */

import type {
  AgentID,
  TaskID,
  WorkspaceID,
  MemoryID,
} from '@agentos/types';
import { createUUID, MemoryTier, MemoryType } from '@agentos/types';
import type { MemoryEntry, MemoryRelation } from '@agentos/types';
import type { MemoryEngineConfig, MemorySearchResult } from './types.js';

// ─── L3 Entry ──────────────────────────────────────────────────────────────

interface L3Entry {
  entry: MemoryEntry;
  accessedAt: number;
  createdAt: number;
}

// ─── L3 Long-Term Memory ──────────────────────────────────────────────────

export class L3LongTermMemory {
  private entries: Map<MemoryID, L3Entry> = new Map();
  private typeIndex: Map<string, Set<MemoryID>> = new Map(); // MemoryType → IDs
  private agentIndex: Map<AgentID, Set<MemoryID>> = new Map();
  private workspaceIndex: Map<WorkspaceID, Set<MemoryID>> = new Map();
  private config: MemoryEngineConfig;
  private now: () => number;

  constructor(config: MemoryEngineConfig, now?: () => number) {
    this.config = config;
    this.now = now ?? Date.now;
  }

  // ─── Store ──────────────────────────────────────────────────────────────

  /**
   * Store a memory entry in L3 Long-Term Memory.
   * L3 entries have no TTL — they persist until explicitly deleted.
   */
  store(
    content: unknown,
    type: MemoryType,
    sourceAgentId: AgentID,
    workspaceId: WorkspaceID,
    options?: {
      summary?: string;
      confidence?: number;
      tags?: string[];
      relations?: MemoryRelation[];
    },
  ): MemoryEntry {
    const now = this.now();
    const memoryId = createUUID() as unknown as MemoryID;

    const entry: MemoryEntry = {
      id: memoryId,
      type,
      tier: MemoryTier.L2,
      content,
      summary: options?.summary,
      workspace_id: workspaceId,
      source_agent_id: sourceAgentId,
      source_type: 'agent',
      confidence: options?.confidence ?? 0.8,
      tags: options?.tags ?? [],
      embeddings: undefined,
      relations: options?.relations ?? [],
      access_count: 0,
      last_accessed_at: now.toString(),
      expires_at: undefined, // L3 never expires
      version: 1,
      created_at: now.toString(),
      updated_at: now.toString(),
    };

    const l3Entry: L3Entry = {
      entry,
      accessedAt: now,
      createdAt: now,
    };

    this.entries.set(memoryId, l3Entry);

    // Update type index
    const typeKey = type as string;
    let typeEntries = this.typeIndex.get(typeKey);
    if (!typeEntries) {
      typeEntries = new Set();
      this.typeIndex.set(typeKey, typeEntries);
    }
    typeEntries.add(memoryId);

    // Update agent index
    let agentEntries = this.agentIndex.get(sourceAgentId);
    if (!agentEntries) {
      agentEntries = new Set();
      this.agentIndex.set(sourceAgentId, agentEntries);
    }
    agentEntries.add(memoryId);

    // Update workspace index
    let wsEntries = this.workspaceIndex.get(workspaceId);
    if (!wsEntries) {
      wsEntries = new Set();
      this.workspaceIndex.set(workspaceId, wsEntries);
    }
    wsEntries.add(memoryId);

    return entry;
  }

  // ─── Retrieve ──────────────────────────────────────────────────────────

  /**
   * Retrieve a memory entry by ID.
   */
  retrieve(memoryId: MemoryID): MemoryEntry | null {
    const l3Entry = this.entries.get(memoryId);
    if (!l3Entry) return null;

    l3Entry.accessedAt = this.now();
    l3Entry.entry.access_count++;
    l3Entry.entry.last_accessed_at = this.now().toString();

    return { ...l3Entry.entry };
  }

  /**
   * Get all entries of a specific memory type.
   */
  getByType(type: MemoryType): MemoryEntry[] {
    const ids = this.typeIndex.get(type as string);
    if (!ids) return [];

    const results: MemoryEntry[] = [];
    for (const id of ids) {
      const entry = this.retrieve(id);
      if (entry) results.push(entry);
    }
    return results;
  }

  /**
   * Get all entries for a specific agent.
   */
  getByAgent(agentId: AgentID): MemoryEntry[] {
    const ids = this.agentIndex.get(agentId);
    if (!ids) return [];

    const results: MemoryEntry[] = [];
    for (const id of ids) {
      const entry = this.retrieve(id);
      if (entry) results.push(entry);
    }
    return results;
  }

  /**
   * Get all entries for a specific workspace.
   */
  getByWorkspace(workspaceId: WorkspaceID): MemoryEntry[] {
    const ids = this.workspaceIndex.get(workspaceId);
    if (!ids) return [];

    const results: MemoryEntry[] = [];
    for (const id of ids) {
      const entry = this.retrieve(id);
      if (entry) results.push(entry);
    }
    return results;
  }

  // ─── Search ────────────────────────────────────────────────────────────

  /**
   * Search L3 Long-Term Memory by text content.
   * Supports filtering by type, workspace, agent, confidence, and tags.
   */
  search(query: {
    text?: string;
    type?: MemoryType;
    workspaceId?: WorkspaceID;
    agentId?: AgentID;
    minConfidence?: number;
    tags?: string[];
    limit?: number;
  }): MemorySearchResult[] {
    const lowerText = query.text?.toLowerCase();
    const results: MemorySearchResult[] = [];
    const limit = query.limit ?? 50;

    for (const [id, l3Entry] of this.entries) {
      // Filter by type
      if (query.type && l3Entry.entry.type !== query.type) continue;

      // Filter by workspace
      if (query.workspaceId && l3Entry.entry.workspace_id !== query.workspaceId) continue;

      // Filter by agent
      if (query.agentId && l3Entry.entry.source_agent_id !== query.agentId) continue;

      // Filter by confidence
      if (query.minConfidence && l3Entry.entry.confidence < query.minConfidence) continue;

      // Filter by tags
      if (query.tags && query.tags.length > 0) {
        const hasTag = query.tags.some((tag) =>
          l3Entry.entry.tags.includes(tag),
        );
        if (!hasTag) continue;
      }

      // Text search
      if (lowerText) {
        const contentStr = JSON.stringify(l3Entry.entry.content).toLowerCase();
        const summaryMatch = l3Entry.entry.summary?.toLowerCase().includes(lowerText) ?? false;
        const contentMatch = contentStr.includes(lowerText);

        if (!contentMatch && !summaryMatch) continue;

        results.push({
          entry: { ...l3Entry.entry },
          score: summaryMatch ? 1.0 : 0.7,
        });
      } else {
        results.push({
          entry: { ...l3Entry.entry },
          score: 1.0,
        });
      }

      if (results.length >= limit) break;
    }

    return results.sort((a, b) => b.score - a.score);
  }

  // ─── Delete ────────────────────────────────────────────────────────────

  /**
   * Delete a memory entry.
   */
  delete(memoryId: MemoryID): boolean {
    const l3Entry = this.entries.get(memoryId);
    if (!l3Entry) return false;

    // Remove from type index
    const typeKey = l3Entry.entry.type as string;
    const typeEntries = this.typeIndex.get(typeKey);
    if (typeEntries) {
      typeEntries.delete(memoryId);
      if (typeEntries.size === 0) this.typeIndex.delete(typeKey);
    }

    // Remove from agent index
    const agentEntries = this.agentIndex.get(l3Entry.entry.source_agent_id);
    if (agentEntries) {
      agentEntries.delete(memoryId);
      if (agentEntries.size === 0) this.agentIndex.delete(l3Entry.entry.source_agent_id);
    }

    // Remove from workspace index
    const wsEntries = this.workspaceIndex.get(l3Entry.entry.workspace_id);
    if (wsEntries) {
      wsEntries.delete(memoryId);
      if (wsEntries.size === 0) this.workspaceIndex.delete(l3Entry.entry.workspace_id);
    }

    this.entries.delete(memoryId);
    return true;
  }

  // ─── Stats ─────────────────────────────────────────────────────────────

  get size(): number {
    return this.entries.size;
  }

  getStats(): {
    total: number;
    byType: Record<string, number>;
    byAgent: Record<string, number>;
    byWorkspace: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    const byWorkspace: Record<string, number> = {};

    for (const [, l3Entry] of this.entries) {
      const type = l3Entry.entry.type as string;
      byType[type] = (byType[type] ?? 0) + 1;

      const agent = l3Entry.entry.source_agent_id as string;
      byAgent[agent] = (byAgent[agent] ?? 0) + 1;

      const ws = l3Entry.entry.workspace_id as string;
      byWorkspace[ws] = (byWorkspace[ws] ?? 0) + 1;
    }

    return { total: this.entries.size, byType, byAgent, byWorkspace };
  }
}