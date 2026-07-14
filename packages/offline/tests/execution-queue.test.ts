import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEventStore } from '@agentos/eventstore';
import { EventDomain } from '@agentos/types';
import { ExecutionQueue } from '../src/execution-queue.js';
import { InferenceRouter, type CloudExecutor, type LocalExecutor } from '../src/inference-router.js';
import { LocalModelRegistry } from '../src/local-model-registry.js';
import { ModeController } from '../src/mode-controller.js';
import {
  ExecutionMode,
  OFF,
  type QueuedOperation,
} from '../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

let idCounter = 0;

function nextId(prefix = 'op'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function op(
  overrides: Partial<QueuedOperation> & { idempotencyKey: string } = { idempotencyKey: 'k-1' },
): QueuedOperation {
  const id = overrides.id ?? nextId();
  return {
    id,
    kind: overrides.kind ?? 'inference',
    idempotencyKey: overrides.idempotencyKey,
    capabilityPath: overrides.capabilityPath ?? 'reason.infer.text',
    workspaceId: overrides.workspaceId ?? 'ws-1',
    payload: overrides.payload ?? { prompt: 'hi' },
    correlationId: overrides.correlationId,
    causationId: overrides.causationId,
    enqueuedAt: overrides.enqueuedAt ?? '2026-06-12T00:00:00.000Z',
    priority: overrides.priority ?? 3,
  };
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

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('ExecutionQueue — basic enqueue/dequeue (FIFO within same priority)', () => {
  let q: ExecutionQueue;

  beforeEach(() => {
    idCounter = 0;
    q = new ExecutionQueue();
  });

  it('enqueues and dequeues a single operation', async () => {
    const a = op({ idempotencyKey: 'k-a', priority: 3 });
    const res = await q.enqueue(a);
    expect(res.ok).toBe(true);
    expect(q.size()).toBe(1);
    const out = await q.dequeue();
    expect(out).not.toBeNull();
    expect(out!.id).toBe(a.id);
    expect(q.isEmpty()).toBe(true);
  });

  it('dequeues in FIFO order within the same priority', async () => {
    const a = op({ idempotencyKey: 'k-a', priority: 3 });
    const b = op({ idempotencyKey: 'k-b', priority: 3 });
    const c = op({ idempotencyKey: 'k-c', priority: 3 });
    await q.enqueue(a);
    await q.enqueue(b);
    await q.enqueue(c);
    expect(await q.dequeue()).toMatchObject({ id: a.id });
    expect(await q.dequeue()).toMatchObject({ id: b.id });
    expect(await q.dequeue()).toMatchObject({ id: c.id });
  });
});

describe('ExecutionQueue — priority ordering', () => {
  let q: ExecutionQueue;

  beforeEach(() => {
    idCounter = 0;
    q = new ExecutionQueue();
  });

  it('dequeues priority 0 before priority 5', async () => {
    const idle = op({ idempotencyKey: 'k-idle', priority: 5 });
    const system = op({ idempotencyKey: 'k-sys', priority: 0 });
    await q.enqueue(idle);
    await q.enqueue(system);
    expect((await q.dequeue())!.id).toBe(system.id);
    expect((await q.dequeue())!.id).toBe(idle.id);
  });

  it('respects priority across multiple levels then FIFO within ties', async () => {
    const a = op({ idempotencyKey: 'k-a', priority: 2 });
    const b = op({ idempotencyKey: 'k-b', priority: 0 });
    const c = op({ idempotencyKey: 'k-c', priority: 0 });
    const d = op({ idempotencyKey: 'k-d', priority: 1 });
    await q.enqueue(a);
    await q.enqueue(b);
    await q.enqueue(c);
    await q.enqueue(d);
    const order = [];
    while (!q.isEmpty()) order.push((await q.dequeue())!.idempotencyKey);
    // b (p0, 2nd insert) → c (p0, 3rd insert) → d (p1) → a (p2)
    expect(order).toEqual(['k-b', 'k-c', 'k-d', 'k-a']);
  });

  it('peek returns the highest-priority op without removing', async () => {
    await q.enqueue(op({ idempotencyKey: 'k-low', priority: 5 }));
    await q.enqueue(op({ idempotencyKey: 'k-high', priority: 0 }));
    expect(q.peek()!.idempotencyKey).toBe('k-high');
    expect(q.size()).toBe(2);
  });
});

describe('ExecutionQueue — idempotency key deduplication', () => {
  let q: ExecutionQueue;

  beforeEach(() => {
    idCounter = 0;
    q = new ExecutionQueue();
  });

  it('same idempotency key = no-op (idempotent, IQ-1)', async () => {
    const a = op({ idempotencyKey: 'dup', priority: 3 });
    const b = op({ idempotencyKey: 'dup', priority: 0 });
    await q.enqueue(a);
    const res = await q.enqueue(b);
    expect(res.ok).toBe(true);
    expect(q.size()).toBe(1);
    // The original op remains; the second is discarded.
    const out = await q.dequeue();
    expect(out!.id).toBe(a.id);
  });

  it('different keys = both stored', async () => {
    await q.enqueue(op({ idempotencyKey: 'k-1' }));
    await q.enqueue(op({ idempotencyKey: 'k-2' }));
    expect(q.size()).toBe(2);
  });

  it('hasIdempotencyKey and getByIdempotencyKey', async () => {
    const a = op({ idempotencyKey: 'lookup-key' });
    await q.enqueue(a);
    expect(q.hasIdempotencyKey('lookup-key')).toBe(true);
    expect(q.hasIdempotencyKey('missing')).toBe(false);
    expect(q.getByIdempotencyKey('lookup-key')!.id).toBe(a.id);
    expect(q.getByIdempotencyKey('missing')).toBeNull();
  });
});

describe('ExecutionQueue — backpressure (IQ-3, IQ-5)', () => {
  let q: ExecutionQueue;

  beforeEach(() => {
    idCounter = 0;
    q = new ExecutionQueue({ maxSize: 3 });
  });

  it('returns OFF-0002 when full and no evictable non-critical ops', async () => {
    // Fill with critical ops (priority < 3) — not evictable.
    await q.enqueue(op({ idempotencyKey: 'k-1', priority: 0 }));
    await q.enqueue(op({ idempotencyKey: 'k-2', priority: 1 }));
    await q.enqueue(op({ idempotencyKey: 'k-3', priority: 2 }));
    expect(q.isFull()).toBe(true);

    const res = await q.enqueue(op({ idempotencyKey: 'k-4', priority: 0 }));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe(OFF.QUEUE_FULL);
    expect(q.size()).toBe(3);
  });

  it('auto-evicts oldest non-critical to make room when at capacity', async () => {
    // Fill with one critical + two non-critical.
    await q.enqueue(op({ idempotencyKey: 'k-crit', priority: 0 }));
    await q.enqueue(op({ idempotencyKey: 'k-low1', priority: 3 }));
    await q.enqueue(op({ idempotencyKey: 'k-low2', priority: 5 }));
    expect(q.size()).toBe(3);

    // Enqueueing a new op should evict k-low1 (oldest non-critical).
    const res = await q.enqueue(op({ idempotencyKey: 'k-new', priority: 2 }));
    expect(res.ok).toBe(true);
    expect(q.size()).toBe(3); // evicted one, added one
    expect(q.hasIdempotencyKey('k-low1')).toBe(false);
    expect(q.hasIdempotencyKey('k-new')).toBe(true);
    expect(q.hasIdempotencyKey('k-crit')).toBe(true);
  });
});

describe('ExecutionQueue — eviction of oldest non-critical', () => {
  let q: ExecutionQueue;

  beforeEach(() => {
    idCounter = 0;
    q = new ExecutionQueue();
  });

  it('evicts the oldest operation with priority >= 3', async () => {
    await q.enqueue(op({ idempotencyKey: 'k-crit', priority: 0 }));
    await q.enqueue(op({ idempotencyKey: 'k-low1', priority: 3 }));
    await q.enqueue(op({ idempotencyKey: 'k-low2', priority: 5 }));
    const evicted = await q.evictOldestNonCritical();
    expect(evicted).not.toBeNull();
    expect(evicted!.idempotencyKey).toBe('k-low1');
    expect(q.size()).toBe(2);
  });

  it('returns null when no non-critical ops exist', async () => {
    await q.enqueue(op({ idempotencyKey: 'k-c1', priority: 0 }));
    await q.enqueue(op({ idempotencyKey: 'k-c2', priority: 2 }));
    const evicted = await q.evictOldestNonCritical();
    expect(evicted).toBeNull();
    expect(q.size()).toBe(2);
  });

  it('returns null when queue is empty', async () => {
    expect(await q.evictOldestNonCritical()).toBeNull();
  });
});

describe('ExecutionQueue — drain', () => {
  let q: ExecutionQueue;

  beforeEach(() => {
    idCounter = 0;
    q = new ExecutionQueue();
  });

  it('returns all operations in priority+FIFO order', async () => {
    await q.enqueue(op({ idempotencyKey: 'k-1', priority: 3 }));
    await q.enqueue(op({ idempotencyKey: 'k-2', priority: 0 }));
    await q.enqueue(op({ idempotencyKey: 'k-3', priority: 0 }));
    const drained = await q.drain();
    expect(drained).toHaveLength(3);
    expect(drained.map((o) => o.idempotencyKey)).toEqual(['k-2', 'k-3', 'k-1']);
    expect(q.isEmpty()).toBe(true);
  });

  it('drain on empty queue returns []', async () => {
    expect(await q.drain()).toEqual([]);
  });
});

describe('ExecutionQueue — event emission to EventStore (IQ-4)', () => {
  let store: InMemoryEventStore;
  let q: ExecutionQueue;

  beforeEach(() => {
    idCounter = 0;
    store = new InMemoryEventStore();
    const d = deterministicClock();
    q = new ExecutionQueue({ eventStore: store, now: d.now, idFactory: d.idFactory });
  });

  it('emits system.queue.enqueued on enqueue', async () => {
    await q.enqueue(op({ idempotencyKey: 'k-1', correlationId: 'corr-x' }));
    const page = await store.query({ domain: EventDomain.SYSTEM, type: 'system.queue.enqueued' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.source).toBe('offline.execution-queue');
    expect(page.items[0]!.correlation_id).toBe('corr-x');
    expect((page.items[0]!.data as { operationId: string }).operationId).toBeDefined();
  });

  it('emits system.queue.dequeued on dequeue', async () => {
    await q.enqueue(op({ idempotencyKey: 'k-1', correlationId: 'c1' }));
    await q.dequeue();
    const page = await store.query({ domain: EventDomain.SYSTEM, type: 'system.queue.dequeued' });
    expect(page.items).toHaveLength(1);
  });

  it('emits system.queue.dropped on eviction', async () => {
    await q.enqueue(op({ idempotencyKey: 'k-low', priority: 3 }));
    await q.evictOldestNonCritical();
    const page = await store.query({ domain: EventDomain.SYSTEM, type: 'system.queue.dropped' });
    expect(page.items).toHaveLength(1);
    expect((page.items[0]!.data as { reason: string }).reason).toBe('evicted_non_critical');
  });

  it('emits system.queue.dropped for each op on clear', async () => {
    await q.enqueue(op({ idempotencyKey: 'k-1' }));
    await q.enqueue(op({ idempotencyKey: 'k-2' }));
    await q.clear();
    const page = await store.query({ domain: EventDomain.SYSTEM, type: 'system.queue.dropped' });
    expect(page.items).toHaveLength(2);
  });

  it('emits system.queue.dequeued for each op on drain', async () => {
    await q.enqueue(op({ idempotencyKey: 'k-1' }));
    await q.enqueue(op({ idempotencyKey: 'k-2' }));
    await q.drain();
    const page = await store.query({ domain: EventDomain.SYSTEM, type: 'system.queue.dequeued' });
    expect(page.items).toHaveLength(2);
  });

  it('does not emit on idempotent duplicate enqueue', async () => {
    await q.enqueue(op({ idempotencyKey: 'dup' }));
    await q.enqueue(op({ idempotencyKey: 'dup' }));
    const page = await store.query({ domain: EventDomain.SYSTEM, type: 'system.queue.enqueued' });
    expect(page.items).toHaveLength(1);
  });
});

describe('ExecutionQueue — stats', () => {
  let q: ExecutionQueue;

  beforeEach(() => {
    idCounter = 0;
    q = new ExecutionQueue({ maxSize: 100 });
  });

  it('reports size, maxSize, byKind counts, and oldestAge', async () => {
    const clock = { now: () => '2026-06-12T00:00:10.000Z' };
    const localQ = new ExecutionQueue({ maxSize: 100, now: clock.now });
    await localQ.enqueue(op({ idempotencyKey: 'k-1', kind: 'inference', enqueuedAt: '2026-06-12T00:00:05.000Z' }));
    await localQ.enqueue(op({ idempotencyKey: 'k-2', kind: 'http', enqueuedAt: '2026-06-12T00:00:07.000Z' }));
    await localQ.enqueue(op({ idempotencyKey: 'k-3', kind: 'http', enqueuedAt: '2026-06-12T00:00:08.000Z' }));
    await localQ.enqueue(op({ idempotencyKey: 'k-4', kind: 'mcp', enqueuedAt: '2026-06-12T00:00:09.000Z' }));

    const stats = localQ.getStats();
    expect(stats.size).toBe(4);
    expect(stats.maxSize).toBe(100);
    expect(stats.byKind).toEqual({ inference: 1, http: 2, mcp: 1, capability: 0 });
    // oldest = k-1 at 00:05, now = 00:10 → 5000 ms
    expect(stats.oldestAge).toBe(5000);
  });

  it('oldestAge is 0 when queue is empty', () => {
    expect(q.getStats().oldestAge).toBe(0);
  });
});

describe('ExecutionQueue — getById, remove', () => {
  let q: ExecutionQueue;

  beforeEach(() => {
    idCounter = 0;
    q = new ExecutionQueue();
  });

  it('getById returns the op or null', async () => {
    const a = op({ idempotencyKey: 'k-1' });
    await q.enqueue(a);
    expect(q.getById(a.id)!.idempotencyKey).toBe('k-1');
    expect(q.getById('missing')).toBeNull();
  });

  it('remove deletes by id and cleans indexes', async () => {
    const a = op({ idempotencyKey: 'k-1' });
    await q.enqueue(a);
    expect(q.remove(a.id)).toBe(true);
    expect(q.size()).toBe(0);
    expect(q.hasIdempotencyKey('k-1')).toBe(false);
    expect(q.remove(a.id)).toBe(false);
  });
});

describe('ExecutionQueue — integration with InferenceRouter', () => {
  beforeEach(() => {
    idCounter = 0;
  });

  it('operations queued by InferenceRouter land in the ExecutionQueue', async () => {
    const queue = new ExecutionQueue();
    const registry = new LocalModelRegistry();
    // No local model registered → router will queue in OFFLINE mode.
    const modeController = new ModeController({ initialMode: ExecutionMode.OFFLINE });
    const localExecutor: LocalExecutor = async () => ({ data: 'local', tokensUsed: 100 });
    const cloudExecutor: CloudExecutor = async () => ({ data: 'cloud', tokensUsed: 100 });

    const router = new InferenceRouter({
      registry,
      modeController,
      localExecutor,
      cloudExecutor,
      policy: { allowCloud: true, optimizeFor: 'accuracy', whenUnavailable: 'queue' },
      enqueue: async (op) => {
        await queue.enqueue(op);
      },
    });

    const out = await router.infer({
      capabilityPath: 'reason.infer.text',
      taskType: 'reasoning',
      workspaceId: 'ws-1',
      payload: { prompt: 'hello' },
      correlationId: 'corr-router-1',
    });

    expect(out.ok).toBe(false);
    expect(out.decision.target).toBe('queue');
    expect(queue.size()).toBe(1);
    const queued = queue.peek()!;
    expect(queued.kind).toBe('inference');
    expect(queued.idempotencyKey).toBe('corr-router-1');
    expect(queued.workspaceId).toBe('ws-1');
  });

  it('idempotent re-infer with same correlationId does not duplicate queue entry', async () => {
    const queue = new ExecutionQueue();
    const registry = new LocalModelRegistry();
    const modeController = new ModeController({ initialMode: ExecutionMode.OFFLINE });
    const localExecutor: LocalExecutor = async () => ({ data: 'local', tokensUsed: 100 });
    const cloudExecutor: CloudExecutor = async () => ({ data: 'cloud', tokensUsed: 100 });

    const router = new InferenceRouter({
      registry,
      modeController,
      localExecutor,
      cloudExecutor,
      policy: { allowCloud: true, optimizeFor: 'accuracy', whenUnavailable: 'queue' },
      enqueue: async (queuedOp) => {
        await queue.enqueue(queuedOp);
      },
    });

    const request = {
      capabilityPath: 'reason.infer.text',
      taskType: 'reasoning',
      workspaceId: 'ws-1',
      payload: { prompt: 'hello' },
      correlationId: 'corr-dedup',
    };

    await router.infer(request);
    await router.infer(request);

    // The second call generates a NEW op id (router uses idFactory), but the
    // idempotencyKey is the correlationId — so the queue dedup keeps only one.
    expect(queue.size()).toBe(1);
    expect(queue.hasIdempotencyKey('corr-dedup')).toBe(true);
  });
});