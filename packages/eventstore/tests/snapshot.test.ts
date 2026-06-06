/**
 * Tests for @agentos/eventstore — Snapshot
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SnapshotStore, createSnapshot, getLatestSnapshot, restoreFromSnapshot } from '../src/snapshot.js';
import { InMemoryEventStore } from '../src/event-store.js';
import { EventDomain } from '@agentos/types';
import type { Event, EventID } from '@agentos/types';
import { asUUID } from '@agentos/types';

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: asUUID<EventID>(crypto.randomUUID()),
    domain: EventDomain.TASK,
    type: 'task.created',
    source: 'agent-1',
    data: { name: 'Test Task' },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeEntityEvent(entityType: string, entityId: string, dataOverrides: Record<string, unknown> = {}): Event {
  return makeEvent({
    data: { entity_type: entityType, entity_id: entityId, ...dataOverrides },
  });
}

describe('SnapshotStore', () => {
  let store: SnapshotStore;

  beforeEach(() => {
    store = new SnapshotStore();
  });

  describe('createSnapshot', () => {
    it('should create a snapshot with all required fields', () => {
      const snapshot = store.createSnapshot('task', 'task-1', { name: 'My Task', status: 'pending' }, 5);

      expect(snapshot.entity_type).toBe('task');
      expect(snapshot.entity_id).toBe('task-1');
      expect(snapshot.state).toEqual({ name: 'My Task', status: 'pending' });
      expect(snapshot.at_sequence).toBe(5);
      expect(snapshot.created_at).toBeDefined();
    });

    it('should store the snapshot for later retrieval', () => {
      store.createSnapshot('task', 'task-1', { status: 'pending' }, 3);

      const latest = store.getLatestSnapshot('task', 'task-1');
      expect(latest).not.toBeNull();
      expect(latest!.at_sequence).toBe(3);
    });

    it('should only update snapshot if new sequence is higher', () => {
      store.createSnapshot('task', 'task-1', { status: 'pending' }, 3);
      store.createSnapshot('task', 'task-1', { status: 'running' }, 5);

      const latest = store.getLatestSnapshot('task', 'task-1');
      expect(latest!.at_sequence).toBe(5);
      expect((latest!.state as Record<string, unknown>).status).toBe('running');
    });

    it('should not overwrite with older sequence', () => {
      store.createSnapshot('task', 'task-1', { status: 'running' }, 5);
      store.createSnapshot('task', 'task-1', { status: 'pending' }, 3);

      const latest = store.getLatestSnapshot('task', 'task-1');
      expect(latest!.at_sequence).toBe(5);
      expect((latest!.state as Record<string, unknown>).status).toBe('running');
    });

    it('should handle multiple different entities independently', () => {
      store.createSnapshot('task', 'task-1', { status: 'pending' }, 3);
      store.createSnapshot('task', 'task-2', { status: 'running' }, 5);

      const snap1 = store.getLatestSnapshot('task', 'task-1');
      const snap2 = store.getLatestSnapshot('task', 'task-2');

      expect(snap1!.at_sequence).toBe(3);
      expect(snap2!.at_sequence).toBe(5);
    });
  });

  describe('getLatestSnapshot', () => {
    it('should return null when no snapshot exists', () => {
      expect(store.getLatestSnapshot('task', 'nonexistent')).toBeNull();
    });
  });

  describe('deleteSnapshot', () => {
    it('should remove a snapshot', () => {
      store.createSnapshot('task', 'task-1', { status: 'pending' }, 3);
      const deleted = store.deleteSnapshot('task', 'task-1');
      expect(deleted).toBe(true);
      expect(store.getLatestSnapshot('task', 'task-1')).toBeNull();
    });

    it('should return false for non-existent snapshot', () => {
      expect(store.deleteSnapshot('task', 'nonexistent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all snapshots', () => {
      store.createSnapshot('task', 'task-1', {}, 1);
      store.createSnapshot('task', 'task-2', {}, 2);
      store.clear();
      expect(store.getLatestSnapshot('task', 'task-1')).toBeNull();
      expect(store.getLatestSnapshot('task', 'task-2')).toBeNull();
    });
  });

  describe('restoreFromSnapshot', () => {
    it('should restore state from snapshot and apply subsequent events', async () => {
      const eventStore = new InMemoryEventStore();

      // Create events for entity
      await eventStore.append(makeEntityEvent('task', 'task-1', { name: 'Initial', status: 'pending' }));
      await eventStore.append(makeEntityEvent('task', 'task-1', { name: 'Updated', status: 'running' }));

      // Create snapshot at this point
      const snapshot = store.createSnapshot('task', 'task-1', { name: 'Updated', status: 'running' }, 2);

      // Add more events after snapshot
      await eventStore.append(makeEntityEvent('task', 'task-1', { status: 'completed' }));

      // Restore
      const state = await store.restoreFromSnapshot(snapshot, eventStore);
      const s = state as Record<string, unknown>;

      expect(s.status).toBe('completed');
    });

    it('should return snapshot state unchanged if no subsequent events', async () => {
      const eventStore = new InMemoryEventStore();
      await eventStore.append(makeEntityEvent('task', 'task-1', { status: 'pending' }));

      const snapshot = store.createSnapshot('task', 'task-1', { status: 'pending' }, 1);

      const state = await store.restoreFromSnapshot(snapshot, eventStore);
      const s = state as Record<string, unknown>;

      expect(s.status).toBe('pending');
    });
  });
});

describe('createSnapshot (standalone)', () => {
  it('should create a snapshot with required fields', () => {
    const snapshot = createSnapshot('task', 'task-1', { status: 'pending' }, 5);

    expect(snapshot.entity_type).toBe('task');
    expect(snapshot.entity_id).toBe('task-1');
    expect(snapshot.state).toEqual({ status: 'pending' });
    expect(snapshot.at_sequence).toBe(5);
    expect(snapshot.created_at).toBeDefined();
  });

  it('should produce a valid ISO8601 timestamp', () => {
    const snapshot = createSnapshot('task', 'task-1', {}, 0);
    expect(new Date(snapshot.created_at).toISOString()).toBe(snapshot.created_at);
  });
});

describe('getLatestSnapshot (standalone)', () => {
  it('should delegate to store.getLatestSnapshot', () => {
    const store = new SnapshotStore();
    store.createSnapshot('task', 'task-1', { status: 'pending' }, 3);

    const snapshot = getLatestSnapshot(store, 'task', 'task-1');
    expect(snapshot).not.toBeNull();
    expect(snapshot!.at_sequence).toBe(3);
  });

  it('should return null for non-existent entity', () => {
    const store = new SnapshotStore();
    const snapshot = getLatestSnapshot(store, 'task', 'nonexistent');
    expect(snapshot).toBeNull();
  });
});

describe('restoreFromSnapshot (standalone)', () => {
  it('should restore state from snapshot', async () => {
    const eventStore = new InMemoryEventStore();
    await eventStore.append(makeEntityEvent('task', 'task-1', { status: 'pending' }));

    const snapshot = createSnapshot('task', 'task-1', { status: 'pending' }, 1);
    const state = await restoreFromSnapshot(snapshot, eventStore);

    expect(state).toBeDefined();
    const s = state as Record<string, unknown>;
    expect(s.status).toBe('pending');
  });
});

describe('Snapshot restore with events after snapshot', () => {
  it('should apply events that occurred after the snapshot', async () => {
    const eventStore = new InMemoryEventStore();
    const snapshotStore = new SnapshotStore();

    // Create events before snapshot
    await eventStore.append(makeEntityEvent('task', 'task-1', { name: 'Initial', status: 'pending' }));

    // Take snapshot
    const snapshot = snapshotStore.createSnapshot('task', 'task-1', { name: 'Initial', status: 'pending' }, 1);

    // Wait a small amount of time to ensure timestamp is after snapshot
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Add events after snapshot
    await eventStore.append(makeEntityEvent('task', 'task-1', { status: 'running' }));
    await eventStore.append(makeEntityEvent('task', 'task-1', { status: 'completed', result: 'success' }));

    // Restore from snapshot
    const state = await snapshotStore.restoreFromSnapshot(snapshot, eventStore);
    const s = state as Record<string, unknown>;

    expect(s.status).toBe('completed');
    expect(s.result).toBe('success');
  });

  it('should handle events with non-object data during restore', async () => {
    const eventStore = new InMemoryEventStore();
    const snapshotStore = new SnapshotStore();

    await eventStore.append(makeEntityEvent('task', 'task-1', { status: 'pending' }));
    const snapshot = snapshotStore.createSnapshot('task', 'task-1', { status: 'pending' }, 1);

    // Add event with non-object data after snapshot
    await eventStore.append({
      ...makeEvent(),
      data: 'not-an-object',
    });

    // Should not crash
    const state = await snapshotStore.restoreFromSnapshot(snapshot, eventStore);
    expect(state).toBeDefined();
  });
});