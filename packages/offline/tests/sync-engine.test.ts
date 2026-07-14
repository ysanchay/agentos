/**
 * @agentos/offline — SyncEngine tests (Batch 5)
 * Tests reconciliation of queued operations, buffered events, memory writes,
 * security re-validation, idempotency, and the ONLINE transition guard.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEventStore } from '@agentos/eventstore';
import { EventDomain, type Event, type EventID } from '@agentos/types';
import { ModeController } from '../src/mode-controller.js';
import { ExecutionQueue } from '../src/execution-queue.js';
import { SyncEngine } from '../src/sync-engine.js';
import {
  ExecutionMode,
  type QueuedOperation,
} from '../src/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

let idCounter = 0;

function nextId(prefix = 'op'): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function makeOp(
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

function makeEvent(
  overrides: Partial<Event> & { id: string } = { id: nextId('evt') as unknown as EventID },
): Event {
  return {
    id: overrides.id,
    domain: overrides.domain ?? EventDomain.SYSTEM,
    type: overrides.type ?? 'test.event',
    source: overrides.source ?? 'test',
    data: overrides.data ?? {},
    timestamp: overrides.timestamp ?? '2026-06-12T00:00:00.000Z',
    correlation_id: overrides.correlation_id,
  };
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

describe('SyncEngine — operation reconciliation', () => {
  let queue: ExecutionQueue;
  let sync: SyncEngine;
  let modeController: ModeController;
  let canonicalStore: InMemoryEventStore;
  let clock: ReturnType<typeof deterministicClock>;

  beforeEach(() => {
    idCounter = 0;
    clock = deterministicClock();
    modeController = new ModeController();
    queue = new ExecutionQueue({ now: clock.now, idFactory: clock.idFactory });
    canonicalStore = new InMemoryEventStore();
    sync = new SyncEngine({
      modeController,
      now: clock.now,
      idFactory: clock.idFactory,
    });
  });

  it('applies queued operations in priority+FIFO order', async () => {
    const op1 = makeOp({ id: 'op-1', idempotencyKey: 'k-1', priority: 3 });
    const op2 = makeOp({ id: 'op-2', idempotencyKey: 'k-2', priority: 1 });
    await queue.enqueue(op1);
    await queue.enqueue(op2);

    const results = await sync.reconcile({
      queue,
      canonicalEventStore: canonicalStore,
    });

    // op2 has higher priority (1 < 3) so it goes first
    expect(results).toHaveLength(2);
    expect(results[0]!.operationId).toBe('op-2');
    expect(results[1]!.operationId).toBe('op-1');
    expect(results.every((r) => r.outcome === 'applied')).toBe(true);
  });

  it('skips duplicate operations by idempotency key', async () => {
    const op1 = makeOp({ id: 'op-1', idempotencyKey: 'dup-key' });

    // Pre-populate canonical store with an event containing the same idempotency key
    const preEvent = makeEvent({
      id: 'pre-evt-1' as unknown as EventID,
      data: { idempotencyKey: 'dup-key' },
      correlation_id: 'dup-key',
    });
    await canonicalStore.append(preEvent);

    await queue.enqueue(op1);

    const results = await sync.reconcile({
      queue,
      canonicalEventStore: canonicalStore,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('skipped_duplicate');
    expect(results[0]!.detail).toContain('Idempotency key already in canonical store');
  });

  it('fails operations that fail security re-validation (R7)', async () => {
    const op1 = makeOp({ id: 'op-1', idempotencyKey: 'k-1' });
    await queue.enqueue(op1);

    const results = await sync.reconcile({
      queue,
      canonicalEventStore: canonicalStore,
      securityRevalidator: (op) => ({
        passed: false,
        reason: 'Policy violation: blocked capability',
      }),
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('conflict');
    expect(results[0]!.detail).toContain('Security re-validation failed');
  });

  it('passes operations that pass security re-validation', async () => {
    const op1 = makeOp({ id: 'op-1', idempotencyKey: 'k-1' });
    await queue.enqueue(op1);

    const results = await sync.reconcile({
      queue,
      canonicalEventStore: canonicalStore,
      securityRevalidator: () => ({ passed: true }),
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('applied');
  });

  it('re-queues task results for Validator re-adjudication', async () => {
    const op1 = makeOp({
      id: 'op-1',
      idempotencyKey: 'k-1',
      kind: 'capability',
      capabilityPath: 'execute.task.result',
    });
    await queue.enqueue(op1);

    const results = await sync.reconcile({
      queue,
      canonicalEventStore: canonicalStore,
      taskResultRevalidator: () => ({
        requeue: true,
        reason: 'Offline result requires re-validation',
      }),
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('applied');
    expect(results[0]!.detail).toContain('Re-queued to review');
  });
});

describe('SyncEngine — event replay', () => {
  let queue: ExecutionQueue;
  let sync: SyncEngine;
  let modeController: ModeController;
  let canonicalStore: InMemoryEventStore;

  beforeEach(() => {
    idCounter = 0;
    const clock = deterministicClock();
    modeController = new ModeController();
    queue = new ExecutionQueue({ now: clock.now, idFactory: clock.idFactory });
    canonicalStore = new InMemoryEventStore();
    sync = new SyncEngine({
      modeController,
      now: clock.now,
      idFactory: clock.idFactory,
    });
  });

  it('replays buffered events to canonical store in causal order', async () => {
    const evt1 = makeEvent({
      id: 'e-1' as unknown as EventID,
      timestamp: '2026-06-12T00:00:03.000Z',
      type: 'task.started',
    });
    const evt2 = makeEvent({
      id: 'e-2' as unknown as EventID,
      timestamp: '2026-06-12T00:00:01.000Z',
      type: 'task.created',
    });
    const evt3 = makeEvent({
      id: 'e-3' as unknown as EventID,
      timestamp: '2026-06-12T00:00:02.000Z',
      type: 'task.assigned',
    });

    const results = await sync.reconcile({
      queue,
      bufferedEvents: [evt1, evt2, evt3],
      canonicalEventStore: canonicalStore,
    });

    // Events should be sorted by timestamp (causal order)
    expect(results).toHaveLength(3);
    expect(results[0]!.operationId).toBe('e-2');
    expect(results[1]!.operationId).toBe('e-3');
    expect(results[2]!.operationId).toBe('e-1');
    expect(results.every((r) => r.outcome === 'applied')).toBe(true);
  });

  it('skips duplicate events already in canonical store', async () => {
    const evt = makeEvent({
      id: 'e-1' as unknown as EventID,
      correlation_id: 'existing-key',
    });
    await canonicalStore.append(evt);

    const results = await sync.reconcile({
      queue,
      bufferedEvents: [evt],
      canonicalEventStore: canonicalStore,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('skipped_duplicate');
  });
});

describe('SyncEngine — memory write reconciliation', () => {
  let queue: ExecutionQueue;
  let sync: SyncEngine;
  let modeController: ModeController;
  let canonicalStore: InMemoryEventStore;

  beforeEach(() => {
    idCounter = 0;
    const clock = deterministicClock();
    modeController = new ModeController();
    queue = new ExecutionQueue({ now: clock.now, idFactory: clock.idFactory });
    canonicalStore = new InMemoryEventStore();
    sync = new SyncEngine({
      modeController,
      now: clock.now,
      idFactory: clock.idFactory,
    });
  });

  it('applies memory writes without a merge function', async () => {
    const results = await sync.reconcile({
      queue,
      bufferedMemoryWrites: [{ key: 'ctx-1', value: { data: 'test' }, workspaceId: 'ws-1' }],
      canonicalEventStore: canonicalStore,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('applied');
    expect(results[0]!.detail).toContain('no merge function');
  });

  it('uses merge function for memory conflicts', async () => {
    const results = await sync.reconcile({
      queue,
      bufferedMemoryWrites: [{ key: 'ctx-1', value: { data: 'offline' }, workspaceId: 'ws-1' }],
      canonicalEventStore: canonicalStore,
      memoryMergeFn: (key, offline, _online) => ({
        merged: offline,
        strategy: 'offline-wins',
        conflict: false,
      }),
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('applied');
    expect(results[0]!.detail).toContain('offline-wins');
  });

  it('reports conflict when merge function returns conflict=true', async () => {
    const results = await sync.reconcile({
      queue,
      bufferedMemoryWrites: [{ key: 'ctx-1', value: { data: 'offline' }, workspaceId: 'ws-1' }],
      canonicalEventStore: canonicalStore,
      memoryMergeFn: () => ({
        merged: null,
        strategy: 'manual-resolution-required',
        conflict: true,
      }),
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toBe('conflict');
    expect(results[0]!.detail).toContain('manual-resolution-required');
  });
});

describe('SyncEngine — ONLINE transition guard (invariant #5)', () => {
  let queue: ExecutionQueue;
  let sync: SyncEngine;
  let modeController: ModeController;

  beforeEach(() => {
    idCounter = 0;
    const clock = deterministicClock();
    modeController = new ModeController();
    queue = new ExecutionQueue({ now: clock.now, idFactory: clock.idFactory });
    sync = new SyncEngine({
      modeController,
      now: clock.now,
      idFactory: clock.idFactory,
    });
  });

  it('canTransitionToOnline returns true when queue is empty', () => {
    expect(sync.canTransitionToOnline(queue)).toBe(true);
  });

  it('canTransitionToOnline returns false when queue is non-empty', async () => {
    await queue.enqueue(makeOp({ id: 'op-1', idempotencyKey: 'k-1' }));
    expect(sync.canTransitionToOnline(queue)).toBe(false);
  });

  it('canTransitionToOnline returns true after drain', async () => {
    await queue.enqueue(makeOp({ id: 'op-1', idempotencyKey: 'k-1' }));
    expect(sync.canTransitionToOnline(queue)).toBe(false);
    await queue.drain();
    expect(sync.canTransitionToOnline(queue)).toBe(true);
  });
});

describe('SyncEngine — stats and logging', () => {
  let queue: ExecutionQueue;
  let sync: SyncEngine;
  let modeController: ModeController;
  let canonicalStore: InMemoryEventStore;

  beforeEach(() => {
    idCounter = 0;
    const clock = deterministicClock();
    modeController = new ModeController();
    queue = new ExecutionQueue({ now: clock.now, idFactory: clock.idFactory });
    canonicalStore = new InMemoryEventStore();
    sync = new SyncEngine({
      modeController,
      now: clock.now,
      idFactory: clock.idFactory,
    });
  });

  it('computes correct stats after reconciliation', async () => {
    const op1 = makeOp({ id: 'op-1', idempotencyKey: 'k-1' });
    const op2 = makeOp({ id: 'op-2', idempotencyKey: 'k-2' });
    await queue.enqueue(op1);
    await queue.enqueue(op2);

    await sync.reconcile({ queue, canonicalEventStore: canonicalStore });

    const stats = sync.getStats();
    expect(stats.total).toBe(2);
    expect(stats.applied).toBe(2);
    expect(stats.skipped).toBe(0);
    expect(stats.conflicts).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it('tracks skipped and conflict outcomes in stats', async () => {
    // Add one that will be skipped (dup key)
    const preEvent = makeEvent({
      id: 'pre-evt' as unknown as EventID,
      data: { idempotencyKey: 'dup-key' },
      correlation_id: 'dup-key',
    });
    await canonicalStore.append(preEvent);

    const op1 = makeOp({ id: 'op-1', idempotencyKey: 'dup-key' });
    const op2 = makeOp({ id: 'op-2', idempotencyKey: 'k-2' });
    await queue.enqueue(op1);
    await queue.enqueue(op2);

    await sync.reconcile({
      queue,
      canonicalEventStore: canonicalStore,
      securityRevalidator: (op) =>
        op.id === 'op-2'
          ? { passed: false, reason: 'blocked' }
          : { passed: true },
    });

    const stats = sync.getStats();
    expect(stats.total).toBe(2);
    expect(stats.applied).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(stats.conflicts).toBe(1);
  });

  it('returns reconciliation log', async () => {
    await queue.enqueue(makeOp({ id: 'op-1', idempotencyKey: 'k-1' }));
    await sync.reconcile({ queue, canonicalEventStore: canonicalStore });

    const log = sync.getReconciliationLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.operationId).toBe('op-1');
    expect(log[0]!.outcome).toBe('applied');
  });
});

describe('SyncEngine — combined operations + events + memory', () => {
  it('reconciles all three categories in one pass', async () => {
    idCounter = 0;
    const clock = deterministicClock();
    const modeController = new ModeController();
    const queue = new ExecutionQueue({ now: clock.now, idFactory: clock.idFactory });
    const canonicalStore = new InMemoryEventStore();
    const sync = new SyncEngine({
      modeController,
      now: clock.now,
      idFactory: clock.idFactory,
    });

    // Queue an operation
    await queue.enqueue(makeOp({ id: 'op-1', idempotencyKey: 'k-1' }));

    // Buffer an event
    const evt = makeEvent({
      id: 'e-1' as unknown as EventID,
      timestamp: '2026-06-12T00:00:01.000Z',
    });

    // Buffer a memory write
    const memWrite = { key: 'ctx-1', value: { data: 'test' }, workspaceId: 'ws-1' };

    const results = await sync.reconcile({
      queue,
      bufferedEvents: [evt],
      bufferedMemoryWrites: [memWrite],
      canonicalEventStore: canonicalStore,
    });

    expect(results).toHaveLength(3);
    // Operations are drained first (priority order), then events, then memory
    expect(results[0]!.operationId).toBe('op-1');
    expect(results[1]!.operationId).toBe('e-1');
    expect(results[2]!.operationId).toBe('memory:ctx-1');
    expect(results.every((r) => r.outcome === 'applied')).toBe(true);

    const stats = sync.getStats();
    expect(stats.total).toBe(3);
    expect(stats.applied).toBe(3);
  });
});