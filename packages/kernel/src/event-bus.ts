/**
 * @agentos/kernel — Event Bus
 * Publish-subscribe event system for the kernel.
 * ZERO AI logic — deterministic event routing only.
 */

import { EventDomain, createUUID } from '@agentos/types';
import type { Event, EventID, EventDomain as ED } from '@agentos/types';
import type { IEventStore } from '@agentos/eventstore';

// ─── Subscription Types ─────────────────────────────────────────────

export interface Subscription {
  id: string;
  domain?: EventDomain;
  entityId?: string;
  handler: (event: Event) => void;
}

// ─── Event Bus ───────────────────────────────────────────────────────

export class EventBus {
  private subscriptions: Map<string, Subscription> = new Map();
  private eventHistory: Event[] = [];
  private eventStore?: IEventStore;
  private subscriptionCounter: number = 0;

  constructor(eventStore?: IEventStore) {
    this.eventStore = eventStore;
  }

  /** Publish an event to all matching subscribers. */
  publish(event: Event): void {
    // Store in local history
    this.eventHistory.push(event);

    // Persist to event store if provided
    if (this.eventStore) {
      this.eventStore.append(event).catch(() => {
        // Event store persistence failure is logged but does not block
        // the synchronous event bus operation
      });
    }

    // Notify subscribers
    for (const sub of this.subscriptions.values()) {
      // Domain filter
      if (sub.domain !== undefined && sub.domain !== event.domain) continue;

      // Entity filter
      if (sub.entityId !== undefined) {
        const data = event.data as Record<string, unknown> | undefined;
        if (!data || data['entity_id'] !== sub.entityId) continue;
      }

      try {
        sub.handler(event);
      } catch {
        // Handler errors are swallowed to prevent one bad handler from breaking others
      }
    }
  }

  /** Subscribe to events of a given domain. Returns subscription ID. */
  subscribe(domain: EventDomain, handler: (event: Event) => void): string {
    const id = `sub-${++this.subscriptionCounter}`;
    this.subscriptions.set(id, { id, domain, handler });
    return id;
  }

  /** Unsubscribe by subscription ID. */
  unsubscribe(subscriptionId: string): void {
    this.subscriptions.delete(subscriptionId);
  }

  /** Subscribe to events for a specific entity. Returns subscription ID. */
  subscribeToEntity(entityId: string, handler: (event: Event) => void): string {
    const id = `sub-${++this.subscriptionCounter}`;
    this.subscriptions.set(id, { id, entityId, handler });
    return id;
  }

  /** Get event history, optionally filtered by domain. */
  getHistory(domain?: EventDomain, limit?: number): Event[] {
    let result = [...this.eventHistory];

    if (domain !== undefined) {
      result = result.filter((e) => e.domain === domain);
    }

    if (limit !== undefined && limit > 0) {
      result = result.slice(-limit);
    }

    return result;
  }

  /** Create an event with auto-generated ID and timestamp. */
  createEvent(
    domain: EventDomain,
    type: string,
    source: string,
    data: unknown,
    opts?: { correlation_id?: string; workspace_id?: string },
  ): Event {
    return {
      id: createUUID() as unknown as EventID,
      domain,
      type,
      source,
      data,
      timestamp: new Date().toISOString(),
      correlation_id: opts?.correlation_id,
      workspace_id: opts?.workspace_id as undefined,
    };
  }

  /** Clear all subscriptions and history. */
  clear(): void {
    this.subscriptions.clear();
    this.eventHistory = [];
    this.subscriptionCounter = 0;
  }
}