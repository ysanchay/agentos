/**
 * Tests for @agentos/eventstore — Event Replayer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryEventStore } from '../src/event-store.js';
import { replayForEntity, replayFromTimestamp } from '../src/event-replayer.js';
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

describe('replayForEntity', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  it('should reconstruct entity state from events', async () => {
    await store.append(makeEntityEvent('task', 'task-1', { name: 'Initial Task', status: 'pending' }));
    await store.append(makeEntityEvent('task', 'task-1', { name: 'Updated Task', status: 'running' }));
    await store.append(makeEntityEvent('task', 'task-1', { status: 'completed' }));

    const state = await replayForEntity(store, 'task', 'task-1');

    expect(state).not.toBeNull();
    const s = state as Record<string, unknown>;
    expect(s.name).toBe('Updated Task');
    expect(s.status).toBe('completed');
  });

  it('should return null for entity with no events', async () => {
    const state = await replayForEntity(store, 'task', 'nonexistent');
    expect(state).toBeNull();
  });

  it('should track last event metadata', async () => {
    await store.append(makeEntityEvent('task', 'task-1', { status: 'pending' }));
    await store.append(makeEntityEvent('task', 'task-1', { status: 'running' }));

    const state = await replayForEntity(store, 'task', 'task-1');
    const s = state as Record<string, unknown>;

    expect(s._last_event_type).toBeDefined();
    expect(s._last_event_timestamp).toBeDefined();
    expect(s._last_event_id).toBeDefined();
  });

  it('should not mix events from different entities', async () => {
    await store.append(makeEntityEvent('task', 'task-1', { name: 'Task 1' }));
    await store.append(makeEntityEvent('task', 'task-2', { name: 'Task 2' }));

    const state1 = await replayForEntity(store, 'task', 'task-1');
    const state2 = await replayForEntity(store, 'task', 'task-2');

    const s1 = state1 as Record<string, unknown>;
    const s2 = state2 as Record<string, unknown>;
    expect(s1.name).toBe('Task 1');
    expect(s2.name).toBe('Task 2');
  });
});

describe('replayFromTimestamp', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  it('should replay events from a given timestamp', async () => {
    await store.append(makeEvent({ timestamp: '2026-01-01T00:00:00Z', type: 'task.created' }));
    await store.append(makeEvent({ timestamp: '2026-03-01T00:00:00Z', type: 'task.updated' }));
    await store.append(makeEvent({ timestamp: '2026-06-01T00:00:00Z', type: 'task.completed' }));

    const events: Event[] = [];
    for await (const event of replayFromTimestamp(store, '2026-03-01T00:00:00Z')) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]!.type).toBe('task.updated');
    expect(events[1]!.type).toBe('task.completed');
  });

  it('should replay events with filter applied', async () => {
    await store.append(makeEvent({ timestamp: '2026-01-01T00:00:00Z', type: 'task.created', domain: EventDomain.TASK }));
    await store.append(makeEvent({ timestamp: '2026-02-01T00:00:00Z', type: 'agent.spawned', domain: EventDomain.AGENT }));
    await store.append(makeEvent({ timestamp: '2026-03-01T00:00:00Z', type: 'task.completed', domain: EventDomain.TASK }));

    const events: Event[] = [];
    for await (const event of replayFromTimestamp(store, '2026-01-01T00:00:00Z', { domain: EventDomain.TASK })) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    events.forEach((e) => expect(e.domain).toBe(EventDomain.TASK));
  });

  it('should return empty iterable when no events match', async () => {
    await store.append(makeEvent({ timestamp: '2026-01-01T00:00:00Z' }));

    const events: Event[] = [];
    for await (const event of replayFromTimestamp(store, '2099-01-01T00:00:00Z')) {
      events.push(event);
    }

    expect(events).toHaveLength(0);
  });

  it('should work as an async iterable', async () => {
    await store.append(makeEvent({ timestamp: '2026-01-01T00:00:00Z' }));
    await store.append(makeEvent({ timestamp: '2026-02-01T00:00:00Z' }));

    const iterable = replayFromTimestamp(store, '2020-01-01T00:00:00Z');

    // Should be iterable
    let count = 0;
    for await (const _ of iterable) {
      count++;
    }
    expect(count).toBe(2);
  });

  it('should replay with source filter', async () => {
    await store.append(makeEvent({ timestamp: '2026-01-01T00:00:00Z', source: 'agent-1' }));
    await store.append(makeEvent({ timestamp: '2026-01-01T00:00:00Z', source: 'agent-2' }));

    const events: Event[] = [];
    for await (const event of replayFromTimestamp(store, '2020-01-01T00:00:00Z', { source: 'agent-1' })) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
  });

  it('should replay with correlation_id filter', async () => {
    await store.append(makeEvent({ timestamp: '2026-01-01T00:00:00Z', correlation_id: 'corr-1' }));
    await store.append(makeEvent({ timestamp: '2026-01-01T00:00:00Z', correlation_id: 'corr-2' }));

    const events: Event[] = [];
    for await (const event of replayFromTimestamp(store, '2020-01-01T00:00:00Z', { correlation_id: 'corr-1' })) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
  });

  it('should replay with causation_id filter', async () => {
    await store.append(makeEvent({ timestamp: '2026-01-01T00:00:00Z', causation_id: 'cause-1' }));
    await store.append(makeEvent({ timestamp: '2026-01-01T00:00:00Z', causation_id: 'cause-2' }));

    const events: Event[] = [];
    for await (const event of replayFromTimestamp(store, '2020-01-01T00:00:00Z', { causation_id: 'cause-1' })) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
  });

  it('should replay with workspace_id filter', async () => {
    const wsId = asUUID(crypto.randomUUID());
    await store.append(makeEvent({ timestamp: '2026-01-01T00:00:00Z', workspace_id: wsId }));
    await store.append(makeEvent({ timestamp: '2026-01-01T00:00:00Z', workspace_id: asUUID(crypto.randomUUID()) }));

    const events: Event[] = [];
    for await (const event of replayFromTimestamp(store, '2020-01-01T00:00:00Z', { workspace_id: wsId })) {
      events.push(event);
    }
    expect(events).toHaveLength(1);
  });
});

describe('replayForEntity with non-object data', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  it('should handle events with non-object data gracefully', async () => {
    // Event where data is not an object — applyEvent should skip it
    const event = makeEvent({
      data: 'not-an-object',
    });
    // Manually add to eventsBySequence via getEventsForEntity path
    // Since getEventsForEntity checks data.entity_type, this won't be found
    // Instead test directly via the store
    await store.append(makeEntityEvent('task', 'task-1', { status: 'pending' }));
    await store.append({
      ...makeEvent(),
      data: 'non-object-data',
    });
    // The non-object event won't have entity_type/entity_id, so won't be found

    const state = await replayForEntity(store, 'task', 'task-1');
    const s = state as Record<string, unknown>;
    expect(s.status).toBe('pending');
  });
});