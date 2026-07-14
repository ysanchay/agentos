import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryEventStore } from '@agentos/eventstore';
import { EventDomain } from '@agentos/types';
import { MemoryCache, type MemoryCacheConfig, type FlushResult } from '../src/memory-cache.js';
import { ModeController } from '../src/mode-controller.js';
import { ExecutionMode } from '../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

let idCounter = 0;

function nextId(prefix = 'evt'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function deterministicClock() {
  let n = 0;
  return {
    now: () => {
      n += 1;
      return `2026-06-12T00:00:${String(n).padStart(2, '0')}.000Z`;
    },
    idFactory: () => `evt-${nextId('e')}`,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('MemoryCache — get() and set() read cache', () => {
  let mc: ModeController;
  let cache: MemoryCache;

  beforeEach(() => {
    idCounter = 0;
    mc = new ModeController({ initialMode: ExecutionMode.ONLINE });
    cache = new MemoryCache({ modeController: mc });
  });

  it('get() returns cached value on a hit', () => {
    cache.set('key-1', { value: 42 });
    expect(cache.get('key-1')).toEqual({ value: 42 });
  });

  it('get() returns null on a miss and tracks the miss', () => {
    expect(cache.get('missing')).toBeNull();
    const stats = cache.getStats();
    // 1 miss, 0 hits → hitRate 0
    expect(stats.hitRate).toBe(0);
  });

  it('set() stores in the read cache', () => {
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
    expect(cache.getStats().readCacheEntries).toBe(1);
  });

  it('get() hit increments hitRate', () => {
    cache.set('k', 'v');
    cache.get('k'); // hit
    cache.get('x'); // miss
    expect(cache.getStats().hitRate).toBeCloseTo(0.5, 5);
  });
});

describe('MemoryCache — write buffering when OFFLINE', () => {
  let mc: ModeController;
  let cache: MemoryCache;

  beforeEach(() => {
    idCounter = 0;
    mc = new ModeController({ initialMode: ExecutionMode.OFFLINE });
    cache = new MemoryCache({ modeController: mc });
  });

  it('set() buffers the write when mode is OFFLINE', () => {
    cache.set('buffered-key', 'buffered-value', 'ws-1');
    expect(cache.isBuffered('buffered-key')).toBe(true);
    const writes = cache.getBufferedWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0]!.key).toBe('buffered-key');
    expect(writes[0]!.value).toBe('buffered-value');
    expect(writes[0]!.workspaceId).toBe('ws-1');
  });

  it('set() also populates the read cache when buffering', () => {
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
    expect(cache.isBuffered('k')).toBe(true);
  });

  it('isBuffered returns false when not buffered', () => {
    cache.set('k', 'v');
    expect(cache.isBuffered('not-buffered')).toBe(false);
  });

  it('getBufferedWrites returns all buffered writes', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3, 'ws-2');
    const writes = cache.getBufferedWrites();
    expect(writes).toHaveLength(3);
    expect(writes.map((w) => w.key)).toEqual(['a', 'b', 'c']);
    expect(writes[2]!.workspaceId).toBe('ws-2');
  });
});

describe('MemoryCache — no write buffering when ONLINE', () => {
  let mc: ModeController;
  let cache: MemoryCache;

  beforeEach(() => {
    idCounter = 0;
    mc = new ModeController({ initialMode: ExecutionMode.ONLINE });
    cache = new MemoryCache({ modeController: mc });
  });

  it('set() does NOT buffer the write when mode is ONLINE', () => {
    cache.set('k', 'v');
    expect(cache.isBuffered('k')).toBe(false);
    expect(cache.getBufferedWrites()).toHaveLength(0);
  });

  it('set() still populates the read cache when ONLINE', () => {
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
    expect(cache.getStats().readCacheEntries).toBe(1);
  });
});

