/**
 * @agentos/eventstore — Event Store
 * In-memory immutable event store with hash-chained audit trail.
 * Every action in AgentOS becomes an event appended here.
 */

import type {
  Event,
  EventID,
  EventDomain,
  WorkspaceID,
  Outcome,
  PaginatedResult,
  ISO8601,
} from '@agentos/types';
import { ok, err } from '@agentos/types';
import { AuditChain } from './audit-chain.js';
import { EventSubscriber, type SubscriptionID } from './event-subscriber.js';

// ─── EventFilter ─────────────────────────────────────────────────────

export interface EventFilter {
  domain?: EventDomain;
  type?: string; // Supports glob: "task.*", "agent.error"
  source?: string;
  workspace_id?: WorkspaceID;
  correlation_id?: string;
  causation_id?: string;
  from_timestamp?: ISO8601;
  to_timestamp?: ISO8601;
  limit?: number;
  offset?: number;
}

// ─── IEventStore ─────────────────────────────────────────────────────

export interface IEventStore {
  append(event: Event): Promise<Outcome<EventID>>;
  appendBatch(events: Event[]): Promise<Outcome<EventID[]>>;
  get(eventId: EventID): Promise<Outcome<Event>>;
  query(filter: EventFilter): Promise<PaginatedResult<Event>>;
  replay(filter: EventFilter, fromTimestamp?: ISO8601): Promise<Event[]>;
  getEventsForEntity(entityType: string, entityId: string): Promise<Event[]>;
  getCurrentSequence(): Promise<number>;
}

// ─── InMemoryEventStore ──────────────────────────────────────────────

export class InMemoryEventStore implements IEventStore {
  private events: Map<string, Event> = new Map();
  private eventsBySequence: Event[] = [];
  private auditChain: AuditChain;
  private subscriber: EventSubscriber;
  private sequence: number = 0;

  constructor() {
    this.auditChain = new AuditChain();
    this.subscriber = new EventSubscriber();
  }

  /** Append a single event to the store */
  async append(event: Event): Promise<Outcome<EventID>> {
    // Validate event has required fields
    if (!event.id || !event.domain || !event.type || !event.timestamp) {
      return err('EVT-0001', 'Event missing required fields (id, domain, type, timestamp)', {
        retryable: false,
      });
    }

    // Check for duplicate
    if (this.events.has(event.id)) {
      return err('EVT-0002', `Event with id ${event.id} already exists`, {
        retryable: false,
      });
    }

    // Append to audit chain
    this.auditChain.append(event);

    // Store event
    this.events.set(event.id, event);
    this.eventsBySequence.push(event);
    this.sequence++;

    // Notify subscribers
    const matchedSubscriptionIds = this.subscriber.match(event);

    return ok(event.id);
  }

  /** Append multiple events in a batch */
  async appendBatch(events: Event[]): Promise<Outcome<EventID[]>> {
    if (events.length === 0) {
      return err('EVT-0003', 'Batch must contain at least one event', {
        retryable: false,
      });
    }

    const ids: EventID[] = [];

    for (const event of events) {
      const result = await this.append(event);
      if (!result.ok) {
        return err('EVT-0004', `Batch append failed at event ${event.id}: ${result.error_message}`, {
          retryable: false,
          details: { failed_event_id: event.id, error_code: result.error_code },
        });
      }
      ids.push(result.data);
    }

    return ok(ids);
  }

  /** Get an event by its ID */
  async get(eventId: EventID): Promise<Outcome<Event>> {
    const event = this.events.get(eventId);
    if (!event) {
      return err('EVT-0005', `Event ${eventId} not found`, { retryable: false });
    }
    return ok(event);
  }

