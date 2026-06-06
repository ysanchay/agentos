/**
 * Tests for @agentos/eventstore — Event Subscriber
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EventSubscriber } from '../src/event-subscriber.js';
import { EventDomain } from '@agentos/types';
import type { Event, SubscriptionID, EventID } from '@agentos/types';
import { asUUID } from '@agentos/types';

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: asUUID<EventID>(crypto.randomUUID()),
    domain: EventDomain.TASK,
    type: 'task.created',
    source: 'agent-1',
    data: { name: 'Test Task', priority: 'high' },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('EventSubscriber', () => {
  let subscriber: EventSubscriber;

  beforeEach(() => {
    subscriber = new EventSubscriber();
  });

  describe('subscribe', () => {
    it('should register a subscription', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.*']);

      expect(subscriber.has(subId)).toBe(true);
      expect(subscriber.size).toBe(1);
    });

    it('should register multiple subscriptions', () => {
      const sub1 = asUUID<SubscriptionID>(crypto.randomUUID());
      const sub2 = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(sub1, ['task.*']);
      subscriber.subscribe(sub2, ['agent.*']);

      expect(subscriber.size).toBe(2);
    });

    it('should throw for duplicate subscription IDs', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.*']);

      expect(() => subscriber.subscribe(subId, ['agent.*'])).toThrow(/already exists/);
    });

    it('should register subscription with multiple event type patterns', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.*', 'agent.error']);

      expect(subscriber.has(subId)).toBe(true);
    });

    it('should register subscription with metadata filter', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.*'], { priority: 'high' });

      expect(subscriber.has(subId)).toBe(true);
    });
  });

  describe('unsubscribe', () => {
    it('should remove a subscription', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.*']);
      subscriber.unsubscribe(subId);

      expect(subscriber.has(subId)).toBe(false);
      expect(subscriber.size).toBe(0);
    });

    it('should throw for non-existent subscription', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      expect(() => subscriber.unsubscribe(subId)).toThrow(/does not exist/);
    });
  });

  describe('match', () => {
    it('should match events by exact type', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.created']);

      const event = makeEvent({ type: 'task.created' });
      const matched = subscriber.match(event);

      expect(matched).toContain(subId);
    });

    it('should match events by glob pattern (single *)', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.*']);

      const event = makeEvent({ type: 'task.created' });
      const matched = subscriber.match(event);

      expect(matched).toContain(subId);
    });

    it('should match events by glob pattern across sub-domains (**)', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['**.error']);

      const event = makeEvent({ type: 'agent.runtime.error' });
      const matched = subscriber.match(event);

      expect(matched).toContain(subId);
    });

    it('should not match events that do not fit the pattern', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.*']);

      const event = makeEvent({ type: 'agent.spawned' });
      const matched = subscriber.match(event);

      expect(matched).not.toContain(subId);
    });

    it('should match multiple subscriptions for the same event', () => {
      const sub1 = asUUID<SubscriptionID>(crypto.randomUUID());
      const sub2 = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(sub1, ['task.*']);
      subscriber.subscribe(sub2, ['task.created']);

      const event = makeEvent({ type: 'task.created' });
      const matched = subscriber.match(event);

      expect(matched).toContain(sub1);
      expect(matched).toContain(sub2);
    });

    it('should apply metadata filter when present', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.*'], { priority: 'high' });

      const highPriorityEvent = makeEvent({ type: 'task.created', data: { priority: 'high' } });
      const lowPriorityEvent = makeEvent({ type: 'task.created', data: { priority: 'low' } });

      expect(subscriber.match(highPriorityEvent)).toContain(subId);
      expect(subscriber.match(lowPriorityEvent)).not.toContain(subId);
    });

    it('should return empty array when no subscriptions match', () => {
      subscriber.subscribe(asUUID<SubscriptionID>(crypto.randomUUID()), ['agent.*']);

      const event = makeEvent({ type: 'task.created' });
      const matched = subscriber.match(event);

      expect(matched).toHaveLength(0);
    });

    it('should handle ? wildcard matching single character', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      // "task.created" = "task." + "created" (7 chars). 6 ?s match "create", literal "d" matches "d"
      subscriber.subscribe(subId, ['task.??????d']);

      const event = makeEvent({ type: 'task.created' });
      const matched = subscriber.match(event);

      expect(matched).toContain(subId);
    });
  });

  describe('glob patterns', () => {
    it('task.* should match task.created but not task.sub.created', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.*']);

      expect(subscriber.match(makeEvent({ type: 'task.created' }))).toContain(subId);
      expect(subscriber.match(makeEvent({ type: 'task.sub.created' }))).not.toContain(subId);
    });

    it('**.created should match task.created and agent.sub.created', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['**.created']);

      expect(subscriber.match(makeEvent({ type: 'task.created' }))).toContain(subId);
      expect(subscriber.match(makeEvent({ type: 'agent.sub.created' }))).toContain(subId);
    });

    it('exact type should match only that type', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.created']);

      expect(subscriber.match(makeEvent({ type: 'task.created' }))).toContain(subId);
      expect(subscriber.match(makeEvent({ type: 'task.completed' }))).not.toContain(subId);
    });
  });

  describe('metadata filter edge cases', () => {
    it('should not match when event data is not an object', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.*'], { priority: 'high' });

      const eventWithNonObjectData = makeEvent({ type: 'task.created', data: 'not-an-object' });
      const matched = subscriber.match(eventWithNonObjectData);
      expect(matched).not.toContain(subId);
    });

    it('should not match when event data is null', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.*'], { priority: 'high' });

      const eventWithNullData = makeEvent({ type: 'task.created', data: null });
      const matched = subscriber.match(eventWithNullData);
      expect(matched).not.toContain(subId);
    });

    it('should not match when event data has mismatched filter values', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.*'], { priority: 'critical' });

      const event = makeEvent({ type: 'task.created', data: { priority: 'low' } });
      const matched = subscriber.match(event);
      expect(matched).not.toContain(subId);
    });

    it('should match when filter value matches event data value', () => {
      const subId = asUUID<SubscriptionID>(crypto.randomUUID());
      subscriber.subscribe(subId, ['task.*'], { category: 'build' });

      const event = makeEvent({ type: 'task.created', data: { category: 'build', priority: 'high' } });
      const matched = subscriber.match(event);
      expect(matched).toContain(subId);
    });
  });
});