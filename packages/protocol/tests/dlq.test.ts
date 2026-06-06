import { describe, it, expect } from 'vitest';
import { DeadLetterQueue } from '../src/dlq.js';
import { buildMessage } from '../src/message.js';

describe('dlq', () => {
  describe('DeadLetterQueue', () => {
    function createTestMessage(id: string) {
      return buildMessage('task.create', 'general', 3, 'agent-1' as any, 'agent-2' as any, { title: `Test ${id}` });
    }

    it('enqueues a failed message', () => {
      const dlq = new DeadLetterQueue();
      const msg = createTestMessage('1');
      const entry = dlq.enqueue(msg, 'timeout');
      expect(entry.failureReason).toBe('timeout');
      expect(entry.canReplay).toBe(true);
      expect(dlq.size()).toBe(1);
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
    });

    it('marks entry as non-replayable after max retries', () => {
      const dlq = new DeadLetterQueue();
      dlq.setReplayHandler(() => ({ ok: true as const, data: undefined }));

      const msg = createTestMessage('1');
      const entry = dlq.enqueue(msg, 'timeout', { maxRetries: 2 });
      dlq.replay(entry.id);
      dlq.replay(entry.id);
      expect(entry.canReplay).toBe(false);
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
      const dlq = new DeadLetterQueue({ retentionDays: 0 }); // 0 days = everything expires
      dlq.enqueue(createTestMessage('1'), 'timeout');
      // Force the entry to be old
      const entry = dlq.getEntry('dlq-1');
      if (entry) {
        entry.enqueuedAt = new Date(Date.now() - 86_400_000 * 2).toISOString();
      }

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

    it('getEntry returns entry by id', () => {
      const dlq = new DeadLetterQueue();
      const entry = dlq.enqueue(createTestMessage('1'), 'timeout');
      expect(dlq.getEntry(entry.id)).toBe(entry);
    });
  });
});