/**
 * @agentos/memory — L3 Long-Term Memory Tests
 * Persistence, search with combined filters, deletion with index cleanup,
 * tag-based search, and stats correctness.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createUUID, MemoryTier, MemoryType } from '@agentos/types';
import type { AgentID, WorkspaceID } from '@agentos/types';
import { L3LongTermMemory } from '../src/l3-long-term-memory.js';
import { DEFAULT_MEMORY_CONFIG } from '../src/types.js';

let currentTime = 1_000_000;
const mockNow = () => currentTime;

function aid(): AgentID { return createUUID() as unknown as AgentID; }
function wid(): WorkspaceID { return createUUID() as unknown as WorkspaceID; }

describe('L3LongTermMemory', () => {
  let l3: L3LongTermMemory;

  beforeEach(() => {
    currentTime = 1_000_000;
    l3 = new L3LongTermMemory(DEFAULT_MEMORY_CONFIG, mockNow);
  });

  // ─── Persistence ───────────────────────────────────────────────────────────

  it('should never expire L3 entries', () => {
    const a = aid(), w = wid();
    const entry = l3.store({ data: 'permanent' }, MemoryType.FACT, a, w);
    expect(entry.expires_at).toBeUndefined();

    // Advance by 24 hours
    currentTime = 1_000_000 + 86_400_000;
    expect(l3.retrieve(entry.id)).not.toBeNull();
  });

  it('should survive long time periods', () => {
    const a = aid(), w = wid();
    const entry = l3.store({ pattern: 'retry' }, MemoryType.FACT, a, w);

    // Advance by 30 days
    currentTime = 1_000_000 + 30 * 86_400_000;
    expect(l3.retrieve(entry.id)).not.toBeNull();
    expect(l3.retrieve(entry.id)!.content).toEqual({ pattern: 'retry' });
  });

  // ─── Deletion + Index Cleanup ───────────────────────────────────────────────

  it('should delete entries and return true', () => {
    const a = aid(), w = wid();
    const entry = l3.store({ data: 'deletable' }, MemoryType.FACT, a, w);

    expect(l3.delete(entry.id)).toBe(true);
    expect(l3.retrieve(entry.id)).toBeNull();
  });

  it('should return false when deleting nonexistent entry', () => {
    expect(l3.delete('nonexistent-id' as any)).toBe(false);
  });

  it('should clean up type index on deletion', () => {
    const a = aid(), w = wid();
    const entry = l3.store({ data: 1 }, MemoryType.FACT, a, w);

    l3.delete(entry.id);

    const stats = l3.getStats();
    expect(stats.byType[MemoryType.FACT as string] ?? 0).toBe(0);
  });

  it('should clean up agent index on deletion', () => {
    const a = aid(), w = wid();
    const entry = l3.store({ data: 1 }, MemoryType.FACT, a, w);

    l3.delete(entry.id);
    expect(l3.getByAgent(a).length).toBe(0);
  });

  it('should clean up workspace index on deletion', () => {
    const a = aid(), w = wid();
    const entry = l3.store({ data: 1 }, MemoryType.FACT, a, w);

    l3.delete(entry.id);

    const stats = l3.getStats();
    expect(stats.byWorkspace[w as string] ?? 0).toBe(0);
  });

  it('should clean up type index when all entries of a type are deleted', () => {
    const a = aid(), w = wid();
    const e1 = l3.store({ data: 1 }, MemoryType.FACT, a, w);
    const e2 = l3.store({ data: 2 }, MemoryType.FACT, a, w);

    l3.delete(e1.id);
    l3.delete(e2.id);

    // Type index should be fully removed
    expect(l3.getByType(MemoryType.FACT).length).toBe(0);
  });

  // ─── Search ────────────────────────────────────────────────────────────────

  it('should search by text with keyword matching in content', () => {
    const a = aid(), w = wid();
    l3.store({ topic: 'error handling patterns' }, MemoryType.FACT, a, w);
    l3.store({ topic: 'database optimization' }, MemoryType.FACT, a, w);
    l3.store({ topic: 'caching strategies' }, MemoryType.FACT, a, w);

    const results = l3.search({ text: 'error' });
    expect(results.length).toBe(1);
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('should search by text matching in summary', () => {
    const a = aid(), w = wid();
    l3.store({ data: 'x' }, MemoryType.DECISION, a, w, { summary: 'Retry on transient network error' });

    const results = l3.search({ text: 'transient' });
    expect(results.length).toBe(1);
    expect(results[0]!.score).toBe(1.0); // Summary match scores 1.0
  });

  it('should search with combined type and workspace filters', () => {
    const a = aid(), w1 = wid(), w2 = wid();
    l3.store({ data: 'fact-w1' }, MemoryType.FACT, a, w1);
    l3.store({ data: 'dec-w1' }, MemoryType.DECISION, a, w1);
    l3.store({ data: 'fact-w2' }, MemoryType.FACT, a, w2);

    const results = l3.search({ type: MemoryType.FACT, workspaceId: w1 });
    expect(results.length).toBe(1);
    expect(results[0]!.entry.workspace_id).toBe(w1);
  });

  it('should search with agent filter', () => {
    const a1 = aid(), a2 = aid(), w = wid();
    l3.store({ agent: 'a1' }, MemoryType.FACT, a1, w);
    l3.store({ agent: 'a2' }, MemoryType.FACT, a2, w);

    const results = l3.search({ agentId: a1 });
    expect(results.length).toBe(1);
  });

  it('should search with minimum confidence filter', () => {
    const a = aid(), w = wid();
    l3.store({ data: 'low' }, MemoryType.FACT, a, w, { confidence: 0.3 });
    l3.store({ data: 'high' }, MemoryType.FACT, a, w, { confidence: 0.95 });

    expect(l3.search({ minConfidence: 0.8 }).length).toBe(1);
    expect(l3.search({ minConfidence: 0.2 }).length).toBe(2);
  });

  it('should search with tag filter (any tag matches)', () => {
    const a = aid(), w = wid();
    l3.store({ data: 1 }, MemoryType.FACT, a, w, { tags: ['archived', 'important'] });
    l3.store({ data: 2 }, MemoryType.FACT, a, w, { tags: ['draft'] });
    l3.store({ data: 3 }, MemoryType.FACT, a, w, { tags: ['important', 'review'] });

    expect(l3.search({ tags: ['important'] }).length).toBe(2);
    expect(l3.search({ tags: ['draft'] }).length).toBe(1);
    expect(l3.search({ tags: ['nonexistent'] }).length).toBe(0);
  });

  it('should search with all filters combined', () => {
    const a1 = aid(), a2 = aid(), w1 = wid(), w2 = wid();
    l3.store({ data: 'match' }, MemoryType.FACT, a1, w1, { confidence: 0.9, tags: ['important'] });
    l3.store({ data: 'no-match-type' }, MemoryType.DECISION, a1, w1, { confidence: 0.9, tags: ['important'] });
    l3.store({ data: 'no-match-conf' }, MemoryType.FACT, a1, w1, { confidence: 0.3, tags: ['important'] });
    l3.store({ data: 'no-match-ws' }, MemoryType.FACT, a1, w2, { confidence: 0.9, tags: ['important'] });
    l3.store({ data: 'no-match-agent' }, MemoryType.FACT, a2, w1, { confidence: 0.9, tags: ['important'] });

    const results = l3.search({
      type: MemoryType.FACT,
      workspaceId: w1,
      agentId: a1,
      minConfidence: 0.8,
      tags: ['important'],
    });

    expect(results.length).toBe(1);
    expect(results[0]!.entry.content).toEqual({ data: 'match' });
  });

  it('should return all entries when no filters specified', () => {
    const a = aid(), w = wid();
    l3.store({ data: 1 }, MemoryType.FACT, a, w);
    l3.store({ data: 2 }, MemoryType.DECISION, a, w);

    const results = l3.search({});
    expect(results.length).toBe(2);
  });

  it('should respect search limit', () => {
    const a = aid(), w = wid();
    for (let i = 0; i < 10; i++) {
      l3.store({ index: i }, MemoryType.FACT, a, w);
    }

    const results = l3.search({ limit: 3 });
    expect(results.length).toBe(3);
  });

  it('should sort results by score (summary match > content match)', () => {
    const a = aid(), w = wid();
    l3.store({ topic: 'auth' }, MemoryType.FACT, a, w); // content match (0.7)
    l3.store({ data: 'x' }, MemoryType.FACT, a, w, { summary: 'Auth system design' }); // summary match (1.0)

    const results = l3.search({ text: 'auth' });
    expect(results[0]!.score).toBe(1.0);
    expect(results[1]!.score).toBe(0.7);
  });

  // ─── Stats ─────────────────────────────────────────────────────────────────

  it('should return correct stats with breakdowns', () => {
    const a1 = aid(), a2 = aid(), w1 = wid(), w2 = wid();
    l3.store({ data: 1 }, MemoryType.FACT, a1, w1);
    l3.store({ data: 2 }, MemoryType.FACT, a1, w2);
    l3.store({ data: 3 }, MemoryType.DECISION, a2, w1);

    const stats = l3.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byType[MemoryType.FACT as string]).toBe(2);
    expect(stats.byType[MemoryType.DECISION as string]).toBe(1);
    expect(stats.byAgent[a1 as string]).toBe(2);
    expect(stats.byAgent[a2 as string]).toBe(1);
    expect(stats.byWorkspace[w1 as string]).toBe(2);
    expect(stats.byWorkspace[w2 as string]).toBe(1);
  });

  it('should report correct size', () => {
    const a = aid(), w = wid();
    expect(l3.size).toBe(0);

    l3.store({ data: 1 }, MemoryType.FACT, a, w);
    expect(l3.size).toBe(1);
  });

  // ─── Access Tracking ───────────────────────────────────────────────────────

  it('should increment access count on retrieve', () => {
    const a = aid(), w = wid();
    const entry = l3.store({ data: 'tracked' }, MemoryType.FACT, a, w);

    l3.retrieve(entry.id);
    l3.retrieve(entry.id);

    const retrieved = l3.retrieve(entry.id);
    expect(retrieved!.access_count).toBe(3);
  });

  it('should update last_accessed_at on retrieve', () => {
    const a = aid(), w = wid();
    const entry = l3.store({ data: 'time' }, MemoryType.FACT, a, w);

    currentTime = 2_000_000;
    const retrieved = l3.retrieve(entry.id);
    expect(retrieved!.last_accessed_at).toBe('2000000');
  });
});