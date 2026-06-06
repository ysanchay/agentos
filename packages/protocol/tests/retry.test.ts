import { describe, it, expect } from 'vitest';
import { calculateBackoff, createBackoffIterator, sleep } from '../src/retry.js';

describe('retry', () => {
  describe('calculateBackoff', () => {
    it('returns base delay for attempt 0', () => {
      const delay = calculateBackoff(0, { baseMs: 1000, maxDelayMs: 30000, jitterMs: 0 });
      expect(delay).toBe(1000);
    });

    it('doubles delay for each attempt', () => {
      const d0 = calculateBackoff(0, { baseMs: 1000, maxDelayMs: 30000, jitterMs: 0 });
      const d1 = calculateBackoff(1, { baseMs: 1000, maxDelayMs: 30000, jitterMs: 0 });
      const d2 = calculateBackoff(2, { baseMs: 1000, maxDelayMs: 30000, jitterMs: 0 });
      expect(d0).toBe(1000);
      expect(d1).toBe(2000);
      expect(d2).toBe(4000);
    });

    it('caps at maxDelay', () => {
      const delay = calculateBackoff(20, { baseMs: 1000, maxDelayMs: 30000, jitterMs: 0 });
      expect(delay).toBe(30000);
    });

    it('adds jitter within range', () => {
      // Run many times to verify jitter is within bounds
      let withinRange = true;
      for (let i = 0; i < 100; i++) {
        const delay = calculateBackoff(0, { baseMs: 1000, maxDelayMs: 30000, jitterMs: 500 });
        if (delay < 1000 || delay > 1500) {
          withinRange = false;
          break;
        }
      }
      expect(withinRange).toBe(true);
    });

    it('uses default constants when no options provided', () => {
      const delay = calculateBackoff(0);
      // Default: base 1000, jitter 500, max 30000
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(1500);
    });
  });

  describe('createBackoffIterator', () => {
    it('yields increasing delays', () => {
      const iter = createBackoffIterator({ baseMs: 1000, maxDelayMs: 30000, jitterMs: 0, maxRetries: 5 });
      const state0 = iter.next();
      const state1 = iter.next();
      expect(state0.nextDelayMs).toBe(1000);
      expect(state1.nextDelayMs).toBe(2000);
    });

    it('marks exhausted after max retries', () => {
      const iter = createBackoffIterator({ baseMs: 1000, maxDelayMs: 30000, jitterMs: 0, maxRetries: 2 });
      iter.next(); // attempt 0
      iter.next(); // attempt 1
      const state = iter.next(); // attempt 2
      expect(state.exhausted).toBe(true);
    });

    it('tracks attempt count', () => {
      const iter = createBackoffIterator({ maxRetries: 5 });
      expect(iter.getAttempt()).toBe(0);
      iter.next();
      expect(iter.getAttempt()).toBe(1);
      iter.next();
      expect(iter.getAttempt()).toBe(2);
    });

    it('can be reset', () => {
      const iter = createBackoffIterator({ maxRetries: 2 });
      iter.next();
      iter.next();
      expect(iter.getAttempt()).toBe(2);
      iter.reset();
      expect(iter.getAttempt()).toBe(0);
    });

    it('uses default maxRetries of 3', () => {
      const iter = createBackoffIterator();
      iter.next(); // 1
      iter.next(); // 2
      iter.next(); // 3
      const state = iter.next();
      expect(state.exhausted).toBe(true);
    });
  });

  describe('sleep', () => {
    it('resolves after specified time', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });
});