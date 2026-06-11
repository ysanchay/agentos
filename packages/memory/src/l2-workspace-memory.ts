/**
 * @agentos/memory — L2 Workspace Memory
 * Project-level state shared across agents in a workspace.
 * Stores project context, workstream progress, shared decisions,
 * aggregated results. Survives across tasks but scoped to workspace.
 *
 * Constitutional basis: MemoryTier.L1 (working) — medium access, medium capacity.
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

// ─── L2 Entry ──────────────────────────────────────────────────────────────

interface L2Entry {
  entry: MemoryEntry;
  accessedAt: number;
  createdAt: number;
}

// ─── L2 Workspace Memory ───────────────────────────────────────────────────

export class L2WorkspaceMemory {
  private entries: Map<MemoryID, L2Entry> = new Map();
  private workspaceIndex: Map<WorkspaceID, Set<MemoryID>> = new Map();
  private config: MemoryEngineConfig;
  private now: () => number;

  constructor(config: MemoryEngineConfig, now?: () => number) {
    this.config = config;
    this.now = now ?? Date.now;
  }

  // ─── Store ──────────────────────────────────────────────────────────────

  /**
   * Store a memory entry in L2 Workspace Memory.
   */
  store(
    workspaceId: WorkspaceID,
    content: unknown,
    type: MemoryType,
    sourceAgentId: AgentID,
    options?: {
      summary?: string;
      confidence?: number;
      tags?: string[];
      relations?: MemoryRelation[];
      expiresAt?: string;
    },
  ): MemoryEntry {
    const now = this.now();
    const memoryId = createUUID() as unknown as MemoryID;

    const entry: MemoryEntry = {
      id: memoryId,
      type,
      tier: MemoryTier.L1,
      content,
      summary: options?.summary,
      workspace_id: workspaceId,
      source_agent_id: sourceAgentId,
      source_type: 'agent',
      confidence: options?.confidence ?? 0.9,
      tags: options?.tags ?? [],
      embeddings: undefined,
      relations: options?.relations ?? [],
      access_count: 0,
      last_accessed_at: now.toString(),
      expires_at: options?.expiresAt ?? (now + this.config.l2TtlMs).toString(),
      version: 1,
      created_at: now.toString(),
      updated_at: now.toString(),
    };

    const l2Entry: L2Entry = {
      entry,
      accessedAt: now,
      createdAt: now,
    };

    this.entries.set(memoryId, l2Entry);

    // Update workspace index
    let wsEntries = this.workspaceIndex.get(workspaceId);
    if (!wsEntries) {
      wsEntries = new Set();
      this.workspaceIndex.set(workspaceId, wsEntries);
    }
    wsEntries.add(memoryId);

    // Evict if over capacity
    this.evictIfNeeded(workspaceId);

    return entry;
  }

  // ─── Retrieve ──────────────────────────────────────────────────────────

  /**
   * Retrieve a memory entry by ID.
   */
  retrieve(memoryId: MemoryID): MemoryEntry | null {
    const l2Entry = this.entries.get(memoryId);
    if (!l2Entry) return null;

    if (this.isExpired(l2Entry)) {
      this.evict(memoryId);
      return null;
    }

    l2Entry.accessedAt = this.now();
    l2Entry.entry.access_count++;
    l2Entry.entry.last_accessed_at = this.now().toString();

    return { ...l2Entry.entry };
  }

  /**
   * Get all entries for a workspace.
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
   * Search L2 Workspace Memory by text content.
   * Keyword matching with workspace scoping.
   */
  search(text: string, workspaceId?: WorkspaceID, limit: number = 20): MemorySearchResult[] {
    const lowerText = text.toLowerCase();
    const results: MemorySearchResult[] = [];

    for (const [id, l2Entry] of this.entries) {
      if (this.isExpired(l2Entry)) {
        this.evict(id);
        continue;
      }

      // Filter by workspace
      if (workspaceId && l2Entry.entry.workspace_id !== workspaceId) continue;

      const contentStr = JSON.stringify(l2Entry.entry.content).toLowerCase();
      const summaryMatch = l2Entry.entry.summary?.toLowerCase().includes(lowerText) ?? false;
      const contentMatch = contentStr.includes(lowerText);

      if (contentMatch || summaryMatch) {
        results.push({
          entry: { ...l2Entry.entry },
          score: summaryMatch ? 1.0 : 0.7,
        });

        if (results.length >= limit) break;
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  // ─── Eviction ──────────────────────────────────────────────────────────

  /**
   * Evict all entries for a workspace.
   */
  evictByWorkspace(workspaceId: WorkspaceID): number {
    const ids = this.workspaceIndex.get(workspaceId);
    if (!ids) return 0;

    let evicted = 0;
    for (const id of ids) {
      this.evict(id);
      evicted++;
    }
    this.workspaceIndex.delete(workspaceId);
    return evicted;
  }

  /**
   * Evict expired entries.
   */
  evictExpired(): number {
    let evicted = 0;
    for (const [id, l2Entry] of this.entries) {
      if (this.isExpired(l2Entry)) {
        this.evict(id);
        evicted++;
      }
    }
    return evicted;
  }

  /**
   * Get entries eligible for promotion to L3 (high access count, high confidence).
   */
  getPromotableEntries(): MemoryEntry[] {
    const results: MemoryEntry[] = [];

    for (const [, l2Entry] of this.entries) {
      if (
        l2Entry.entry.access_count >= this.config.promotionThreshold &&
        l2Entry.entry.confidence >= this.config.archivalConfidenceThreshold
      ) {
        results.push({ ...l2Entry.entry });
      }
    }

    return results;
  }

  // ─── Stats ─────────────────────────────────────────────────────────────

  get size(): number {
    return this.entries.size;
  }

  getStats(): { total: number; byWorkspace: Record<string, number>; byType: Record<string, number> } {
    const byWorkspace: Record<string, number> = {};
    const byType: Record<string, number> = {};

    for (const [, l2Entry] of this.entries) {
      const ws = l2Entry.entry.workspace_id as string;
      byWorkspace[ws] = (byWorkspace[ws] ?? 0) + 1;

      const type = l2Entry.entry.type as string;
      byType[type] = (byType[type] ?? 0) + 1;
    }

    return { total: this.entries.size, byWorkspace, byType };
  }

  // ─── Private ───────────────────────────────────────────────────────────

  private evict(memoryId: MemoryID): void {
    const l2Entry = this.entries.get(memoryId);
    if (!l2Entry) return;

    const wsEntries = this.workspaceIndex.get(l2Entry.entry.workspace_id);
    if (wsEntries) {
      wsEntries.delete(memoryId);
      if (wsEntries.size === 0) {
        this.workspaceIndex.delete(l2Entry.entry.workspace_id);
      }
    }

    this.entries.delete(memoryId);
  }

  private evictIfNeeded(workspaceId: WorkspaceID): void {
    const ids = this.workspaceIndex.get(workspaceId);
    if (!ids || ids.size <= this.config.l2MaxPerWorkspace) return;

    const sorted = Array.from(ids)
      .map((id) => ({ id, entry: this.entries.get(id)! }))
      .filter((e) => e.entry !== undefined)
      .sort((a, b) => a.entry.accessedAt - b.entry.accessedAt);

    const excess = sorted.length - this.config.l2MaxPerWorkspace;
    for (let i = 0; i < excess; i++) {
      this.evict(sorted[i]!.id);
    }
  }

  private isExpired(l2Entry: L2Entry): boolean {
    if (!l2Entry.entry.expires_at) return false;
    return this.now() > parseInt(l2Entry.entry.expires_at, 10);
  }
}