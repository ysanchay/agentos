import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEventStore } from '@agentos/eventstore';
import { EventDomain } from '@agentos/types';
import { ModeController } from './mode-controller.js';
import { ConnectivityState, ExecutionMode, type ModeTransition } from './types.js';

// Deterministic id/clock factories for reproducible events.
function deterministic() {
  let n = 0;
  return {
    idFactory: () => `evt-${(n += 1)}`,
    now: () => `2026-06-12T00:00:0${Math.min(n, 9)}.000Z`,
  };
}

describe('ModeController.computeTargetMode (pure)', () => {
  it('NONE connectivity → OFFLINE regardless of queue', () => {
    expect(ModeController.computeTargetMode(ConnectivityState.NONE, 0)).toBe(ExecutionMode.OFFLINE);
    expect(ModeController.computeTargetMode(ConnectivityState.NONE, 9)).toBe(ExecutionMode.OFFLINE);
  });

  it('PARTIAL connectivity → HYBRID', () => {
    expect(ModeController.computeTargetMode(ConnectivityState.PARTIAL, 0)).toBe(ExecutionMode.HYBRID);
  });

  it('FULL + empty queue → ONLINE', () => {
    expect(ModeController.computeTargetMode(ConnectivityState.FULL, 0)).toBe(ExecutionMode.ONLINE);
  });

  it('INVARIANT #5: FULL + non-empty queue → HYBRID, never ONLINE', () => {
    expect(ModeController.computeTargetMode(ConnectivityState.FULL, 1)).toBe(ExecutionMode.HYBRID);
  });
});

describe('ModeController transitions', () => {
  let store: InMemoryEventStore;
  let controller: ModeController;

  beforeEach(() => {
    const d = deterministic();
    store = new InMemoryEventStore();
    controller = new ModeController({ eventStore: store, idFactory: d.idFactory, now: d.now });
  });

  it('returns null and emits nothing when the mode is unchanged', async () => {
    // starts ONLINE; FULL + empty queue keeps it ONLINE
    const t = await controller.evaluate(ConnectivityState.FULL, 0);
    expect(t).toBeNull();
    expect(await store.getCurrentSequence()).toBe(0);
  });

  it('transitions ONLINE → OFFLINE on connectivity loss and records the reason', async () => {
    const t = await controller.evaluate(ConnectivityState.NONE, 0);
    expect(t).not.toBeNull();
    expect(t!.from).toBe(ExecutionMode.ONLINE);
    expect(t!.to).toBe(ExecutionMode.OFFLINE);
    expect(controller.getMode()).toBe(ExecutionMode.OFFLINE);
  });

  it('emits a SYSTEM event named system.mode.<mode> per transition (invariant #6)', async () => {
    await controller.evaluate(ConnectivityState.NONE, 0);
    const page = await store.query({ domain: EventDomain.SYSTEM });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.type).toBe('system.mode.offline');
    expect(page.items[0]!.source).toBe('offline.mode-controller');
  });

  it('audits BEFORE notifying listeners (event exists when listener fires)', async () => {
    let seqSeenByListener = -1;
    controller.onModeChange(() => {
      // The append is awaited before listeners run, so the event is already persisted.
      seqSeenByListener = (store as unknown as { ['sequence']: number })['sequence'];
    });
    await controller.evaluate(ConnectivityState.NONE, 0);
    expect(seqSeenByListener).toBe(1);
  });

  it('holds HYBRID while the queue is non-empty even under FULL connectivity', async () => {
    await controller.evaluate(ConnectivityState.NONE, 2); // go offline with a queue
    const t = await controller.evaluate(ConnectivityState.FULL, 2); // reconnect, queue still has 2
    expect(t!.to).toBe(ExecutionMode.HYBRID);
    expect(t!.reason).toContain('queued op');
    // only once the queue drains do we reach ONLINE
    const t2 = await controller.evaluate(ConnectivityState.FULL, 0);
    expect(t2!.to).toBe(ExecutionMode.ONLINE);
  });

  it('notifies subscribed listeners with the transition', async () => {
    const seen: ModeTransition[] = [];
    controller.onModeChange((t) => seen.push(t));
    await controller.evaluate(ConnectivityState.PARTIAL, 0);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.to).toBe(ExecutionMode.HYBRID);
  });

  it('unsubscribe stops further notifications', async () => {
    const seen: ModeTransition[] = [];
    const off = controller.onModeChange((t) => seen.push(t));
    off();
    await controller.evaluate(ConnectivityState.NONE, 0);
    expect(seen).toHaveLength(0);
  });

  it('works without an event store (no-op audit)', async () => {
    const c = new ModeController();
    const t = await c.evaluate(ConnectivityState.NONE, 0);
    expect(t!.to).toBe(ExecutionMode.OFFLINE);
  });
});
