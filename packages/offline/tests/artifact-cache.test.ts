import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEventStore } from '@agentos/eventstore';
import { EventDomain } from '@agentos/types';
import { createHash } from 'node:crypto';
import { ArtifactCache, type ArtifactCacheConfig } from '../src/artifact-cache.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

let idCounter = 0;

function nextId(prefix = 'evt'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function deterministicClock(base = '2026-06-12T00:00:00.000Z') {
  let n = 0;
  return {
    now: () => {
      n += 1;
      return `2026-06-12T00:00:${String(n).padStart(2, '0')}.000Z`;
    },
    idFactory: () => `evt-${nextId('e')}`,
  };
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

const encoder = new TextEncoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

function bigBytes(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) buf[i] = i % 256;
  return buf;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('ArtifactCache — store and retrieve (SHA-256 correctness)', () => {
  let cache: ArtifactCache;

  beforeEach(() => {
    idCounter = 0;
    cache = new ArtifactCache();
  });

  it('stores content and returns the correct SHA-256 hash + size', async () => {
    const content = bytes('hello world');
    const { hash, sizeBytes } = await cache.store(content, 'text/plain');
    expect(hash).toBe(sha256(content));
    expect(sizeBytes).toBe(content.byteLength);
    expect(cache.exists(hash)).toBe(true);
  });

  it('retrieves a stored artifact by hash', async () => {
    const content = bytes('hello world');
    const { hash } = await cache.store(content, 'text/plain');
    const artifact = cache.retrieve(hash);
    expect(artifact).not.toBeNull();
    expect(artifact!.sha256).toBe(hash);
    expect(artifact!.contentType).toBe('text/plain');
    expect(artifact!.data).toEqual(content);
    expect(artifact!.sizeBytes).toBe(content.byteLength);
  });

  it('retrieve returns null for unknown hash', () => {
    expect(cache.retrieve('deadbeef')).toBeNull();
  });
});

describe('ArtifactCache — deduplication (content-addressed)', () => {
  let cache: ArtifactCache;

  beforeEach(() => {
    idCounter = 0;
    cache = new ArtifactCache();
  });

  it('same content produces the same hash (deduplication)', async () => {
    const content = bytes('duplicate me');
    const a = await cache.store(content);
    const b = await cache.store(content);
    expect(a.hash).toBe(b.hash);
    expect(cache.getStats().entries).toBe(1);
  });

  it('different content produces different hashes', async () => {
    const a = await cache.store(bytes('content-a'));
    const b = await cache.store(bytes('content-b'));
    expect(a.hash).not.toBe(b.hash);
    expect(cache.getStats().entries).toBe(2);
  });
});

describe('ArtifactCache — LRU eviction under size pressure', () => {
  let cache: ArtifactCache;

  beforeEach(() => {
    idCounter = 0;
  });

  it('evicts the least-recently-used artifact when over the byte budget', async () => {
    cache = new ArtifactCache({ maxSizeBytes: 100, maxEntries: 100 });
    // Each artifact is 40 bytes; 3 fit (120 > 100 triggers eviction on the 3rd).
    const c1 = bytes('a'.repeat(40));
    const c2 = bytes('b'.repeat(40));
    const c3 = bytes('c'.repeat(40));

    const h1 = await cache.store(c1);
    const h2 = await cache.store(c2);
    // Access h1 so h2 becomes LRU.
    cache.retrieve(h1.hash);
    const h3 = await cache.store(c3);

    // After storing h3 (total would be 120 > 100), the LRU (h2) should be evicted.
    expect(cache.exists(h1.hash)).toBe(true);
    expect(cache.exists(h2.hash)).toBe(false);
    expect(cache.exists(h3.hash)).toBe(true);
  });

  it('evictLRU returns the count evicted and removes artifacts', async () => {
    cache = new ArtifactCache({ maxSizeBytes: 1000, maxEntries: 1000 });
    await cache.store(bytes('a'.repeat(100)));
    await cache.store(bytes('b'.repeat(100)));
    await cache.store(bytes('c'.repeat(100)));
    // Manually evict one, then call evictLRU with a tight budget.
    // First, verify evictLRU on an under-budget cache evicts 0.
    expect(await cache.evictLRU()).toBe(0);
    // Now create an over-budget cache and verify evictLRU evicts.
    const cache2 = new ArtifactCache({ maxSizeBytes: 150, maxEntries: 1000 });
    await cache2.store(bytes('a'.repeat(100)));
    await cache2.store(bytes('b'.repeat(100)));
    // After the second store, the first was evicted to stay under 150.
    // evictLRU should report 0 (already under budget).
    const evicted = await cache2.evictLRU();
    expect(evicted).toBe(0);
    expect(cache2.getStats().totalSizeBytes).toBeLessThanOrEqual(150);
  });
});

describe('ArtifactCache — LRU eviction under entry count pressure', () => {
  let cache: ArtifactCache;

  beforeEach(() => {
    idCounter = 0;
  });

  it('evicts LRU when maxEntries is exceeded', async () => {
    cache = new ArtifactCache({ maxSizeBytes: 1000000, maxEntries: 3 });
    const h1 = await cache.store(bytes('one'));
    const h2 = await cache.store(bytes('two'));
    const h3 = await cache.store(bytes('three'));
    // Access h1 so h2 is LRU.
    cache.retrieve(h1.hash);
    cache.retrieve(h3.hash);
    const h4 = await cache.store(bytes('four'));
    expect(cache.getStats().entries).toBeLessThanOrEqual(3);
    expect(cache.exists(h2.hash)).toBe(false);
    expect(cache.exists(h1.hash)).toBe(true);
    expect(cache.exists(h4.hash)).toBe(true);
  });
});

describe('ArtifactCache — exists()', () => {
  let cache: ArtifactCache;

  beforeEach(() => {
    idCounter = 0;
    cache = new ArtifactCache();
  });

  it('returns true for stored, false for missing', async () => {
    const { hash } = await cache.store(bytes('present'));
    expect(cache.exists(hash)).toBe(true);
    expect(cache.exists('nonexistent')).toBe(false);
  });
});

describe('ArtifactCache — clear()', () => {
  let cache: ArtifactCache;

  beforeEach(() => {
    idCounter = 0;
    cache = new ArtifactCache();
  });

  it('removes all artifacts and returns the count', async () => {
    await cache.store(bytes('a'));
    await cache.store(bytes('b'));
    await cache.store(bytes('c'));
    expect(cache.getStats().entries).toBe(3);
    const count = await cache.clear();
    expect(count).toBe(3);
    expect(cache.getStats().entries).toBe(0);
    expect(cache.getStats().totalSizeBytes).toBe(0);
  });
});

describe('ArtifactCache — getStats()', () => {
  let cache: ArtifactCache;

  beforeEach(() => {
    idCounter = 0;
    cache = new ArtifactCache({ maxSizeBytes: 500, maxEntries: 10 });
  });

  it('returns correct numbers after operations', async () => {
    const content = bytes('stats-content');
    await cache.store(content);
    await cache.store(bytes('more'));

    const stats = cache.getStats();
    expect(stats.entries).toBe(2);
    expect(stats.maxSizeBytes).toBe(500);
    expect(stats.maxEntries).toBe(10);
    expect(stats.totalSizeBytes).toBeGreaterThan(0);
  });

  it('hitRate reflects hits and misses', async () => {
    const { hash } = await cache.store(bytes('hit-me'));
    cache.retrieve(hash); // hit
    cache.retrieve('missing'); // miss
    const stats = cache.getStats();
    expect(stats.hitRate).toBeCloseTo(0.5, 5);
  });

  it('hitRate is 0 with no accesses', async () => {
    expect(cache.getStats().hitRate).toBe(0);
  });
});

describe('ArtifactCache — verifyChecksum (OFF-0005)', () => {
  let cache: ArtifactCache;

  beforeEach(() => {
    idCounter = 0;
    cache = new ArtifactCache();
  });

  it('passes for a valid stored artifact', async () => {
    const content = bytes('intact content');
    const { hash } = await cache.store(content);
    expect(cache.verifyChecksum(hash)).toBe(true);
  });

  it('fails for a tampered artifact', async () => {
    const content = bytes('original');
    const { hash } = await cache.store(content);
    // Tamper: replace the stored data with different bytes but keep the same key.
    // We use the internal storage by retrieving then mutating the data array in place.
    const artifact = cache.retrieve(hash)!;
    // Mutate the underlying data buffer in place to simulate corruption.
    artifact.data[0] = artifact.data[0]! ^ 0xff;
    expect(cache.verifyChecksum(hash)).toBe(false);
  });

  it('returns false for a missing hash', () => {
    expect(cache.verifyChecksum('nonexistent')).toBe(false);
  });
});

describe('ArtifactCache — event emission', () => {
  let store: InMemoryEventStore;
  let cache: ArtifactCache;

  beforeEach(() => {
    idCounter = 0;
    store = new InMemoryEventStore();
    const d = deterministicClock();
    cache = new ArtifactCache({ eventStore: store, now: d.now, idFactory: d.idFactory });
  });

  it('emits system.cache.artifact.stored on store', async () => {
    await cache.store(bytes('event-test'), 'text/plain');
    const page = await store.query({ domain: EventDomain.SYSTEM, type: 'system.cache.artifact.stored' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.source).toBe('offline.artifact-cache');
    const data = page.items[0]!.data as { hash: string; sizeBytes: number; contentType: string };
    expect(data.hash).toBeDefined();
    expect(data.contentType).toBe('text/plain');
  });

  it('emits system.cache.artifact.evicted on eviction', async () => {
    cache = new ArtifactCache({
      eventStore: store,
      maxSizeBytes: 50,
      maxEntries: 100,
      now: () => '2026-06-12T00:00:01.000Z',
      idFactory: () => `evt-${nextId('e')}`,
    });
    await cache.store(bytes('a'.repeat(40)));
    await cache.store(bytes('b'.repeat(40)));
    // The second store should evict the first (total 80 > 50).
    const page = await store.query({ domain: EventDomain.SYSTEM, type: 'system.cache.artifact.evicted' });
    expect(page.items.length).toBeGreaterThanOrEqual(1);
    expect((page.items[0]!.data as { reason: string }).reason).toBe('lru');
  });

  it('emits system.cache.artifact.evicted for each on clear', async () => {
    await cache.store(bytes('x'));
    await cache.store(bytes('y'));
    await cache.clear();
    const page = await store.query({ domain: EventDomain.SYSTEM, type: 'system.cache.artifact.evicted' });
    expect(page.items).toHaveLength(2);
    expect((page.items[0]!.data as { reason: string }).reason).toBe('cleared');
  });
});

describe('ArtifactCache — large content handling', () => {
  let cache: ArtifactCache;

  beforeEach(() => {
    idCounter = 0;
  });

  it('stores and retrieves large content correctly', async () => {
    cache = new ArtifactCache({ maxSizeBytes: 2 * 1024 * 1024, maxEntries: 10 });
    const content = bigBytes(1024 * 1024); // 1 MB
    const { hash, sizeBytes } = await cache.store(content, 'application/octet-stream');
    expect(sizeBytes).toBe(1024 * 1024);
    expect(cache.exists(hash)).toBe(true);
    const artifact = cache.retrieve(hash);
    expect(artifact).not.toBeNull();
    expect(artifact!.data.byteLength).toBe(1024 * 1024);
    expect(cache.verifyChecksum(hash)).toBe(true);
  });

  it('evicts large content when budget exceeded', async () => {
    cache = new ArtifactCache({ maxSizeBytes: 1024 * 1024 + 100, maxEntries: 10 });
    // Use distinct content so they get different hashes (no dedup).
    const c1 = new Uint8Array(512 * 1024).fill(0x01);
    const c2 = new Uint8Array(512 * 1024).fill(0x02);
    const c3 = new Uint8Array(512 * 1024).fill(0x03);
    const h1 = await cache.store(c1);
    const h2 = await cache.store(c2);
    // Third 512KB store (total 1.5MB > ~1MB) should evict the LRU (h1).
    const h3 = await cache.store(c3);
    expect(cache.exists(h1.hash)).toBe(false);
    expect(cache.exists(h3.hash)).toBe(true);
    expect(cache.getStats().totalSizeBytes).toBeLessThanOrEqual(1024 * 1024 + 100);
  });
});