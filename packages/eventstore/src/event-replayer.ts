/**
 * @agentos/eventstore — Event Replayer
 * Replay events to reconstruct entity state from the event stream.
 * Supports both full replay and incremental replay from a timestamp.
 */

import type { Event, ISO8601 } from '@agentos/types';
import type { IEventStore, EventFilter } from './event-store.js';

// ─── EventReplayer ──────────────────────────────────────────────────

/**
 * Replay all events for a specific entity and return the reconstructed state.
 * Applies events in sequence order to build the final entity state.
 */
export async function replayForEntity(
  eventStore: IEventStore,
  entityType: string,
  entityId: string,
): Promise<unknown> {
  const events = await eventStore.getEventsForEntity(entityType, entityId);

  if (events.length === 0) {
    return null;
  }

  // Apply events in order to reconstruct state
  let state: Record<string, unknown> = {};

  for (const event of events) {
    state = applyEvent(state, event);
  }

  return state;
}

/**
 * Replay events from a given timestamp as an async iterable.
 * This allows consumers to process events as they are replayed
 * without loading everything into memory at once.
 */
export async function* replayFromTimestamp(
  eventStore: IEventStore,
  timestamp: ISO8601,
  filter?: EventFilter,
): AsyncIterable<Event> {
  const effectiveFilter: EventFilter = filter ?? {};
  const events = await eventStore.replay(effectiveFilter, timestamp);

  for (const event of events) {
    yield event;
  }
}

// ─── Event Application ──────────────────────────────────────────────

/**
 * Apply an event to the current state, producing a new state.
 * This is a simple merge strategy: event data fields overwrite existing state.
 * Domain-specific reducers can be registered for more sophisticated behavior.
 */
function applyEvent(state: Record<string, unknown>, event: Event): Record<string, unknown> {
  const data = event.data as Record<string, unknown> | undefined;

  if (!data || typeof data !== 'object') {
    return state;
  }

  // Special handling for entity metadata
  const newState: Record<string, unknown> = { ...state };

  // Apply event data fields
  for (const [key, value] of Object.entries(data)) {
    newState[key] = value;
  }

  // Track the last applied event for provenance
  newState['_last_event_id'] = event.id;
  newState['_last_event_type'] = event.type;
  newState['_last_event_timestamp'] = event.timestamp;

  return newState;
}