/**
 * @agentos/offline — Artifact Cache (Batch 4)
 * Content-addressed (SHA-256) store for capability outputs and files.
 * Artifacts produced or fetched online remain available offline.
 *
 * ADR-008 Batch 4. Deterministic — no network I/O.
 */

import { createUUID, EventDomain, type Event, type EventID } from '@agentos/types';
import type { IEventStore } from '@agentos/eventstore';
import { createHash } from 'node:crypto';
import { OFF, type CachedArtifact } from './types.js';

export interface ArtifactCacheConfig {
  /** Maximum total bytes. Default 100 MB. */
  maxSizeBytes?: number;
  /** Maximum number of entries. Default 1000. */
  maxEntries?: number;
  eventStore?: IEventStore;
  now?: () => string;
  idFactory?: () => string;
  source?: string;
}

export interface StoreResult {
  hash: string;
  sizeBytes: number;
  /** True if this was a new entry; false if it already existed (dedup). */
  stored: boolean;
  /** Number of entries evicted to make room. */
  evicted: number;
}

export class ArtifactCache {
  private readonly storage = new Map<string, CachedArtifact>();
  private readonly accessOrder = new Map<string, number>(); // hash -> monotonic counter
  private readonly maxSizeBytes: number;
  private readonly maxEntries: number;
  private readonly eventStore?: IEventStore;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly source: string;
  private totalSizeBytes = 0;
  private accessCounter = 0;
  private hits = 0;
  private misses = 0;

  constructor(config: ArtifactCacheConfig = {}) {
    this.maxSizeBytes = config.maxSizeBytes ?? 100 * 1024 * 1024;
    this.maxEntries = config.maxEntries ?? 1000;
    this.eventStore = config.eventStore;
    this.now = config.now ?? (() => new Date().toISOString());
    this.idFactory = config.idFactory ?? (() => createUUID());
    this.source = config.source ?? 'offline.artifact-cache';
  }

  /**
   * Store content under its SHA-256 hash. Deduplicates if the same content
   * is stored twice. Evicts LRU entries if over size/entry limits.
   */
  async store(content: Uint8Array, contentType: string = 'application/octet-stream'): Promise<StoreResult> {
    const hash = this.computeHash(content);
    const sizeBytes = content.byteLength;

    // Already cached?
    if (this.storage.has(hash)) {
      this.touch(hash);
      this.hits++;
      return { hash, sizeBytes, stored: false, evicted: 0 };
    }

    // Make room if needed
    let evicted = 0;
    while (
      (this.totalSizeBytes + sizeBytes > this.maxSizeBytes || this.storage.size >= this.maxEntries) &&
      this.storage.size > 0
    ) {
      const evictHash = this.findLRU();
      if (!evictHash) break;
      const artifact = this.storage.get(evictHash);
      if (artifact) {
        this.totalSizeBytes -= artifact.sizeBytes;
        this.storage.delete(evictHash);
        this.accessOrder.delete(evictHash);
        await this.emitEvent('system.cache.artifact.evicted', { hash: evictHash, sizeBytes: artifact.sizeBytes, reason: 'lru' });
        evicted++;
      }
    }

    // Store
    const artifact: CachedArtifact = {
      sha256: hash,
      contentType,
      sizeBytes,
      data: content,
      cachedAt: this.now(),
    };
    this.storage.set(hash, artifact);
    this.accessOrder.set(hash, ++this.accessCounter);
    this.totalSizeBytes += sizeBytes;

    await this.emitEvent('system.cache.artifact.stored', { hash, sizeBytes, contentType });
    return { hash, sizeBytes, stored: true, evicted };
  }

  /** Retrieve an artifact by hash. Returns null if not found. Updates access order. */
  retrieve(hash: string): CachedArtifact | null {
    const artifact = this.storage.get(hash) ?? null;
    if (artifact) {
      this.touch(hash);
      this.hits++;
    } else {
      this.misses++;
    }
    return artifact;
  }

  /** Check if an artifact exists without updating access order. */
  exists(hash: string): boolean {
    return this.storage.has(hash);
  }

  /** Re-compute SHA-256 of stored data and compare to the key. Returns false on mismatch (OFF-0005). */
  verifyChecksum(hash: string): boolean {
    const artifact = this.storage.get(hash);
    if (!artifact) return false;
    const recomputed = this.computeHash(artifact.data);
    return recomputed === hash;
  }

  /** Evict least-recently-used artifacts until under both size and entry limits. Returns count evicted. */
  async evictLRU(): Promise<number> {
    let evicted = 0;
    while (
      (this.totalSizeBytes > this.maxSizeBytes || this.storage.size > this.maxEntries) &&
      this.storage.size > 0
    ) {
      const evictHash = this.findLRU();
      if (!evictHash) break;
      const artifact = this.storage.get(evictHash);
      if (artifact) {
        this.totalSizeBytes -= artifact.sizeBytes;
        this.storage.delete(evictHash);
        this.accessOrder.delete(evictHash);
        await this.emitEvent('system.cache.artifact.evicted', { hash: evictHash, sizeBytes: artifact.sizeBytes, reason: 'lru' });
        evicted++;
      }
    }
    return evicted;
  }

  /** Remove all artifacts. Returns count removed. */
  async clear(): Promise<number> {
    const count = this.storage.size;
    for (const [hash, artifact] of Array.from(this.storage.entries())) {
      await this.emitEvent('system.cache.artifact.evicted', { hash, sizeBytes: artifact.sizeBytes, reason: 'cleared' });
    }
    this.storage.clear();
    this.accessOrder.clear();
    this.totalSizeBytes = 0;
    return count;
  }

  getStats(): {
    entries: number;
    totalSizeBytes: number;
    maxSizeBytes: number;
    maxEntries: number;
    hitRate: number;
  } {
    const total = this.hits + this.misses;
    return {
      entries: this.storage.size,
      totalSizeBytes: this.totalSizeBytes,
      maxSizeBytes: this.maxSizeBytes,
      maxEntries: this.maxEntries,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  // ─── Private ──────────────────────────────────────────────────────

  private computeHash(data: Uint8Array): string {
    return createHash('sha256').update(data).digest('hex');
  }

  private touch(hash: string): void {
    this.accessOrder.set(hash, ++this.accessCounter);
  }

  private findLRU(): string | null {
    let minAccess = Infinity;
    let lruHash: string | null = null;
    for (const [hash, access] of Array.from(this.accessOrder.entries())) {
      if (access < minAccess) {
        minAccess = access;
        lruHash = hash;
      }
    }
    return lruHash;
  }

  private async emitEvent(type: string, data: object): Promise<void> {
    if (!this.eventStore) return;
    const event: Event = {
      id: this.idFactory() as EventID,
      domain: EventDomain.SYSTEM,
      type,
      source: this.source,
      data,
      timestamp: this.now(),
    };
    await this.eventStore.append(event);
  }
}