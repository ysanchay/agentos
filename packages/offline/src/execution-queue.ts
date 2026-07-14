/**
 * @agentos/offline — Execution Queue
 * The durable, ordered, bounded queue that holds operations deferred while OFFLINE
 * (ADR-008 Batch 3). Every operation carries an idempotency key for exactly-once replay
 * (kernel invariant #10), and every enqueue/dequeue/drop is audited as a SYSTEM event
 * (invariant IQ-4 / kernel-api-v1 §3.9 event-before-side-effects).
 *
 * Ordering contract:
 *   - Priority ascending: 0 = SYSTEM (highest), 5 = IDLE (lowest).
 *   - Within the same priority, FIFO by insertion order.
 *
 * Backpressure: when the queue is at capacity, enqueue attempts to evict the oldest
 * non-critical operation (priority >= 3). If none exists, enqueue fails with OFF-0002.
 *
 * ZERO AI logic — this is a deterministic coordinator.
 */

import { EventDomain, createUUID, type Event, type EventID } from '@agentos/types';
import type { IEventStore } from '@agentos/eventstore';
import { OFF, type QueuedOperation, type QueuedOpKind } from './types.js';

export interface ExecutionQueueConfig {
  /** Bounded capacity. Default 10,000 (ADR-008 IQ-3). */
  maxSize?: number;
  /** When present, every queue mutation is appended as a SYSTEM event (IQ-4). */
  eventStore?: IEventStore;
  /** Injectable clock for deterministic timestamps in tests. */
  now?: () => string;
  /** Injectable id factory for deterministic event ids in tests. */
  idFactory?: () => string;
  /** Identifier recorded as the event `source`. Defaults to 'offline.execution-queue'. */
  source?: string;
}

export interface EnqueueResult {
  ok: boolean;
  errorCode?: string;
}

export class ExecutionQueue {
  private readonly maxSize: number;
  private readonly eventStore?: IEventStore;
  private readonly now: () => string;
  private readonly idFactory: () => string;
  private readonly source: string;

  /** Operation id → QueuedOperation. */
  private readonly storage: Map<string, QueuedOperation> = new Map();
  /** Idempotency key → operation id (dedup index, IQ-1). */
  private readonly idempotencyIndex: Map<string, string> = new Map();
  /** Operation id → monotonically increasing insertion sequence (FIFO tiebreak). */
  private readonly insertionOrder: Map<string, number> = new Map();
  private insertCounter: number = 0;

  constructor(config: ExecutionQueueConfig = {}) {
    this.maxSize = config.maxSize ?? 10_000;
    this.eventStore = config.eventStore;
    this.now = config.now ?? (() => new Date().toISOString());
    this.idFactory = config.idFactory ?? (() => createUUID());
    this.source = config.source ?? 'offline.execution-queue';
  }

  // ─── Public API ───────────────────────────────────────────────────────

  /**
   * Enqueue an operation. If an operation with the same idempotency key already
   * exists, this is an idempotent no-op (IQ-1 / kernel invariant #10) and returns
   * ok:true without re-enqueueing.
   *
   * Backpressure: when the queue is full, attempts to evict the oldest non-critical
   * operation (priority >= 3). If none can be evicted, returns ok:false with OFF-0002.
   */
  async enqueue(op: QueuedOperation): Promise<EnqueueResult> {
    // IQ-1: idempotency key uniqueness — duplicate key = silent no-op.
    if (this.idempotencyIndex.has(op.idempotencyKey)) {
      return { ok: true };
    }

    // IQ-3/IQ-5: backpressure — bounded size.
    if (this.storage.size >= this.maxSize) {
      const evicted = await this.evictOldestNonCritical();
      if (!evicted) {
        return { ok: false, errorCode: OFF.QUEUE_FULL };
      }
    }

    this.storage.set(op.id, op);
    this.idempotencyIndex.set(op.idempotencyKey, op.id);
    this.insertionOrder.set(op.id, this.insertCounter++);

    await this.emitEvent('system.queue.enqueued', { operationId: op.id, kind: op.kind, idempotencyKey: op.idempotencyKey, priority: op.priority }, op.correlationId);

    return { ok: true };
  }

  /**
   * Remove and return the highest-priority, oldest operation.
   * Emits system.queue.dequeued (IQ-4).
   */
  async dequeue(): Promise<QueuedOperation | null> {
    const ops = this.sortedOps();
    if (ops.length === 0) return null;

    const op = ops[0]!;
    this.removeFromIndexes(op);

    await this.emitEvent('system.queue.dequeued', { operationId: op.id, kind: op.kind, idempotencyKey: op.idempotencyKey }, op.correlationId);

    return op;
  }

  /** Returns the highest-priority, oldest operation without removing it. */
  peek(): QueuedOperation | null {
    const ops = this.sortedOps();
    return ops.length === 0 ? null : ops[0]!;
  }

  /** Current queue depth. */
  size(): number {
    return this.storage.size;
  }

