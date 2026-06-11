/**
 * @agentos/memory — L1 Working Memory
 * Short-lived, per-agent memory for active task context.
 * Stores current task state, recent messages, active decisions.
 * Evicts on task completion or TTL expiration.
 *
 * Constitutional basis: MemoryTier.L0 (hot) — fastest access, smallest capacity.
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

// ─── L1 Entry (extends MemoryEntry with L1-specific metadata) ────────────

interface L1Entry {
  entry: MemoryEntry;
  taskId?: TaskID; // Bound to a specific task
  accessedAt: number;
  createdAt: number;
}

// ─── L1 Working Memory ────────────────────────────────────────────────────

export class L1WorkingMemory {
  private entries: Map<MemoryID, L1Entry> = new Map();
  private agentIndex: Map<AgentID, Set<MemoryID>> = new Map();
  private taskIndex: Map<TaskID, Set<MemoryID>> = new Map();
  private config: MemoryEngineConfig;
  private now: () => number;

  constructor(config: MemoryEngineConfig, now?: () => number) {
    this.config = config;
    this.now = now ?? Date.now;
  }

  // ─── Store ──────────────────────────────────────────────────────────────

  /**
   * Store a memory entry in L1 Working Memory.
   */
  store(
    agentId: AgentID,
    content: unknown,
    type: MemoryType,
    workspaceId: WorkspaceID,
    options?: {
      taskId?: TaskID;
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
      tier: MemoryTier.L0,
      content,
      summary: options?.summary,
      workspace_id: workspaceId,
      source_agent_id: agentId,
      source_type: 'agent',
      confidence: options?.confidence ?? 1.0,
      tags: options?.tags ?? [],
      embeddings: undefined,
      relations: options?.relations ?? [],
      access_count: 0,
      last_accessed_at: now.toString(),
      expires_at: options?.expiresAt ?? (now + this.config.l1TtlMs).toString(),
      version: 1,
      created_at: now.toString(),
      updated_at: now.toString(),
    };

    const l1Entry: L1Entry = {
      entry,
      taskId: options?.taskId,
      accessedAt: now,
      createdAt: now,
    };

    this.entries.set(memoryId, l1Entry);

    // Update agent index
    let agentEntries = this.agentIndex.get(agentId);
    if (!agentEntries) {
      agentEntries = new Set();
      this.agentIndex.set(agentId, agentEntries);
    }
    agentEntries.add(memoryId);

    // Update task index
    if (options?.taskId) {
      let taskEntries = this.taskIndex.get(options.taskId);
      if (!taskEntries) {
        taskEntries = new Set();
        this.taskIndex.set(options.taskId, taskEntries);
      }
      taskEntries.add(memoryId);
    }

    // Evict if over capacity
    this.evictIfNeeded(agentId);

    return entry;
  }

  // ─── Retrieve ──────────────────────────────────────────────────────────

  /**
   * Retrieve a memory entry by ID.
   */
  retrieve(memoryId: MemoryID): MemoryEntry | null {
    const l1Entry = this.entries.get(memoryId);
    if (!l1Entry) return null;

    // Check expiration
    if (this.isExpired(l1Entry)) {
      this.evict(memoryId);
      return null;
    }

    // Update access tracking
    l1Entry.accessedAt = this.now();
    l1Entry.entry.access_count++;
    l1Entry.entry.last_accessed_at = this.now().toString();

    return { ...l1Entry.entry };
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
   * Get all entries for a specific task.
   */
  getByTask(taskId: TaskID): MemoryEntry[] {
    const ids = this.taskIndex.get(taskId);
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
   * Search L1 Working Memory by text content.
   * Simple keyword matching (no embeddings in L1).
   */
  search(text: string, limit: number = 10): MemorySearchResult[] {
    const lowerText = text.toLowerCase();
    const results: MemorySearchResult[] = [];

    for (const [id, l1Entry] of this.entries) {
      if (this.isExpired(l1Entry)) {
        this.evict(id);
        continue;
      }

      const contentStr = JSON.stringify(l1Entry.entry.content).toLowerCase();
      const summaryMatch = l1Entry.entry.summary?.toLowerCase().includes(lowerText) ?? false;
      const contentMatch = contentStr.includes(lowerText);

      if (contentMatch || summaryMatch) {
        results.push({
          entry: { ...l1Entry.entry },
          score: summaryMatch ? 1.0 : 0.7,
        });

        if (results.length >= limit) break;
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  // ─── Eviction ──────────────────────────────────────────────────────────

  /**
   * Evict all entries for a completed task.
   */
  evictByTask(taskId: TaskID): number {
    const ids = this.taskIndex.get(taskId);
    if (!ids) return 0;

    let evicted = 0;
    for (const id of ids) {
      this.evict(id);
      evicted++;
    }
    this.taskIndex.delete(taskId);
    return evicted;
  }

  /**
   * Evict all entries for an agent (e.g., when agent terminates).
   */
  evictByAgent(agentId: AgentID): number {
    const ids = this.agentIndex.get(agentId);
    if (!ids) return 0;

    let evicted = 0;
    for (const id of ids) {
      this.evict(id);
      evicted++;
    }
    this.agentIndex.delete(agentId);
    return evicted;
  }

  /**
   * Evict expired entries.
   */
  evictExpired(): number {
    let evicted = 0;
    for (const [id, l1Entry] of this.entries) {
      if (this.isExpired(l1Entry)) {
        this.evict(id);
        evicted++;
      }
    }
    return evicted;
  }

  // ─── Stats ─────────────────────────────────────────────────────────────

  get size(): number {
    return this.entries.size;
  }

  getStats(): { total: number; byType: Record<string, number>; byAgent: Record<string, number> } {
    const byType: Record<string, number> = {};
    const byAgent: Record<string, number> = {};

    for (const [, l1Entry] of this.entries) {
      const type = l1Entry.entry.type as string;
      byType[type] = (byType[type] ?? 0) + 1;

      const agent = l1Entry.entry.source_agent_id as string;
      byAgent[agent] = (byAgent[agent] ?? 0) + 1;
    }

    return { total: this.entries.size, byType, byAgent };
  }

  // ─── Private ───────────────────────────────────────────────────────────

  private evict(memoryId: MemoryID): void {
    const l1Entry = this.entries.get(memoryId);
    if (!l1Entry) return;

    // Remove from agent index
    const agentEntries = this.agentIndex.get(l1Entry.entry.source_agent_id);
    if (agentEntries) {
      agentEntries.delete(memoryId);
      if (agentEntries.size === 0) {
        this.agentIndex.delete(l1Entry.entry.source_agent_id);
      }
    }

    // Remove from task index
    if (l1Entry.taskId) {
      const taskEntries = this.taskIndex.get(l1Entry.taskId);
      if (taskEntries) {
        taskEntries.delete(memoryId);
        if (taskEntries.size === 0) {
          this.taskIndex.delete(l1Entry.taskId);
        }
      }
    }

    this.entries.delete(memoryId);
  }

  private evictIfNeeded(agentId: AgentID): void {
    const ids = this.agentIndex.get(agentId);
    if (!ids || ids.size <= this.config.l1MaxPerAgent) return;

    // Evict oldest entries first
    const sorted = Array.from(ids)
      .map((id) => ({ id, entry: this.entries.get(id)! }))
      .filter((e) => e.entry !== undefined)
      .sort((a, b) => a.entry.accessedAt - b.entry.accessedAt);

    const excess = sorted.length - this.config.l1MaxPerAgent;
    for (let i = 0; i < excess; i++) {
      this.evict(sorted[i]!.id);
    }
  }

  private isExpired(l1Entry: L1Entry): boolean {
    if (!l1Entry.entry.expires_at) return false;
    return this.now() > parseInt(l1Entry.entry.expires_at, 10);
  }
}