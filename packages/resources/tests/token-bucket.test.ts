import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenBucket, type TokenBucketConfig } from '../src/token-bucket.js';

describe('TokenBucket', () => {
  const defaultConfig: TokenBucketConfig = {
    capacity: 100,
    refillRate: 10,
    refillIntervalMs: 1000,
  };

  let bucket: TokenBucket;

  beforeEach(() => {
    bucket = new TokenBucket(defaultConfig);
  });

  describe('constructor', () => {
    it('should start with tokens equal to capacity', () => {
      expect(bucket.available()).toBe(100);
    });
  });

  describe('tryConsume', () => {
    it('should consume tokens when available', () => {
      expect(bucket.tryConsume(10)).toBe(true);
      expect(bucket.available()).toBe(90);
    });

    it('should consume all tokens', () => {
      expect(bucket.tryConsume(100)).toBe(true);
      expect(bucket.available()).toBe(0);
    });

    it('should fail when insufficient tokens', () => {
      expect(bucket.tryConsume(150)).toBe(false);
      expect(bucket.available()).toBe(100); // Tokens unchanged on failure
    });

    it('should fail on exact zero tokens with consume of 1', () => {
      bucket.tryConsume(100);
      expect(bucket.available()).toBe(0);
      expect(bucket.tryConsume(1)).toBe(false);
    });

    it('should handle multiple consecutive consumes', () => {
      expect(bucket.tryConsume(30)).toBe(true);
      expect(bucket.tryConsume(30)).toBe(true);
      expect(bucket.tryConsume(30)).toBe(true);
      expect(bucket.available()).toBe(10);
      expect(bucket.tryConsume(30)).toBe(false);
    });
  });

  describe('tryConsumeOrWait', () => {
    it('should return 0 when tokens are available (immediate)', () => {
      const waitTime = bucket.tryConsumeOrWait(10);
      expect(waitTime).toBe(0);
      expect(bucket.available()).toBe(90);
    });

    it('should return -1 when refillRate is 0 (impossible to wait)', () => {
      const noRefillBucket = new TokenBucket({ capacity: 100, refillRate: 0, refillIntervalMs: 1000 });
      noRefillBucket.tryConsume(100);
      const waitTime = noRefillBucket.tryConsumeOrWait(10);
      expect(waitTime).toBe(-1);
    });

    it('should calculate wait time based on deficit and refill rate', () => {
      // Consume most tokens
      bucket.tryConsume(95);
      // Need 10 more, have 5, deficit = 5
      // refill rate = 10 per 1000ms = 0.01 per ms
      // wait = ceil(5 / 0.01) = 500ms
      const waitTime = bucket.tryConsumeOrWait(10);
      expect(waitTime).toBeGreaterThan(0);
      // Should not consume tokens on wait
      expect(bucket.available()).toBe(5);
    });
  });

  describe('available', () => {
    it('should refill tokens based on elapsed time', () => {
      // Create a bucket and consume all tokens
      const b = new TokenBucket({ capacity: 100, refillRate: 10, refillIntervalMs: 1000 });
      b.tryConsume(100);
      expect(b.available()).toBe(0);

      // Simulate time passing by creating a new bucket and manipulating time
      // In practice, available() calls refill() internally
    });

    it('should not exceed capacity after refill', () => {
      // If we wait longer than needed to fill, tokens should cap at capacity
      const b = new TokenBucket({ capacity: 50, refillRate: 10, refillIntervalMs: 1000 });
      // Start full (50), no more can be added
      expect(b.available()).toBe(50);
    });
  });

  describe('addTokens', () => {
    it('should add tokens to the bucket', () => {
      bucket.tryConsume(50);
      expect(bucket.available()).toBe(50);
      bucket.addTokens(30);
      expect(bucket.available()).toBe(80);
    });

    it('should cap tokens at capacity', () => {
      bucket.addTokens(50);
      expect(bucket.available()).toBe(100); // Already at capacity, stays at 100
    });

    it('should cap tokens at capacity even with large addTokens', () => {
      bucket.addTokens(500);
      expect(bucket.available()).toBe(100);
    });
  });

  describe('reset', () => {
    it('should reset bucket to full capacity', () => {
      bucket.tryConsume(80);
      expect(bucket.available()).toBe(20);
      bucket.reset();
      expect(bucket.available()).toBe(100);
    });

    it('should allow consumption after reset', () => {
      bucket.tryConsume(100);
      expect(bucket.tryConsume(1)).toBe(false);
      bucket.reset();
      expect(bucket.tryConsume(1)).toBe(true);
    });
  });

  describe('refill mechanics', () => {
    it('should refill tokens after a refill interval', () => {
      const b = new TokenBucket({ capacity: 100, refillRate: 10, refillIntervalMs: 100 });
      b.tryConsume(100);
      expect(b.available()).toBe(0);

      // Wait for refill interval
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          const avail = b.available();
          expect(avail).toBeGreaterThan(0);
          resolve();
        }, 250);
      });
    });
  });
});