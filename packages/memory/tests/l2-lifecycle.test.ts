/**
 * @agentos/memory — L2 Workspace Memory Lifecycle Tests
 * TTL enforcement, workspace capacity limits, eviction, access tracking,
 * promotion candidates, and index cleanup.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createUUID, MemoryTier, MemoryType } from '@agentos/types';
import type { AgentID, WorkspaceID } from '@agentos/types';
import { L2WorkspaceMemory } from '../src/l2-workspace-memory.js';
import { DEFAULT_MEMORY_CONFIG } from '../src/types.js';

let currentTime = 1_000_000;
const mockNow = () => currentTime;

function aid(): AgentID { return createUUID() as unknown as AgentID; }
function wid(): WorkspaceID { return createUUID() as unknown as WorkspaceID; }

describe('L2WorkspaceMemory Lifecycle', () => {
  let l2: L2WorkspaceMemory;

  beforeEach(() => {
    currentTime = 1_000_000;
    l2 = new L2WorkspaceMemory(DEFAULT_MEMORY_CONFIG, mockNow);
  });

  // ─── TTL Enforcement ──────────────────────────────────────────────────────

  it('should expire entries after l2TtlMs', () => {
    const a = aid(), w = wid();
    const entry = l2.store(w, { data: 'temp' }, MemoryType.CONTEXT, a);

    // Before expiry
    expect(l2.retrieve(entry.id)).not.toBeNull();

    // After expiry
    currentTime = 1_000_000 + DEFAULT_MEMORY_CONFIG.l2TtlMs + 1;
    expect(l2.retrieve(entry.id)).toBeNull();
  });

  it('should enforce TTL at boundary (exactly at l2TtlMs)', () => {
    const a = aid(), w = wid();
    const entry = l2.store(w, { data: 'edge' }, MemoryType.FACT, a);

    // Exactly at TTL — still valid (now > parseInt(expires_at) is false when equal)
    currentTime = 1_000_000 + DEFAULT_MEMORY_CONFIG.l2TtlMs;
    expect(l2.retrieve(entry.id)).not.toBeNull();

    // Just past TTL
    currentTime = 1_000_000 + DEFAULT_MEMORY_CONFIG.l2TtlMs + 1;
    expect(l2.retrieve(entry.id)).toBeNull();
  });

  it('should accept entries with explicit expiration override', () => {
    const a = aid(), w = wid();
    const customExpiry = (1_000_000 + 60_000).toString(); // 1 minute from now
    const entry = l2.store(w, { data: 'custom' }, MemoryType.FACT, a, { expiresAt: customExpiry });

    // Before custom expiry
    currentTime = 1_000_000 + 30_000;
    expect(l2.retrieve(entry.id)).not.toBeNull();

    // After custom expiry
    currentTime = 1_000_000 + 61_000;
    expect(l2.retrieve(entry.id)).toBeNull();
  });

  // ─── Workspace Capacity ────────────────────────────────────────────────────

  it('should enforce per-workspace capacity limit', () => {
    const a = aid(), w = wid();
    const smallL2 = new L2WorkspaceMemory({ ...DEFAULT_MEMORY_CONFIG, l2MaxPerWorkspace: 3 }, mockNow);

    for (let i = 0; i < 5; i++) {
      smallL2.store(w, { index: i }, MemoryType.FACT, a);
    }

    expect(smallL2.size).toBe(3);
  });

  it('should evict oldest-accessed entries when over workspace capacity', () => {
    const a = aid(), w = wid();
    const smallL2 = new L2WorkspaceMemory({ ...DEFAULT_MEMORY_CONFIG, l2MaxPerWorkspace: 3 }, mockNow);

    const entries = [];
    for (let i = 0; i < 4; i++) {
      entries.push(smallL2.store(w, { index: i }, MemoryType.FACT, a));
    }

    // First entry should have been evicted (oldest accessedAt)
    expect(smallL2.retrieve(entries[0]!.id)).toBeNull();
    // Later entries should still be present
    expect(smallL2.retrieve(entries[1]!.id)).not.toBeNull();
  });

  it('should maintain independent capacity limits per workspace', () => {
    const a = aid(), w1 = wid(), w2 = wid();
    const smallL2 = new L2WorkspaceMemory({ ...DEFAULT_MEMORY_CONFIG, l2MaxPerWorkspace: 2 }, mockNow);

    smallL2.store(w1, { ws: 1, i: 0 }, MemoryType.FACT, a);
    smallL2.store(w1, { ws: 1, i: 1 }, MemoryType.FACT, a);

    smallL2.store(w2, { ws: 2, i: 0 }, MemoryType.FACT, a);
    smallL2.store(w2, { ws: 2, i: 1 }, MemoryType.FACT, a);

    // Both workspaces should have 2 entries each
    expect(smallL2.getByWorkspace(w1).length).toBe(2);
    expect(smallL2.getByWorkspace(w2).length).toBe(2);
  });

  // ─── Eviction ──────────────────────────────────────────────────────────────

  it('should evict expired entries while preserving non-expired', () => {
    const a = aid(), w = wid();
    const entry1 = l2.store(w, { data: 'expires' }, MemoryType.CONTEXT, a);
    currentTime += 10_000; // advance slightly
    const entry2 = l2.store(w, { data: 'persists' }, MemoryType.CONTEXT, a);

    // Expire only the first entry (by advancing past its TTL)
    currentTime = 1_000_000 + DEFAULT_MEMORY_CONFIG.l2TtlMs + 1;

    const evicted = l2.evictExpired();
    expect(evicted).toBeGreaterThanOrEqual(1);
    expect(l2.retrieve(entry1.id)).toBeNull();
    // entry2 was created 10s later, so it's still valid (10s remaining on its TTL)
    expect(l2.retrieve(entry2.id)).not.toBeNull();
  });

  it('should evict all entries for a workspace', () => {
    const a = aid(), w = wid();
    l2.store(w, { data: 1 }, MemoryType.FACT, a);
    l2.store(w, { data: 2 }, MemoryType.FACT, a);
    l2.store(w, { data: 3 }, MemoryType.FACT, a);

    expect(l2.evictByWorkspace(w)).toBe(3);
    expect(l2.size).toBe(0);
  });

  it('should clean up workspace index on eviction', () => {
    const a = aid(), w = wid();
    l2.store(w, { data: 1 }, MemoryType.FACT, a);

    l2.evictByWorkspace(w);

    // After full eviction, workspace should not appear in stats
    const stats = l2.getStats();
    expect(stats.byWorkspace[w as string] ?? 0).toBe(0);
  });

  // ─── Access Tracking ───────────────────────────────────────────────────────

  it('should increment access count on retrieve', () => {
    const a = aid(), w = wid();
    const entry = l2.store(w, { data: 'tracked' }, MemoryType.FACT, a);

    l2.retrieve(entry.id);
    l2.retrieve(entry.id);
    l2.retrieve(entry.id);

    const retrieved = l2.retrieve(entry.id);
    expect(retrieved!.access_count).toBe(4); // 3 prior + this retrieve
  });

  it('should identify promotable entries based on access count and confidence', () => {
    const a = aid(), w = wid();
    const entry = l2.store(w, { important: true }, MemoryType.DECISION, a, { confidence: 0.9 });

    // Access enough times to meet promotion threshold
    for (let i = 0; i < DEFAULT_MEMORY_CONFIG.promotionThreshold; i++) {
      l2.retrieve(entry.id);
    }

    const promotable = l2.getPromotableEntries();
    expect(promotable.length).toBe(1);
    expect(promotable[0]!.id).toBe(entry.id);
  });

  it('should not identify entries as promotable below access threshold', () => {
    const a = aid(), w = wid();
    const entry = l2.store(w, { data: 'low-access' }, MemoryType.FACT, a, { confidence: 0.9 });

    // Access fewer times than threshold (retrieve already increments access_count by 1 per call)
    for (let i = 0; i < DEFAULT_MEMORY_CONFIG.promotionThreshold - 1; i++) {
      l2.retrieve(entry.id);
    }

    // access_count should be (promotionThreshold - 1), which is below the threshold
    expect(l2.getPromotableEntries().length).toBe(0);
  });

  it('should not identify low-confidence entries as promotable', () => {
    const a = aid(), w = wid();
    const entry = l2.store(w, { data: 'low-conf' }, MemoryType.FACT, a, { confidence: 0.3 });

    // Access enough times
    for (let i = 0; i < DEFAULT_MEMORY_CONFIG.promotionThreshold; i++) {
      l2.retrieve(entry.id);
    }

    // Low confidence should disqualify
    expect(l2.getPromotableEntries().length).toBe(0);
  });

  // ─── Search ────────────────────────────────────────────────────────────────

  it('should search with workspace scoping', () => {
    const a = aid(), w1 = wid(), w2 = wid();
    l2.store(w1, { topic: 'auth design' }, MemoryType.CONTEXT, a);
    l2.store(w2, { topic: 'auth testing' }, MemoryType.CONTEXT, a);

    const results = l2.search('auth', w1);
    expect(results.length).toBe(1);
    expect(results[0]!.entry.workspace_id).toBe(w1);
  });

  it('should search across all workspaces when no workspace specified', () => {
    const a = aid(), w1 = wid(), w2 = wid();
    l2.store(w1, { topic: 'shared topic' }, MemoryType.CONTEXT, a);
    l2.store(w2, { topic: 'shared topic' }, MemoryType.CONTEXT, a);

    const results = l2.search('shared');
    expect(results.length).toBe(2);
  });

  // ─── Stats ─────────────────────────────────────────────────────────────────

  it('should return stats with byWorkspace and byType breakdowns', () => {
    const a = aid(), w = wid();
    l2.store(w, { data: 1 }, MemoryType.FACT, a);
    l2.store(w, { data: 2 }, MemoryType.DECISION, a);

    const stats = l2.getStats();
    expect(stats.total).toBe(2);
    expect(stats.byWorkspace[w as string]).toBe(2);
    expect(stats.byType[MemoryType.FACT as string]).toBe(1);
    expect(stats.byType[MemoryType.DECISION as string]).toBe(1);
  });

  it('should report correct size', () => {
    const a = aid(), w = wid();
    expect(l2.size).toBe(0);

    l2.store(w, { data: 1 }, MemoryType.FACT, a);
    expect(l2.size).toBe(1);

    l2.store(w, { data: 2 }, MemoryType.FACT, a);
    expect(l2.size).toBe(2);
  });
});