/**
 * @agentos/offline — Memory Cache (Batch 4)
 * Offline-durable mirror of L1/L2 reads (read-through) and a write-buffer
 * for memory writes issued offline, replayed through memory.store semantics
 * on reconnect.
 *
 * ADR-008 Batch 4. Deterministic — no network I/O.
 */

import { createUUID, EventDomain, type Event, type EventID } from '@agentos/types';
import type { IEventStore } from '@agentos/eventstore';
import { ModeController } from './mode-controller.js';
import { ExecutionMode } from './types.js';

export interface MemoryCacheConfig {
  modeController: ModeController;
  eventStore?: IEventStore;
  now?: () => string;
  idFactory?: () => string;
  source?: string;
}

export interface BufferedWrite {
  key: string;
  value: unknown;
  bufferedAt: string;
  workspaceId?: string;
}

export interface FlushResult {
  flushed: number;
  errors: string[];
}

export class MemoryCache {
  private readonly readCache = new Map<string, unknown>();
  private readonly writeBuffer = new Map<string, BufferedWrite>();
  private readonly modeController: ModeController;
  private readonly eventStore?: IEventStore;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly source: string;
  private hits = 0;
  private misses = 0;

  constructor(config: MemoryCacheConfig) {
    this.modeController = config.modeController;
    this.eventStore = config.eventStore;
    this.now = config.now ?? (() => new Date().toISOString());
    this.idFactory = config.idFactory ?? (() => createUUID());
    this.source = config.source ?? 'offline.memory-cache';
  }

  /**
   * Read-through cache. Returns cached value or null (caller should then
   * try L1/L2 and call set() to populate the cache).
   */
  get(key: string): unknown | null {
    if (this.readCache.has(key)) {
      this.hits++;
      void this.emitEvent('system.cache.memory.read', { key, hit: true });
      return this.readCache.get(key) ?? null;
    }
    this.misses++;
    void this.emitEvent('system.cache.memory.read', { key, hit: false });
    return null;
  }

  /**
   * Store a value in the read cache. If the mode is OFFLINE, also buffer
   * the write for replay through memory.store on reconnect.
   */
  set(key: string, value: unknown, workspaceId?: string): void {
    this.readCache.set(key, value);

    const mode = this.modeController.getMode();
    if (mode === ExecutionMode.OFFLINE) {
      const write: BufferedWrite = {
        key,
        value,
        bufferedAt: this.now(),
        workspaceId,
      };
      this.writeBuffer.set(key, write);
      this.emitEvent('system.cache.memory.buffered', { key, workspaceId });
    }
  }

  /** Check if a key is in the write buffer (pending replay). */
  isBuffered(key: string): boolean {
    return this.writeBuffer.has(key);
  }

  /** Return all buffered writes for replay. */
  getBufferedWrites(): BufferedWrite[] {
    return Array.from(this.writeBuffer.values());
  }

  /**
   * Replay all buffered writes through the provided replay function.
   * Clears the write buffer on success. Returns count + any errors.
   */
  async flush(
    replayFn: (key: string, value: unknown, workspaceId?: string) => Promise<void>,
  ): Promise<FlushResult> {
    const writes = Array.from(this.writeBuffer.values());
    let flushed = 0;
    const errors: string[] = [];

    for (const write of writes) {
      try {
        await replayFn(write.key, write.value, write.workspaceId);
        this.writeBuffer.delete(write.key);
        flushed++;
      } catch (e) {
        errors.push(`${write.key}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await this.emitEvent('system.cache.memory.flushed', { flushed, errors: errors.length });
    return { flushed, errors };
  }

  /** Clear both read cache and write buffer. */
  clear(): void {
    this.readCache.clear();
    this.writeBuffer.clear();
  }

  getStats(): { readCacheEntries: number; bufferedWrites: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      readCacheEntries: this.readCache.size,
      bufferedWrites: this.writeBuffer.size,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }

  // ─── Private ──────────────────────────────────────────────────────

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