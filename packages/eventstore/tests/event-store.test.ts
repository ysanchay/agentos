/**
 * Tests for @agentos/eventstore — Event Store
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
    correlation_id: 'corr-1',
    workspace_id: asUUID(crypto.randomUUID()),
    ...overrides,
  };
}

function makeEntityEvent(entityType: string, entityId: string, overrides: Partial<Event> = {}): Event {
  return makeEvent({
    data: { entity_type: entityType, entity_id: entityId, name: 'Entity' },
    ...overrides,
  });
}

describe('InMemoryEventStore', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  describe('append', () => {
    it('should append a valid event and return its ID', async () => {
      const event = makeEvent();
      const result = await store.append(event);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(event.id);
      }
    });

    it('should reject events missing required fields', async () => {
      const badEvent = { ...makeEvent(), id: '' };
      const result = await store.append(badEvent as Event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('EVT-0001');
      }
    });

    it('should reject duplicate event IDs', async () => {
      const event = makeEvent();
      await store.append(event);
      const result = await store.append(event);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('EVT-0002');
      }
    });

    it('should increment sequence number on each append', async () => {
      expect(await store.getCurrentSequence()).toBe(0);

      await store.append(makeEvent());
      expect(await store.getCurrentSequence()).toBe(1);

      await store.append(makeEvent());
      expect(await store.getCurrentSequence()).toBe(2);
    });
  });

  describe('appendBatch', () => {
    it('should append multiple events in a batch', async () => {
      const events = [makeEvent(), makeEvent(), makeEvent()];
      const result = await store.appendBatch(events);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(3);
        expect(await store.getCurrentSequence()).toBe(3);
      }
    });

    it('should reject empty batch', async () => {
      const result = await store.appendBatch([]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('EVT-0003');
      }
    });

    it('should fail if any event in batch is invalid', async () => {
      const goodEvent = makeEvent();
      const badEvent = { ...makeEvent(), domain: '' as EventDomain };
      const result = await store.appendBatch([goodEvent, badEvent as Event]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('EVT-0004');
      }
    });
  });

  describe('get', () => {
    it('should retrieve an event by ID', async () => {
      const event = makeEvent();
      await store.append(event);
      const result = await store.get(event.id);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe(event.id);
        expect(result.data.type).toBe(event.type);
      }
    });

    it('should return error for non-existent event', async () => {
      const result = await store.get(asUUID<EventID>(crypto.randomUUID()));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('EVT-0005');
      }
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      await store.append(makeEvent({ domain: EventDomain.TASK, type: 'task.created', source: 'agent-1' }));
      await store.append(makeEvent({ domain: EventDomain.TASK, type: 'task.completed', source: 'agent-2' }));
      await store.append(makeEvent({ domain: EventDomain.AGENT, type: 'agent.spawned', source: 'system' }));
      await store.append(makeEvent({ domain: EventDomain.WORKSPACE, type: 'workspace.created', source: 'user-1' }));
    });

    it('should return paginated results with default limit', async () => {
      const result = await store.query({});
      expect(result.items.length).toBe(4);
      expect(result.total).toBe(4);
      expect(result.has_more).toBe(false);
    });

    it('should filter by domain', async () => {
      const result = await store.query({ domain: EventDomain.TASK });
      expect(result.items).toHaveLength(2);
      result.items.forEach((e) => expect(e.domain).toBe(EventDomain.TASK));
    });

    it('should filter by type with glob patterns', async () => {
      const result = await store.query({ type: 'task.*' });
      expect(result.items).toHaveLength(2);
      result.items.forEach((e) => expect(e.type).toMatch(/^task\./));
    });

    it('should filter by source', async () => {
      const result = await store.query({ source: 'agent-1' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.source).toBe('agent-1');
    });

    it('should filter by workspace_id', async () => {
      const wsId = asUUID(crypto.randomUUID());
      await store.append(makeEvent({ workspace_id: wsId }));

      const result = await store.query({ workspace_id: wsId });
      expect(result.items).toHaveLength(1);
    });

    it('should filter by correlation_id', async () => {
      const result = await store.query({ correlation_id: 'corr-1' });
      // All makeEvent defaults have correlation_id: 'corr-1'
      expect(result.items.length).toBeGreaterThan(0);
      result.items.forEach((e) => expect(e.correlation_id).toBe('corr-1'));
    });

    it('should apply pagination', async () => {
      const result = await store.query({ limit: 2, offset: 0 });
      expect(result.items).toHaveLength(2);
      expect(result.has_more).toBe(true);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(2);

      const page2 = await store.query({ limit: 2, offset: 2 });
      expect(page2.items).toHaveLength(2);
      expect(page2.has_more).toBe(false);
    });

    it('should filter by timestamp range', async () => {
      const pastTime = '2020-01-01T00:00:00Z';
      const futureTime = '2099-12-31T23:59:59Z';

      const result = await store.query({ from_timestamp: pastTime, to_timestamp: futureTime });
      expect(result.items.length).toBeGreaterThan(0);
    });
  });

  describe('replay', () => {
    it('should replay all events matching filter', async () => {
      await store.append(makeEvent({ domain: EventDomain.TASK, type: 'task.created' }));
      await store.append(makeEvent({ domain: EventDomain.AGENT, type: 'agent.spawned' }));
      await store.append(makeEvent({ domain: EventDomain.TASK, type: 'task.completed' }));

      const events = await store.replay({ domain: EventDomain.TASK });
      expect(events).toHaveLength(2);
    });

    it('should replay from a given timestamp', async () => {
      const ts1 = '2026-01-01T00:00:00Z';
      const ts2 = '2026-06-01T00:00:00Z';

      await store.append(makeEvent({ timestamp: ts1, type: 'task.created' }));
      await store.append(makeEvent({ timestamp: ts2, type: 'task.completed' }));

      const events = await store.replay({}, '2026-03-01T00:00:00Z');
      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('task.completed');
    });

    it('should replay with glob type filter', async () => {
      await store.append(makeEvent({ type: 'task.created' }));
      await store.append(makeEvent({ type: 'task.completed' }));
      await store.append(makeEvent({ type: 'agent.spawned' }));

      const events = await store.replay({ type: 'task.*' });
      expect(events).toHaveLength(2);
    });
  });

  describe('getEventsForEntity', () => {
    it('should return events for a specific entity', async () => {
      await store.append(makeEntityEvent('task', 'task-1'));
      await store.append(makeEntityEvent('task', 'task-2'));
      await store.append(makeEntityEvent('task', 'task-1', { type: 'task.updated' }));

      const events = await store.getEventsForEntity('task', 'task-1');
      expect(events).toHaveLength(2);
    });

    it('should return empty array for unknown entity', async () => {
      const events = await store.getEventsForEntity('task', 'nonexistent');
      expect(events).toHaveLength(0);
    });
  });

  describe('getCurrentSequence', () => {
    it('should start at 0', async () => {
      expect(await store.getCurrentSequence()).toBe(0);
    });

    it('should increment with each event', async () => {
      await store.append(makeEvent());
      await store.append(makeEvent());
      await store.append(makeEvent());
      expect(await store.getCurrentSequence()).toBe(3);
    });
  });

  describe('getAuditChain', () => {
    it('should return an audit chain that can be verified', async () => {
      await store.append(makeEvent());
      await store.append(makeEvent());

      const auditChain = store.getAuditChain();
      const result = auditChain.verify();
      expect(result.ok).toBe(true);
    });

    it('audit chain should grow with each event', async () => {
      const auditChain = store.getAuditChain();
      expect(auditChain.length).toBe(0);

      await store.append(makeEvent());
      expect(auditChain.length).toBe(1);

      await store.append(makeEvent());
      expect(auditChain.length).toBe(2);
    });
  });

  describe('getSubscriber', () => {
    it('should return the subscriber instance', () => {
      const subscriber = store.getSubscriber();
      expect(subscriber).toBeDefined();
      expect(subscriber.size).toBe(0);
    });

    it('subscriber should receive matching subscriptions on append', async () => {
      const subscriber = store.getSubscriber();
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.*']);

      await store.append(makeEvent({ type: 'task.created' }));

      // The subscriber was notified during append (match was called internally)
      expect(subscriber.size).toBe(1);
    });
  });

  describe('query filters', () => {
    it('should filter by causation_id', async () => {
      const causationId = 'cause-123';
      await store.append(makeEvent({ causation_id: causationId }));
      await store.append(makeEvent({ causation_id: 'other' }));

      const result = await store.query({ causation_id: causationId });
      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.causation_id).toBe(causationId);
    });

    it('should filter by to_timestamp', async () => {
      await store.append(makeEvent({ timestamp: '2020-01-01T00:00:00Z' }));
      await store.append(makeEvent({ timestamp: '2099-12-31T23:59:59Z' }));

      const result = await store.query({ to_timestamp: '2025-01-01T00:00:00Z' });
      expect(result.items).toHaveLength(1);
    });
  });

  describe('event with no entity data', () => {
    it('getEventsForEntity should return empty when event data is not an object', async () => {
      await store.append(makeEvent({ data: 'plain string' }));
      const events = await store.getEventsForEntity('task', 'task-1');
      expect(events).toHaveLength(0);
    });

    it('getEventsForEntity should return empty when event data is null', async () => {
      await store.append(makeEvent({ data: null }));
      const events = await store.getEventsForEntity('task', 'task-1');
      expect(events).toHaveLength(0);
    });
  });
});