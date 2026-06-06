/**
 * Tests for EventBus
 */

import { describe, it, expect, vi } from 'vitest';
import { EventDomain, createUUID, asUUID } from '@agentos/types';
import type { Event, EventID } from '@agentos/types';
import { EventBus } from '../src/event-bus.js';

const makeEvent = (overrides: Partial<Event> = {}): Event => ({
  id: asUUID<EventID>(createUUID()),
  domain: EventDomain.AGENT,
  type: 'test.event',
  source: 'test',
  target: undefined,
  data: {},
  timestamp: new Date().toISOString(),
  correlation_id: undefined,
  causation_id: undefined,
  workspace_id: undefined,
  ...overrides,
});

describe('EventBus', () => {
  it('publishes an event', () => {
    const bus = new EventBus();
    const event = makeEvent();
    bus.publish(event);
    expect(bus.getHistory()).toHaveLength(1);
  });

  it('subscribes to a domain and receives events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe(EventDomain.AGENT, handler);
    bus.publish(makeEvent({ domain: EventDomain.AGENT }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('domain subscriber does not receive events from other domains', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe(EventDomain.AGENT, handler);
    bus.publish(makeEvent({ domain: EventDomain.TASK }));
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it('unsubscribes from events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const subId = bus.subscribe(EventDomain.AGENT, handler);
    bus.unsubscribe(subId);
    bus.publish(makeEvent({ domain: EventDomain.AGENT }));
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it('subscribes to entity events', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const entityId = 'entity-123';
    bus.subscribeToEntity(entityId, handler);
    bus.publish(makeEvent({
      domain: EventDomain.AGENT,
      data: { entity_id: entityId },
    }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('entity subscriber filters non-matching entities', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribeToEntity('entity-123', handler);
    bus.publish(makeEvent({
      domain: EventDomain.AGENT,
      data: { entity_id: 'entity-456' },
    }));
    expect(handler).toHaveBeenCalledTimes(0);
  });

  it('getHistory returns all events', () => {
    const bus = new EventBus();
    bus.publish(makeEvent());
    bus.publish(makeEvent());
    expect(bus.getHistory()).toHaveLength(2);
  });

  it('getHistory filters by domain', () => {
    const bus = new EventBus();
    bus.publish(makeEvent({ domain: EventDomain.AGENT }));
    bus.publish(makeEvent({ domain: EventDomain.TASK }));
    expect(bus.getHistory(EventDomain.AGENT)).toHaveLength(1);
  });

  it('getHistory limits results', () => {
    const bus = new EventBus();
    bus.publish(makeEvent());
    bus.publish(makeEvent());
    bus.publish(makeEvent());
    expect(bus.getHistory(undefined, 2)).toHaveLength(2);
  });

  it('createEvent generates a valid event', () => {
    const bus = new EventBus();
    const event = bus.createEvent(EventDomain.TASK, 'task.created', 'kernel', { foo: 'bar' });
    expect(event.domain).toBe(EventDomain.TASK);
    expect(event.type).toBe('task.created');
    expect(event.source).toBe('kernel');
    expect(event.id).toBeDefined();
    expect(event.timestamp).toBeDefined();
  });

  it('handler errors do not block other subscribers', () => {
    const bus = new EventBus();
    const badHandler = vi.fn(() => { throw new Error('boom'); });
    const goodHandler = vi.fn();

    bus.subscribe(EventDomain.AGENT, badHandler);
    bus.subscribe(EventDomain.AGENT, goodHandler);

    bus.publish(makeEvent({ domain: EventDomain.AGENT }));

    expect(badHandler).toHaveBeenCalledTimes(1);
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  it('clear removes all subscriptions and history', () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.subscribe(EventDomain.AGENT, handler);
    bus.publish(makeEvent());
    bus.clear();
    expect(bus.getHistory()).toHaveLength(0);
  });

  it('multiple subscribers receive the same event', () => {
    const bus = new EventBus();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    bus.subscribe(EventDomain.AGENT, handler1);
    bus.subscribe(EventDomain.AGENT, handler2);
    bus.publish(makeEvent({ domain: EventDomain.AGENT }));
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });
});