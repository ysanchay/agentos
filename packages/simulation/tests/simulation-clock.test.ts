/**
 * @agentos/simulation — SimulationClock tests
 * Tests for virtual time management, speed control, and event IDs.
 */

import { describe, it, expect } from 'vitest';
import { SimulationClock } from '../src/simulation-clock.js';

describe('SimulationClock', () => {
  describe('construction', () => {
    it('should start with zero elapsed time', () => {
      const clock = new SimulationClock();
      expect(clock.getElapsed()).toBe(0);
    });

    it('should accept a speed multiplier', () => {
      const clock = new SimulationClock(10);
      expect(clock.getSpeed()).toBe(10);
    });

    it('should default to speed multiplier of 1', () => {
      const clock = new SimulationClock();
      expect(clock.getSpeed()).toBe(1);
    });
  });

  describe('tick', () => {
    it('should advance elapsed time by realMs * speedMultiplier', () => {
      const clock = new SimulationClock(10);
      const elapsed = clock.tick(100); // 100 real ms * 10x speed = 1000 sim ms
      expect(elapsed).toBe(1000);
      expect(clock.getElapsed()).toBe(1000);
    });

    it('should accumulate time across multiple ticks', () => {
      const clock = new SimulationClock(5);
      clock.tick(100); // 500 sim ms elapsed
      clock.tick(200); // 1000 more sim ms
      expect(clock.getElapsed()).toBe(1500);
    });

    it('should use speedMultiplier of 1 by default', () => {
      const clock = new SimulationClock();
      clock.tick(100);
      expect(clock.getElapsed()).toBe(100);
    });

    it('should return the new elapsed time after tick', () => {
      const clock = new SimulationClock(2);
      const result = clock.tick(50);
      expect(result).toBe(100);
    });
  });

  describe('pause and resume', () => {
    it('should pause time advancement', () => {
      const clock = new SimulationClock(10);
      clock.tick(100);
      expect(clock.getElapsed()).toBe(1000);
      clock.pause();
      const result = clock.tick(100); // Paused, should not advance
      expect(result).toBe(1000);
      expect(clock.getElapsed()).toBe(1000);
      expect(clock.isPaused()).toBe(true);
    });

    it('should resume time advancement after pause', () => {
      const clock = new SimulationClock(10);
      clock.tick(100);
      clock.pause();
      clock.tick(100); // Ignored while paused
      clock.resume();
      clock.tick(100);
      expect(clock.getElapsed()).toBe(2000);
      expect(clock.isPaused()).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset elapsed time to 0', () => {
      const clock = new SimulationClock(10);
      clock.tick(500);
      expect(clock.getElapsed()).toBe(5000);
      clock.reset();
      expect(clock.getElapsed()).toBe(0);
    });

    it('should reset event counter', () => {
      const clock = new SimulationClock();
      clock.nextEventId();
      clock.nextEventId();
      clock.reset();
      // After reset, next ID should start from 1 again
      expect(clock.nextEventId()).toBe(1);
    });

    it('should unpause the clock', () => {
      const clock = new SimulationClock();
      clock.pause();
      expect(clock.isPaused()).toBe(true);
      clock.reset();
      expect(clock.isPaused()).toBe(false);
    });
  });

  describe('nextEventId', () => {
    it('should return monotonically increasing IDs', () => {
      const clock = new SimulationClock();
      const id1 = clock.nextEventId();
      const id2 = clock.nextEventId();
      const id3 = clock.nextEventId();
      expect(id2).toBeGreaterThan(id1);
      expect(id3).toBeGreaterThan(id2);
    });

    it('should start from 1', () => {
      const clock = new SimulationClock();
      expect(clock.nextEventId()).toBe(1);
    });
  });

  describe('setSpeed', () => {
    it('should change the speed multiplier', () => {
      const clock = new SimulationClock(2);
      expect(clock.getSpeed()).toBe(2);
      clock.setSpeed(5);
      expect(clock.getSpeed()).toBe(5);
      clock.tick(100);
      expect(clock.getElapsed()).toBe(500);
    });
  });

  describe('now', () => {
    it('should return an ISO date string', () => {
      const clock = new SimulationClock();
      const dateStr = clock.now();
      expect(new Date(dateStr).getTime()).not.toBeNaN();
    });
  });
});