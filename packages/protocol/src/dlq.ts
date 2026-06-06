/**
 * DeadLetterQueue: enqueue failed messages, inspect, replay, 7-day retention
 */

import type { ACPMessage, MessageType, AgentID } from '@agentos/types';
import { DLQ_RETENTION_DAYS } from '@agentos/types';
import { ok, err } from '@agentos/types';
import type { Outcome } from '@agentos/types';
import type { DeadLetterPayload } from '@agentos/types';

export interface DeadLetterEntry {
  id: string;
  originalMessage: ACPMessage;
  failureReason: string;
  retryAttempts: number;
  maxRetries: number;
  enqueuedAt: string; // ISO 8601
  lastReplayAttempt?: string;
  replayResult?: 'success' | 'failed';
  canReplay: boolean;
}

export interface DLQInspectResult {
  total: number;
  entries: DeadLetterEntry[];
  byReason: Record<string, number>;
  oldestEntry?: string;
}

export type ReplayHandler = (message: ACPMessage) => Outcome<unknown>;

const MS_PER_DAY = 86_400_000;

/**
 * DeadLetterQueue stores messages that failed delivery or processing.
 * Entries are automatically removed after the retention period (default 7 days).
 */
export class DeadLetterQueue {
  private queue: DeadLetterEntry[] = [];
  private replayHandler?: ReplayHandler;
  private retentionDays: number;
  private nextId = 0;

  constructor(opts?: { retentionDays?: number }) {
    this.retentionDays = opts?.retentionDays ?? DLQ_RETENTION_DAYS;
  }

  /**
   * Set the handler that will be used to replay messages.
   */
  setReplayHandler(handler: ReplayHandler): void {
    this.replayHandler = handler;
  }

  /**
   * Enqueue a failed message into the DLQ.
   */
  enqueue(
    message: ACPMessage,
    failureReason: string,
    opts?: { retryAttempts?: number; maxRetries?: number },
  ): DeadLetterEntry {
    // Purge expired entries first
    this.purgeExpired();

    const entry: DeadLetterEntry = {
      id: `dlq-${++this.nextId}`,
      originalMessage: message,
      failureReason,
      retryAttempts: opts?.retryAttempts ?? 0,
      maxRetries: opts?.maxRetries ?? 3,
      enqueuedAt: new Date().toISOString(),
      canReplay: true,
    };

    this.queue.push(entry);
    return entry;
  }

  /**
   * Inspect the DLQ, returning summary stats and optional filtered entries.
   */
  inspect(opts?: { limit?: number; offset?: number; reason?: string }): DLQInspectResult {
    this.purgeExpired();

    let entries = this.queue;
    if (opts?.reason) {
      entries = entries.filter((e) => e.failureReason === opts.reason);
    }

    const byReason: Record<string, number> = {};
    for (const entry of entries) {
      byReason[entry.failureReason] = (byReason[entry.failureReason] ?? 0) + 1;
    }

    const oldestEntry = entries.length > 0 ? entries[0]!.enqueuedAt : undefined;

    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? entries.length;
    const paginated = entries.slice(offset, offset + limit);

    return {
      total: entries.length,
      entries: paginated,
      byReason,
      oldestEntry,
    };
  }

  /**
   * Replay a specific DLQ entry by ID.
   * Requires a replay handler to be set.
   */
  replay(entryId: string): Outcome<unknown> {
    const entry = this.queue.find((e) => e.id === entryId);
    if (!entry) {
      return err('KER-0001', `DLQ entry ${entryId} not found`);
    }
    if (!entry.canReplay) {
      return err('ACP-E022', 'DLQ entry cannot be replayed');
    }
    if (!this.replayHandler) {
      return err('ACP-E022', 'No replay handler registered');
    }

    entry.retryAttempts++;
    entry.lastReplayAttempt = new Date().toISOString();

    if (entry.retryAttempts >= entry.maxRetries) {
      entry.canReplay = false;
    }

    const result = this.replayHandler(entry.originalMessage);
    entry.replayResult = result.ok ? 'success' : 'failed';
    return result;
  }

  /**
   * Replay all eligible entries in the DLQ.
   * Returns count of successful and failed replays.
   */
  replayAll(): { succeeded: number; failed: number } {
    let succeeded = 0;
    let failed = 0;

    for (const entry of this.queue) {
      if (!entry.canReplay) continue;
      const result = this.replay(entry.id);
      if (result.ok) {
        succeeded++;
      } else {
        failed++;
      }
    }

    return { succeeded, failed };
  }

  /**
   * Remove a specific entry from the DLQ.
   */
  remove(entryId: string): Outcome<true> {
    const index = this.queue.findIndex((e) => e.id === entryId);
    if (index === -1) {
      return err('KER-0001', `DLQ entry ${entryId} not found`);
    }
    this.queue.splice(index, 1);
    return ok(true);
  }

  /**
   * Clear all entries from the DLQ.
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Get the current size of the DLQ.
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Purge entries that have exceeded the retention period.
   */
  purgeExpired(): number {
    const cutoff = Date.now() - this.retentionDays * MS_PER_DAY;
    const before = this.queue.length;
    this.queue = this.queue.filter((entry) => {
      return new Date(entry.enqueuedAt).getTime() > cutoff;
    });
    return before - this.queue.length;
  }

  /**
   * Get a specific entry by ID.
   */
  getEntry(entryId: string): DeadLetterEntry | undefined {
    return this.queue.find((e) => e.id === entryId);
  }
}