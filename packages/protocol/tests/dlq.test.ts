import { describe, it, expect } from 'vitest';
import { DeadLetterQueue } from '../src/dlq.js';
import { buildMessage } from '../src/message.js';
import { createUUID, asUUID } from '@agentos/types';
import type { AgentID } from '@agentos/types';

function makeAgentId(): AgentID {
  return asUUID<AgentID>(createUUID());
}

function createTestMessage(id: string) {
  return buildMessage('task.create', 'general', 3, makeAgentId(), makeAgentId(), { title: `Test ${id}` });
}

describe('dlq', () => {
  describe('DeadLetterQueue', () => {
    it('enqueues a failed message', () => {
      const dlq = new DeadLetterQueue();
      const msg = createTestMessage('1');
      const entry = dlq.enqueue(msg, 'timeout');
      expect(entry.failureReason).toBe('timeout');
      expect(entry.canReplay).toBe(true);
      expect(entry.retryAttempts).toBe(0);
      expect(dlq.size()).toBe(1);
    });

    it('enqueues with custom retry options', () => {
      const dlq = new DeadLetterQueue();
      const msg = createTestMessage('1');
      const entry = dlq.enqueue(msg, 'timeout', { retryAttempts: 2, maxRetries: 5 });
      expect(entry.retryAttempts).toBe(2);
      expect(entry.maxRetries).toBe(5);
    });

    it('inspects the queue', () => {
      const dlq = new DeadLetterQueue();
      dlq.enqueue(createTestMessage('1'), 'timeout');
      dlq.enqueue(createTestMessage('2'), 'rate_limit');
      dlq.enqueue(createTestMessage('3'), 'timeout');

      const result = dlq.inspect();
      expect(result.total).toBe(3);
      expect(result.byReason['timeout']).toBe(2);
      expect(result.byReason['rate_limit']).toBe(1);
      expect(result.oldestEntry).toBeTruthy();
    });

    it('inspects with filtering by reason', () => {
      const dlq = new DeadLetterQueue();
      dlq.enqueue(createTestMessage('1'), 'timeout');
      dlq.enqueue(createTestMessage('2'), 'rate_limit');

      const result = dlq.inspect({ reason: 'timeout' });
      expect(result.total).toBe(1);
      expect(result.entries[0]!.failureReason).toBe('timeout');
    });

    it('inspects with pagination', () => {
      const dlq = new DeadLetterQueue();
      dlq.enqueue(createTestMessage('1'), 'timeout');
      dlq.enqueue(createTestMessage('2'), 'timeout');
      dlq.enqueue(createTestMessage('3'), 'timeout');

      const result = dlq.inspect({ limit: 2, offset: 1 });
      expect(result.entries).toHaveLength(2);
    });

    it('inspects empty queue', () => {
      const dlq = new DeadLetterQueue();
      const result = dlq.inspect();
      expect(result.total).toBe(0);
      expect(result.entries).toHaveLength(0);
      expect(result.byReason).toEqual({});
      expect(result.oldestEntry).toBeUndefined();
    });

    it('replays a message', () => {
      const dlq = new DeadLetterQueue();
      let replayCount = 0;
      dlq.setReplayHandler(() => {
        replayCount++;
        return { ok: true as const, data: undefined };
      });

      const msg = createTestMessage('1');
      const entry = dlq.enqueue(msg, 'timeout');
      const result = dlq.replay(entry.id);
      expect(result.ok).toBe(true);
      expect(replayCount).toBe(1);
      expect(entry.lastReplayAttempt).toBeTruthy();
      expect(entry.replayResult).toBe('success');
    });

    it('replay records failure result', () => {
      const dlq = new DeadLetterQueue();
      dlq.setReplayHandler(() => ({ ok: false as const, error_code: 'ERR', error_message: 'fail' }));

      const msg = createTestMessage('1');
      const entry = dlq.enqueue(msg, 'timeout');
      const result = dlq.replay(entry.id);
      expect(result.ok).toBe(false);
      expect(entry.replayResult).toBe('failed');
    });

    it('marks entry as non-replayable after max retries', () => {
      const dlq = new DeadLetterQueue();
      dlq.setReplayHandler(() => ({ ok: true as const, data: undefined }));

      const msg = createTestMessage('1');
      const entry = dlq.enqueue(msg, 'timeout', { maxRetries: 2 });
      dlq.replay(entry.id);
      expect(entry.canReplay).toBe(true); // 1 attempt, max is 2
      dlq.replay(entry.id);
      expect(entry.canReplay).toBe(false); // 2 attempts reached max
    });

    it('replayAll replays all eligible entries', () => {
      const dlq = new DeadLetterQueue();
      dlq.setReplayHandler(() => ({ ok: true as const, data: undefined }));

      dlq.enqueue(createTestMessage('1'), 'timeout');
      dlq.enqueue(createTestMessage('2'), 'timeout');
      dlq.enqueue(createTestMessage('3'), 'timeout');

      const result = dlq.replayAll();
      expect(result.succeeded).toBe(3);
      expect(result.failed).toBe(0);
    });

    it('replayAll skips non-replayable entries', () => {
      const dlq = new DeadLetterQueue();
      dlq.setReplayHandler(() => ({ ok: true as const, data: undefined }));

      const entry1 = dlq.enqueue(createTestMessage('1'), 'timeout', { maxRetries: 1 });
      dlq.replay(entry1.id); // makes it non-replayable
      dlq.enqueue(createTestMessage('2'), 'timeout');

      const result = dlq.replayAll();
      expect(result.succeeded).toBe(1); // only entry2
    });

    it('removes a specific entry', () => {
      const dlq = new DeadLetterQueue();
      const entry = dlq.enqueue(createTestMessage('1'), 'timeout');
      dlq.enqueue(createTestMessage('2'), 'timeout');

      const result = dlq.remove(entry.id);
      expect(result.ok).toBe(true);
      expect(dlq.size()).toBe(1);
    });

    it('returns error when removing non-existent entry', () => {
      const dlq = new DeadLetterQueue();
      const result = dlq.remove('nonexistent');
      expect(result.ok).toBe(false);
    });

    it('clears all entries', () => {
      const dlq = new DeadLetterQueue();
      dlq.enqueue(createTestMessage('1'), 'timeout');
      dlq.enqueue(createTestMessage('2'), 'timeout');
      dlq.clear();
      expect(dlq.size()).toBe(0);
    });

    it('purges expired entries', () => {
      const dlq = new DeadLetterQueue({ retentionDays: 7 });
      dlq.enqueue(createTestMessage('1'), 'timeout');
      // Entry is fresh, should not be purged
      const purged = dlq.purgeExpired();
      expect(purged).toBe(0);
      expect(dlq.size()).toBe(1);
    });

    it('purges entries that exceed retention', () => {
      const dlq = new DeadLetterQueue({ retentionDays: 7 });
      const entry = dlq.enqueue(createTestMessage('1'), 'timeout');
      // Manually age the entry
      entry.enqueuedAt = new Date(Date.now() - 8 * 86_400_000).toISOString();
      const purged = dlq.purgeExpired();
      expect(purged).toBe(1);
      expect(dlq.size()).toBe(0);
    });

    it('returns error for replay without handler', () => {
      const dlq = new DeadLetterQueue();
      const entry = dlq.enqueue(createTestMessage('1'), 'timeout');
      const result = dlq.replay(entry.id);
      expect(result.ok).toBe(false);
    });

    it('returns error for replay of non-existent entry', () => {
      const dlq = new DeadLetterQueue();
      dlq.setReplayHandler(() => ({ ok: true as const, data: undefined }));
      const result = dlq.replay('nonexistent');
      expect(result.ok).toBe(false);
    });

    it('returns error for replay of non-replayable entry', () => {
      const dlq = new DeadLetterQueue();
      dlq.setReplayHandler(() => ({ ok: true as const, data: undefined }));
      const entry = dlq.enqueue(createTestMessage('1'), 'timeout', { maxRetries: 1 });
      dlq.replay(entry.id); // exhaust retries
      const result = dlq.replay(entry.id);
      expect(result.ok).toBe(false);
    });

    it('getEntry returns entry by id', () => {
      const dlq = new DeadLetterQueue();
      const entry = dlq.enqueue(createTestMessage('1'), 'timeout');
      expect(dlq.getEntry(entry.id)).toBe(entry);
    });

    it('getEntry returns undefined for unknown id', () => {
      const dlq = new DeadLetterQueue();
      expect(dlq.getEntry('nonexistent')).toBeUndefined();
    });

    it('enqueue purges expired entries first', () => {
      const dlq = new DeadLetterQueue({ retentionDays: 0 });
      // With 0-day retention, entries should be purged on next enqueue
      dlq.enqueue(createTestMessage('1'), 'timeout');
      // Manually age
      const entry = dlq.getEntry('dlq-1');
      if (entry) entry.enqueuedAt = new Date(Date.now() - 86_400_000 * 2).toISOString();

      dlq.enqueue(createTestMessage('2'), 'timeout');
      expect(dlq.size()).toBe(1); // Only the new entry remains
    });
  });
});