  isEmpty(): boolean {
    return this.storage.size === 0;
  }

  isFull(): boolean {
    return this.storage.size >= this.maxSize;
  }

  /** Retrieve an operation by its id, or null if not present. */
  getById(id: string): QueuedOperation | null {
    return this.storage.get(id) ?? null;
  }

  /** Retrieve an operation by its idempotency key, or null if not present. */
  getByIdempotencyKey(key: string): QueuedOperation | null {
    const opId = this.idempotencyIndex.get(key);
    if (!opId) return null;
    return this.storage.get(opId) ?? null;
  }

  /** Whether an operation with the given idempotency key is currently queued. */
  hasIdempotencyKey(key: string): boolean {
    return this.idempotencyIndex.has(key);
  }

  /** Remove a specific operation by id. Returns true if it was present. */
  remove(id: string): boolean {
    const op = this.storage.get(id);
    if (!op) return false;
    this.removeFromIndexes(op);
    return true;
  }

  /**
   * Remove and return ALL operations in priority+FIFO order.
   * Emits system.queue.dequeued for each (IQ-4).
   */
  async drain(): Promise<QueuedOperation[]> {
    const ops = this.sortedOps();
    for (const op of ops) {
      this.removeFromIndexes(op);
      await this.emitEvent('system.queue.dequeued', { operationId: op.id, kind: op.kind, idempotencyKey: op.idempotencyKey }, op.correlationId);
    }
    return ops;
  }

  /**
   * Evict the oldest operation with priority >= 3 (LOW or IDLE).
   * Emits system.queue.dropped. Returns the evicted operation or null if none eligible.
   */
  async evictOldestNonCritical(): Promise<QueuedOperation | null> {
    let candidate: QueuedOperation | null = null;
    let candidateOrder = Infinity;

    for (const op of [...this.storage.values()]) {
      if (op.priority >= 3) {
        const order = this.insertionOrder.get(op.id)!;
        if (order < candidateOrder) {
          candidateOrder = order;
          candidate = op;
        }
      }
    }

    if (!candidate) return null;

    this.removeFromIndexes(candidate);
    await this.emitEvent('system.queue.dropped', { operationId: candidate.id, kind: candidate.kind, idempotencyKey: candidate.idempotencyKey, reason: 'evicted_non_critical' }, candidate.correlationId);

    return candidate;
  }

  /**
   * Remove all operations. Emits system.queue.dropped for each (IQ-4).
   */
  async clear(): Promise<void> {
    const ops = this.sortedOps();
    for (const op of ops) {
      await this.emitEvent('system.queue.dropped', { operationId: op.id, kind: op.kind, idempotencyKey: op.idempotencyKey, reason: 'cleared' }, op.correlationId);
    }
    this.storage.clear();
    this.idempotencyIndex.clear();
    this.insertionOrder.clear();
  }

  /**
   * Queue statistics for monitoring and the Mode Controller's queue-depth input.
   * oldestAge is the age in milliseconds of the oldest enqueued operation (0 when empty).
   */
  getStats(): { size: number; maxSize: number; byKind: Record<QueuedOpKind, number>; oldestAge: number } {
    const byKind: Record<QueuedOpKind, number> = { inference: 0, http: 0, mcp: 0, capability: 0 };
    let oldestTs: string | null = null;

    for (const op of [...this.storage.values()]) {
      byKind[op.kind]++;
      if (oldestTs === null || op.enqueuedAt < oldestTs) {
        oldestTs = op.enqueuedAt;
      }
    }

    const oldestAge = oldestTs !== null ? Date.parse(this.now()) - Date.parse(oldestTs) : 0;

    return {
      size: this.storage.size,
      maxSize: this.maxSize,
      byKind,
      oldestAge,
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────

  /** Remove an operation from all internal indexes. */
  private removeFromIndexes(op: QueuedOperation): void {
    this.storage.delete(op.id);
    this.idempotencyIndex.delete(op.idempotencyKey);
    this.insertionOrder.delete(op.id);
  }

  /**
   * Return all operations sorted by priority ascending (0 = highest priority,
   * dequeued first), then by insertion order ascending (FIFO within same priority).
   */
  private sortedOps(): QueuedOperation[] {
    const ops = [...this.storage.values()];
    return ops.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const aOrder = this.insertionOrder.get(a.id)!;
      const bOrder = this.insertionOrder.get(b.id)!;
      return aOrder - bOrder;
    });
  }

  /** Append a SYSTEM-domain audit event to the EventStore (IQ-4). No-op when no store. */
  private async emitEvent(type: string, data: object, correlationId?: string): Promise<void> {
    if (!this.eventStore) return;
    const event: Event = {
      id: this.idFactory() as EventID,
      domain: EventDomain.SYSTEM,
      type,
      source: this.source,
      data,
      timestamp: this.now(),
      correlation_id: correlationId,
    };
    await this.eventStore.append(event);
  }
}