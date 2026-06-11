/**
 * @agentos/llm — TokenTracker tests
 * Tests for token-to-resource conversion and accumulation.
 */

import { describe, it, expect } from 'vitest';
import { TokenTracker } from '../src/token-tracker.js';

describe('TokenTracker', () => {
  describe('track', () => {
    it('should convert tokens to resource units with default rates', () => {
      const tracker = new TokenTracker();
      const resources = tracker.track(10000, 1000);

      // Default: 1 RU per 1000 completion tokens, 1 MU per 10000 prompt tokens
      expect(resources.ru).toBe(1);  // ceil(1000 * 0.001) = 1
      expect(resources.mu).toBe(1);  // ceil(10000 * 0.0001) = 1
      expect(resources.eu).toBe(1);  // 1 per call
      expect(resources.vu).toBe(0);  // 0 per call
    });

    it('should return minimum 1 RU/MU for any positive tokens', () => {
      const tracker = new TokenTracker();
      const resources = tracker.track(1, 1);
      expect(resources.ru).toBeGreaterThanOrEqual(1);
      expect(resources.mu).toBeGreaterThanOrEqual(1);
    });

    it('should accumulate across multiple calls', () => {
      const tracker = new TokenTracker();
      tracker.track(5000, 500);
      tracker.track(5000, 500);

      expect(tracker.getTotalCalls()).toBe(2);
      expect(tracker.getTotalPromptTokens()).toBe(10000);
      expect(tracker.getTotalCompletionTokens()).toBe(1000);
    });

    it('should accept custom token cost config', () => {
      const tracker = new TokenTracker({
        ruPerCompletionToken: 0.01,
        muPerPromptToken: 0.001,
        euPerCall: 2,
        vuPerCall: 0.5,
      });

      const resources = tracker.track(1000, 100);
      expect(resources.ru).toBe(1);    // ceil(100 * 0.01) = 1
      expect(resources.mu).toBe(1);    // ceil(1000 * 0.001) = 1
      expect(resources.eu).toBe(2);    // custom rate
      expect(resources.vu).toBe(0.5);  // custom rate
    });
  });

  describe('getTotalConsumption', () => {
    it('should sum all tracked resource consumption', () => {
      const tracker = new TokenTracker();
      tracker.track(10000, 1000);
      tracker.track(20000, 2000);

      const total = tracker.getTotalConsumption();
      expect(total.ru).toBe(3);  // ceil(1000*0.001) + ceil(2000*0.001) = 1+2
      expect(total.mu).toBe(3);  // ceil(10000*0.0001) + ceil(20000*0.0001) = 1+2
      expect(total.eu).toBe(2);  // 1+1
    });
  });

  describe('reset', () => {
    it('should clear all tracked data', () => {
      const tracker = new TokenTracker();
      tracker.track(10000, 1000);
      tracker.track(5000, 500);

      tracker.reset();

      expect(tracker.getTotalCalls()).toBe(0);
      expect(tracker.getTotalPromptTokens()).toBe(0);
      expect(tracker.getTotalCompletionTokens()).toBe(0);

      const total = tracker.getTotalConsumption();
      expect(total.ru).toBe(0);
      expect(total.mu).toBe(0);
    });
  });
});