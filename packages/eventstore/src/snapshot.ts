/**
 * @agentos/eventstore — Snapshot
 * Periodic snapshots for fast replay. Instead of replaying all events
 * from the beginning, restore from the latest snapshot and replay
 * only events after the snapshot's sequence number.
 */

import type { ISO8601 } from '@agentos/types';
import type { IEventStore } from './event-store.js';

// ─── Snapshot Interface ──────────────────────────────────────────────

export interface Snapshot {
  entity_type: string;
  entity_id: string;
  state: unknown;
  at_sequence: number;
  created_at: ISO8601;
}

// ─── SnapshotStore ────────────────────────────────────────────────────

export class SnapshotStore {
  private snapshots: Map<string, Snapshot> = new Map();

  /** Create a snapshot of entity state at a given sequence */
  createSnapshot(
    entityType: string,
    entityId: string,
    state: unknown,
    atSequence: number,
  ): Snapshot {
    const key = this.makeKey(entityType, entityId);

    const snapshot: Snapshot = {
      entity_type: entityType,
      entity_id: entityId,
      state,
      at_sequence: atSequence,
      created_at: new Date().toISOString() as ISO8601,
    };

    // Only store if this snapshot is newer than existing
    const existing = this.snapshots.get(key);
    if (!existing || existing.at_sequence < atSequence) {
      this.snapshots.set(key, snapshot);
    }

    return snapshot;
  }

  /** Get the latest snapshot for an entity */
  getLatestSnapshot(entityType: string, entityId: string): Snapshot | null {
    const key = this.makeKey(entityType, entityId);
    return this.snapshots.get(key) ?? null;
  }

  /**
   * Restore entity state from a snapshot, then replay any events
   * that occurred after the snapshot was taken.
   */
  async restoreFromSnapshot(
    snapshot: Snapshot,
    eventStore: IEventStore,
  ): Promise<unknown> {
    // Get all events for this entity
    const allEvents = await eventStore.getEventsForEntity(
      snapshot.entity_type,
      snapshot.entity_id,
    );

    // Filter to only events after the snapshot sequence
    const eventsAfterSnapshot = allEvents.filter((e) => {
      const data = e.data as Record<string, unknown> | undefined;
      if (!data || typeof data !== 'object') return false;
      // We compare by timestamp since events don't carry a sequence field directly
      // The snapshot's at_sequence corresponds to the Nth event for this entity
      return e.timestamp >= snapshot.created_at;
    });

    // Start with snapshot state and apply remaining events
    let state: Record<string, unknown> = {
      ...(snapshot.state as Record<string, unknown>),
    };

    for (const event of eventsAfterSnapshot) {
      const data = event.data as Record<string, unknown> | undefined;
      if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          state[key] = value;
        }
        state['_last_event_id'] = event.id;
        state['_last_event_type'] = event.type;
        state['_last_event_timestamp'] = event.timestamp;
      }
    }

    return state;
  }

  /** Delete a snapshot for an entity */
  deleteSnapshot(entityType: string, entityId: string): boolean {
    const key = this.makeKey(entityType, entityId);
    return this.snapshots.delete(key);
  }

  /** Clear all snapshots */
  clear(): void {
    this.snapshots.clear();
  }

  // ─── Private ──────────────────────────────────────────────────────

  private makeKey(entityType: string, entityId: string): string {
    return `${entityType}:${entityId}`;
  }
}

// ─── Standalone Helper Functions ──────────────────────────────────────

/**
 * Create a snapshot of entity state at a given sequence.
 * Standalone function that creates a Snapshot object without a store.
 */
export function createSnapshot(
  entityType: string,
  entityId: string,
  state: unknown,
  atSequence: number,
): Snapshot {
  return {
    entity_type: entityType,
    entity_id: entityId,
    state,
    at_sequence: atSequence,
    created_at: new Date().toISOString() as ISO8601,
  };
}

/**
 * Get the latest snapshot for an entity from a SnapshotStore.
 * Returns null if no snapshot exists.
 */
export function getLatestSnapshot(
  store: SnapshotStore,
  entityType: string,
  entityId: string,
): Snapshot | null {
  return store.getLatestSnapshot(entityType, entityId);
}

/**
 * Restore entity state from a snapshot by replaying events after it.
 */
export async function restoreFromSnapshot(
  snapshot: Snapshot,
  eventStore: IEventStore,
): Promise<unknown> {
  const store = new SnapshotStore();
  return store.restoreFromSnapshot(snapshot, eventStore);
}