  /** Query events with filters and pagination */
  async query(filter: EventFilter): Promise<PaginatedResult<Event>> {
    let filtered = [...this.eventsBySequence];

    // Apply filters
    if (filter.domain !== undefined) {
      filtered = filtered.filter((e) => e.domain === filter.domain);
    }

    if (filter.type !== undefined) {
      const typePattern = filter.type;
      filtered = filtered.filter((e) => matchGlob(typePattern, e.type));
    }

    if (filter.source !== undefined) {
      filtered = filtered.filter((e) => e.source === filter.source);
    }

    if (filter.workspace_id !== undefined) {
      filtered = filtered.filter((e) => e.workspace_id === filter.workspace_id);
    }

    if (filter.correlation_id !== undefined) {
      filtered = filtered.filter((e) => e.correlation_id === filter.correlation_id);
    }

    if (filter.causation_id !== undefined) {
      filtered = filtered.filter((e) => e.causation_id === filter.causation_id);
    }

    if (filter.from_timestamp !== undefined) {
      filtered = filtered.filter((e) => e.timestamp >= filter.from_timestamp!);
    }

    if (filter.to_timestamp !== undefined) {
      filtered = filtered.filter((e) => e.timestamp <= filter.to_timestamp!);
    }

    const total = filtered.length;
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 50;

    const items = filtered.slice(offset, offset + limit);

    return {
      items,
      total,
      offset,
      limit,
      has_more: offset + limit < total,
    };
  }

  /** Replay events matching filter, optionally from a given timestamp */
  async replay(filter: EventFilter, fromTimestamp?: ISO8601): Promise<Event[]> {
    const effectiveFilter: EventFilter = {
      ...filter,
      from_timestamp: fromTimestamp ?? filter.from_timestamp,
      limit: undefined,
      offset: undefined,
    };

    let filtered = [...this.eventsBySequence];

    if (effectiveFilter.domain !== undefined) {
      filtered = filtered.filter((e) => e.domain === effectiveFilter.domain);
    }

    if (effectiveFilter.type !== undefined) {
      const typePattern = effectiveFilter.type;
      filtered = filtered.filter((e) => matchGlob(typePattern, e.type));
    }

    if (effectiveFilter.source !== undefined) {
      filtered = filtered.filter((e) => e.source === effectiveFilter.source);
    }

    if (effectiveFilter.workspace_id !== undefined) {
      filtered = filtered.filter((e) => e.workspace_id === effectiveFilter.workspace_id);
    }

    if (effectiveFilter.correlation_id !== undefined) {
      filtered = filtered.filter((e) => e.correlation_id === effectiveFilter.correlation_id);
    }

    if (effectiveFilter.causation_id !== undefined) {
      filtered = filtered.filter((e) => e.causation_id === effectiveFilter.causation_id);
    }

    if (effectiveFilter.from_timestamp !== undefined) {
      filtered = filtered.filter((e) => e.timestamp >= effectiveFilter.from_timestamp!);
    }

    if (effectiveFilter.to_timestamp !== undefined) {
      filtered = filtered.filter((e) => e.timestamp <= effectiveFilter.to_timestamp!);
    }

    return filtered;
  }

  /** Get all events for a specific entity */
  async getEventsForEntity(entityType: string, entityId: string): Promise<Event[]> {
    return this.eventsBySequence.filter((e) => {
      const data = e.data as Record<string, unknown> | undefined;
      if (!data || typeof data !== 'object') return false;
      return data['entity_type'] === entityType && data['entity_id'] === entityId;
    });
  }

  /** Get the current sequence number (total events appended) */
  async getCurrentSequence(): Promise<number> {
    return this.sequence;
  }

  /** Get the audit chain (for verification) */
  getAuditChain(): AuditChain {
    return this.auditChain;
  }

  /** Get the subscriber (for external subscription management) */
  getSubscriber(): EventSubscriber {
    return this.subscriber;
  }
}

// ─── Glob Matching Helper ────────────────────────────────────────────

/**
 * Simple glob matching supporting:
 * - `*` matches any sequence of characters except `.`
 * - `**` matches any sequence of characters including `.`
 * - `?` matches any single character
 * - Literal `.` matches `.`
 */
function matchGlob(pattern: string, value: string): boolean {
  // Convert glob pattern to regex
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
      // Check for double star
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