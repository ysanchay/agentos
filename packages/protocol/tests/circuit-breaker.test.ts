import { describe, it, expect } from 'vitest';
import { CircuitBreaker } from '../src/circuit-breaker.js';

describe('circuit-breaker', () => {
  describe('CircuitBreaker', () => {
    it('starts in closed state', () => {
      const cb = new CircuitBreaker();
      expect(cb.getState()).toBe('closed');
    });

    it('allows requests in closed state', () => {
      const cb = new CircuitBreaker();
      const result = cb.allow();
      expect(result.ok).toBe(true);
    });

    it('opens after trigger count failures', () => {
      const cb = new CircuitBreaker({ triggerCount: 3 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe('closed');
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
    });

    it('blocks requests in open state', () => {
      const cb = new CircuitBreaker({ triggerCount: 1, pauseMs: 60000 });
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      const result = cb.allow();
      expect(result.ok).toBe(false);
    });

    it('transitions to half-open after pause period', () => {
      const cb = new CircuitBreaker({ triggerCount: 1, pauseMs: 50 });
      cb.recordFailure();
      expect(cb.getState()).toBe('open');

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const result = cb.allow();
          expect(result.ok).toBe(true);
          expect(cb.getState()).toBe('half-open');
          resolve();
        }, 100);
      });
    });

    it('closes from half-open after enough successes', () => {
      const cb = new CircuitBreaker({ triggerCount: 1, pauseMs: 50, halfOpenSuccessCount: 2 });
      cb.recordFailure();
      expect(cb.getState()).toBe('open');

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          cb.allow(); // transitions to half-open
          cb.recordSuccess();
          expect(cb.getState()).toBe('half-open');
          cb.recordSuccess();
          expect(cb.getState()).toBe('closed');
          expect(cb.failureCount).toBe(0); // reset after close - check via getStatus
          resolve();
        }, 100);
      });
    });

    it('re-opens from half-open on failure', () => {
      const cb = new CircuitBreaker({ triggerCount: 1, pauseMs: 50, halfOpenSuccessCount: 3 });
      cb.recordFailure();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          cb.allow(); // transitions to half-open
          cb.recordFailure(); // immediately fails
          expect(cb.getState()).toBe('open');
          resolve();
        }, 100);
      });
    });

    it('execute allows successful calls in closed state', async () => {
      const cb = new CircuitBreaker();
      const result = await cb.execute(async () => 42);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(42);
      }
    });

    it('execute records failure for throwing calls', async () => {
      const cb = new CircuitBreaker({ triggerCount: 1 });
      const result = await cb.execute(async () => { throw new Error('boom'); });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_message).toBe('boom');
      }
      expect(cb.getState()).toBe('open');
    });

    it('execute blocks calls in open state', async () => {
      const cb = new CircuitBreaker({ triggerCount: 1, pauseMs: 60000 });
      cb.recordFailure();
      const result = await cb.execute(async () => 42);
      expect(result.ok).toBe(false);
    });

    it('getStatus returns detailed info', () => {
      const cb = new CircuitBreaker({ triggerCount: 3 });
      cb.recordFailure();
      const status = cb.getStatus();
      expect(status.state).toBe('closed');
      expect(status.failureCount).toBe(1);
      expect(status.successCount).toBe(0);
      expect(status.lastFailureAt).toBeTruthy();
      expect(status.lastStateChange).toBeTruthy();
    });

    it('getStatus with open state has openedAt', () => {
      const cb = new CircuitBreaker({ triggerCount: 1 });
      cb.recordFailure();
      const status = cb.getStatus();
      expect(status.state).toBe('open');
      expect(status.openedAt).toBeTruthy();
    });

    it('reset returns to closed state', () => {
      const cb = new CircuitBreaker({ triggerCount: 1 });
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      cb.reset();
      expect(cb.getState()).toBe('closed');
      const status = cb.getStatus();
      expect(status.failureCount).toBe(0);
      expect(status.successCount).toBe(0);
    });

    it('trip forces open state', () => {
      const cb = new CircuitBreaker();
      cb.trip();
      expect(cb.getState()).toBe('open');
    });

    it('timeUntilHalfOpen returns 0 when not open', () => {
      const cb = new CircuitBreaker();
      expect(cb.timeUntilHalfOpen()).toBe(0);
    });

    it('timeUntilHalfOpen returns remaining time when open', () => {
      const cb = new CircuitBreaker({ triggerCount: 1, pauseMs: 60000 });
      cb.recordFailure();
      expect(cb.timeUntilHalfOpen()).toBeGreaterThan(0);
    });

    it('half-open allows limited test requests', () => {
      const cb = new CircuitBreaker({ triggerCount: 1, pauseMs: 50, halfOpenSuccessCount: 2 });
      cb.recordFailure();

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          cb.allow(); // transitions to half-open
          expect(cb.getState()).toBe('half-open');

          // Allow test request
          const result = cb.allow();
          expect(result.ok).toBe(true);

          // Record success to close
          cb.recordSuccess();
          cb.recordSuccess();
          expect(cb.getState()).toBe('closed');
          resolve();
        }, 100);
      });
    });

    it('records success count in closed state', () => {
      const cb = new CircuitBreaker();
      cb.recordSuccess();
      cb.recordSuccess();
      const status = cb.getStatus();
      expect(status.successCount).toBe(2);
    });

    it('execute works through half-open recovery', async () => {
      const cb = new CircuitBreaker({ triggerCount: 1, pauseMs: 50, halfOpenSuccessCount: 2 });
      cb.recordFailure();

      return new Promise<void>((resolve) => {
        setTimeout(async () => {
          // Should transition to half-open and allow
          const result1 = await cb.execute(async () => 'ok1');
          expect(result1.ok).toBe(true);

          const result2 = await cb.execute(async () => 'ok2');
          expect(result2.ok).toBe(true);
          expect(cb.getState()).toBe('closed');
          resolve();
        }, 100);
      });
    });
  });
});