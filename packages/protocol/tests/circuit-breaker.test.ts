import { describe, it, expect, vi } from 'vitest';
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

      // Wait for pause to expire
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
    });

    it('reset returns to closed state', () => {
      const cb = new CircuitBreaker({ triggerCount: 1 });
      cb.recordFailure();
      expect(cb.getState()).toBe('open');
      cb.reset();
      expect(cb.getState()).toBe('closed');
    });

    it('trip forces open state', () => {
      const cb = new CircuitBreaker();
      cb.trip();
      expect(cb.getState()).toBe('open');
    });

    it('timeUntilHalfOpen returns remaining time', () => {
      const cb = new CircuitBreaker({ triggerCount: 1, pauseMs: 60000 });
      expect(cb.timeUntilHalfOpen()).toBe(0); // Not open
      cb.recordFailure();
      expect(cb.timeUntilHalfOpen()).toBeGreaterThan(0);
    });
  });
});