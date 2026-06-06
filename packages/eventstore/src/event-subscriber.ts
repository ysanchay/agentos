/**
 * @agentos/eventstore — Event Subscriber
 * Subscribe/unsubscribe with glob pattern matching for event types.
 * Matches events against registered subscriptions using micromatch-style glob patterns.
 */

import type { Event, SubscriptionID } from '@agentos/types';

// ─── Subscription Record ─────────────────────────────────────────────

interface Subscription {
  id: SubscriptionID;
  eventTypes: string[];       // Glob patterns e.g. ["task.*", "agent.error"]
  filter?: Record<string, unknown>; // Additional metadata filters
}

// ─── EventSubscriber ─────────────────────────────────────────────────

export type { SubscriptionID };

export class EventSubscriber {
  private subscriptions: Map<string, Subscription> = new Map();

  /** Register a subscription for one or more event type patterns */
  subscribe(
    subscriptionId: SubscriptionID,
    eventTypes: string[],
    filter?: Record<string, unknown>,
  ): void {
    if (this.subscriptions.has(subscriptionId)) {
      throw new Error(`Subscription ${subscriptionId} already exists`);
    }

    this.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      eventTypes,
      filter,
    });
  }

  /** Remove a subscription */
  unsubscribe(subscriptionId: SubscriptionID): void {
    if (!this.subscriptions.has(subscriptionId)) {
      throw new Error(`Subscription ${subscriptionId} does not exist`);
    }
    this.subscriptions.delete(subscriptionId);
  }

  /** Return all subscription IDs whose patterns match the given event */
  match(event: Event): SubscriptionID[] {
    const matched: SubscriptionID[] = [];

    for (const sub of this.subscriptions.values()) {
      if (this.matchesEvent(sub, event)) {
        matched.push(sub.id);
      }
    }

    return matched;
  }

  /** Check if a subscription exists */
  has(subscriptionId: SubscriptionID): boolean {
    return this.subscriptions.has(subscriptionId);
  }

  /** Get the number of active subscriptions */
  get size(): number {
    return this.subscriptions.size;
  }

  // ─── Private ──────────────────────────────────────────────────────

  private matchesEvent(sub: Subscription, event: Event): boolean {
    // Check if any of the subscription's event type patterns match
    const typeMatch = sub.eventTypes.some((pattern) => matchGlob(pattern, event.type));
    if (!typeMatch) return false;

    // If there's an additional filter, check it against event data
    if (sub.filter) {
      return this.matchesFilter(sub.filter, event);
    }

    return true;
  }

  private matchesFilter(filter: Record<string, unknown>, event: Event): boolean {
    const data = event.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return false;

    for (const [key, value] of Object.entries(filter)) {
      const eventValue = data[key];
      if (eventValue !== value) return false;
    }

    return true;
  }
}

// ─── Glob Matching ───────────────────────────────────────────────────

/**
 * Simple glob matching supporting:
 * - `*` matches any sequence of characters except `.`
 * - `**` matches any sequence of characters including `.`
 * - `?` matches any single character
 * - Literal `.` matches `.`
 */
function matchGlob(pattern: string, value: string): boolean {
  const regexStr = globToRegex(pattern);
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(value);
}

function globToRegex(pattern: string): string {
  let result = '';
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i]!; // Safe: loop condition guarantees i < pattern.length

    if (char === '*') {
      if (i + 1 < pattern.length && pattern[i + 1] === '*') {
        result += '.*';
        i += 2;
      } else {
        result += '[^.]*';
        i++;
      }
    } else if (char === '?') {
      result += '.';
      i++;
    } else if (isRegexSpecial(char)) {
      result += `\\${char}`;
      i++;
    } else {
      result += char;
      i++;
    }
  }

  return result;
}

function isRegexSpecial(char: string): boolean {
  return '.+^${}()|[]\\/'.includes(char);
}