describe('MemoryCache — flush() replays buffered writes', () => {
  let mc: ModeController;
  let cache: MemoryCache;

  beforeEach(() => {
    idCounter = 0;
    mc = new ModeController({ initialMode: ExecutionMode.OFFLINE });
    cache = new MemoryCache({ modeController: mc });
  });

  it('flush() replays all buffered writes through replayFn', async () => {
    cache.set('a', 1);
    cache.set('b', 2, 'ws-1');
    const replayed: Array<{ key: string; value: unknown; workspaceId?: string }> = [];
    const result = await cache.flush(async (key, value, workspaceId) => {
      replayed.push({ key, value, workspaceId });
    });
    expect(result.flushed).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(replayed).toHaveLength(2);
    expect(replayed[0]).toEqual({ key: 'a', value: 1, workspaceId: undefined });
    expect(replayed[1]).toEqual({ key: 'b', value: 2, workspaceId: 'ws-1' });
  });

  it('flush() clears the write buffer after successful replay', async () => {
    cache.set('a', 1);
    cache.set('b', 2);
    await cache.flush(async () => {});
    expect(cache.getBufferedWrites()).toHaveLength(0);
    expect(cache.isBuffered('a')).toBe(false);
  });

  it('flush() returns errors for failed replay and keeps failed entries buffered', async () => {
    cache.set('a', 1);
    cache.set('b', 2);
    const result = await cache.flush(async (key) => {
      if (key === 'b') throw new Error('replay failed');
    });
    expect(result.flushed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('b');
    // The failed entry ('b') should still be buffered for a later retry.
    expect(cache.isBuffered('b')).toBe(true);
    expect(cache.isBuffered('a')).toBe(false);
  });

  it('flush() on empty buffer returns flushed:0', async () => {
    const result = await cache.flush(async () => {});
    expect(result.flushed).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('flush() keeps the read cache intact (only clears write buffer)', async () => {
    cache.set('a', 1);
    await cache.flush(async () => {});
    expect(cache.get('a')).toBe(1);
    expect(cache.getStats().readCacheEntries).toBe(1);
  });
});

describe('MemoryCache — clear()', () => {
  let mc: ModeController;
  let cache: MemoryCache;

  beforeEach(() => {
    idCounter = 0;
    mc = new ModeController({ initialMode: ExecutionMode.OFFLINE });
    cache = new MemoryCache({ modeController: mc });
  });

  it('clears both the read cache and the write buffer', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.getStats().readCacheEntries).toBe(2);
    expect(cache.getStats().bufferedWrites).toBe(2);
    cache.clear();
    expect(cache.getStats().readCacheEntries).toBe(0);
    expect(cache.getStats().bufferedWrites).toBe(0);
    expect(cache.getBufferedWrites()).toHaveLength(0);
  });
});

describe('MemoryCache — getStats()', () => {
  let mc: ModeController;
  let cache: MemoryCache;

  beforeEach(() => {
    idCounter = 0;
    mc = new ModeController({ initialMode: ExecutionMode.OFFLINE });
    cache = new MemoryCache({ modeController: mc });
  });

  it('returns correct numbers after mixed operations', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a'); // hit
    cache.get('x'); // miss
    const stats = cache.getStats();
    expect(stats.readCacheEntries).toBe(2);
    expect(stats.bufferedWrites).toBe(2);
    expect(stats.hitRate).toBeCloseTo(0.5, 5);
  });

  it('returns zeros when empty', () => {
    const stats = cache.getStats();
    expect(stats.readCacheEntries).toBe(0);
    expect(stats.bufferedWrites).toBe(0);
    expect(stats.hitRate).toBe(0);
  });
});

describe('MemoryCache — event emission', () => {
  let store: InMemoryEventStore;
  let mc: ModeController;
  let cache: MemoryCache;

  beforeEach(() => {
    idCounter = 0;
    store = new InMemoryEventStore();
    const d = deterministicClock();
    mc = new ModeController({ initialMode: ExecutionMode.OFFLINE });
    cache = new MemoryCache({
      modeController: mc,
      eventStore: store,
      now: d.now,
      idFactory: d.idFactory,
    });
  });

  it('emits system.cache.memory.read on get() hit', async () => {
    cache.set('k', 'v');
    cache.get('k');
    // Fire-and-forget emit; wait a tick for the microtask to flush.
    await new Promise((r) => setTimeout(r, 0));
    const page = await store.query({ domain: EventDomain.SYSTEM, type: 'system.cache.memory.read' });
    const hits = page.items.filter((e) => (e.data as { hit: boolean }).hit === true);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]!.source).toBe('offline.memory-cache');
  });

  it('emits system.cache.memory.read on get() miss', async () => {
    cache.get('missing');
    await new Promise((r) => setTimeout(r, 0));
    const page = await store.query({ domain: EventDomain.SYSTEM, type: 'system.cache.memory.read' });
    const misses = page.items.filter((e) => (e.data as { hit: boolean }).hit === false);
    expect(misses.length).toBeGreaterThanOrEqual(1);
  });

  it('emits system.cache.memory.buffered when buffering a write (OFFLINE)', async () => {
    cache.set('k', 'v', 'ws-1');
    await new Promise((r) => setTimeout(r, 0));
    const page = await store.query({ domain: EventDomain.SYSTEM, type: 'system.cache.memory.buffered' });
    expect(page.items).toHaveLength(1);
    expect((page.items[0]!.data as { key: string }).key).toBe('k');
  });

  it('does NOT emit system.cache.memory.buffered when ONLINE', async () => {
    const onlineMc = new ModeController({ initialMode: ExecutionMode.ONLINE });
    const d = deterministicClock();
    const onlineCache = new MemoryCache({
      modeController: onlineMc,
      eventStore: store,
      now: d.now,
      idFactory: d.idFactory,
    });
    onlineCache.set('k', 'v');
    await new Promise((r) => setTimeout(r, 0));
    const page = await store.query({ domain: EventDomain.SYSTEM, type: 'system.cache.memory.buffered' });
    // Only the earlier OFFLINE-set (from beforeEach) could have emitted; but this
    // online set should not add another. Since beforeEach cache was never used
    // before this test, there should be zero buffered events.
    expect(page.items).toHaveLength(0);
  });

  it('emits system.cache.memory.flushed after flush()', async () => {
    cache.set('a', 1);
    cache.set('b', 2);
    await cache.flush(async () => {});
    const page = await store.query({ domain: EventDomain.SYSTEM, type: 'system.cache.memory.flushed' });
    expect(page.items).toHaveLength(1);
    const data = page.items[0]!.data as { flushed: number; errors: number };
    expect(data.flushed).toBe(2);
    expect(data.errors).toBe(0);
  });
});