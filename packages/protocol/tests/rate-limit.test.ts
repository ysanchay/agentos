import { describe, it, expect } from 'vitest';
import { TokenBucketRateLimiter, SlidingWindowRateLimiter, PerAgentRateLimiter } from '../src/rate-limit.js';

describe('rate-limit', () => {
  describe('TokenBucketRateLimiter', () => {
    it('allows requests up to capacity', () => {
      const limiter = new TokenBucketRateLimiter({ maxTokens: 3, refillRatePerMs: 0.01 });
      expect(limiter.tryConsume()).toBe(true);
      expect(limiter.tryConsume()).toBe(true);
      expect(limiter.tryConsume()).toBe(true);
    });

    it('blocks requests when tokens exhausted', () => {
      const limiter = new TokenBucketRateLimiter({ maxTokens: 2, refillRatePerMs: 0.001 });
      limiter.tryConsume();
      limiter.tryConsume();
      expect(limiter.tryConsume()).toBe(false);
    });

    it('refills tokens over time', async () => {
      const limiter = new TokenBucketRateLimiter({ maxTokens: 1, refillRatePerMs: 10 }); // 10 tokens/sec
      limiter.tryConsume();
      expect(limiter.tryConsume()).toBe(false);

      // Wait for refill
      await new Promise((r) => setTimeout(r, 150));
      expect(limiter.tryConsume()).toBe(true);
    });

    it('tryConsumeN consumes multiple tokens', () => {
      const limiter = new TokenBucketRateLimiter({ maxTokens: 5, refillRatePerMs: 0 });
      expect(limiter.tryConsumeN(3)).toBe(true);
      expect(Math.floor(limiter.availableTokens())).toBe(2);
    });

    it('tryConsumeN fails if not enough tokens', () => {
      const limiter = new TokenBucketRateLimiter({ maxTokens: 2, refillRatePerMs: 0.01 });
      expect(limiter.tryConsumeN(3)).toBe(false);
    });

    it('peek checks without consuming', () => {
      const limiter = new TokenBucketRateLimiter({ maxTokens: 1, refillRatePerMs: 0.001 });
      expect(limiter.peek()).toBe(true);
      expect(limiter.availableTokens()).toBe(1); // Not consumed
    });

    it('waitTimeMs returns 0 when tokens available', () => {
      const limiter = new TokenBucketRateLimiter({ maxTokens: 5, refillRatePerMs: 0.01 });
      expect(limiter.waitTimeMs()).toBe(0);
    });

    it('reset restores full capacity', () => {
      const limiter = new TokenBucketRateLimiter({ maxTokens: 5, refillRatePerMs: 0.01 });
      for (let i = 0; i < 5; i++) limiter.tryConsume();
      expect(limiter.availableTokens()).toBe(0);
      limiter.reset();
      expect(limiter.availableTokens()).toBe(5);
    });
  });

  describe('SlidingWindowRateLimiter', () => {
    it('allows requests up to limit', () => {
      const limiter = new SlidingWindowRateLimiter({ maxRequests: 3, windowMs: 1000 });
      expect(limiter.tryAcquire().ok).toBe(true);
      expect(limiter.tryAcquire().ok).toBe(true);
      expect(limiter.tryAcquire().ok).toBe(true);
    });

    it('blocks requests over the limit', () => {
      const limiter = new SlidingWindowRateLimiter({ maxRequests: 2, windowMs: 1000 });
      limiter.tryAcquire();
      limiter.tryAcquire();
      const result = limiter.tryAcquire();
      expect(result.ok).toBe(false);
    });

    it('includes retry_after in rate limit error', () => {
      const limiter = new SlidingWindowRateLimiter({ maxRequests: 1, windowMs: 1000 });
      limiter.tryAcquire();
      const result = limiter.tryAcquire();
      if (!result.ok) {
        expect(result.retry_after).toBeDefined();
      }
    });

    it('allows requests after window slides', async () => {
      const limiter = new SlidingWindowRateLimiter({ maxRequests: 1, windowMs: 100 });
      limiter.tryAcquire();
      expect(limiter.tryAcquire().ok).toBe(false);

      await new Promise((r) => setTimeout(r, 150));
      expect(limiter.tryAcquire().ok).toBe(true);
    });

    it('peek checks without recording', () => {
      const limiter = new SlidingWindowRateLimiter({ maxRequests: 2, windowMs: 1000 });
      expect(limiter.peek()).toBe(true);
      expect(limiter.remaining()).toBe(2);
    });

    it('remaining counts down', () => {
      const limiter = new SlidingWindowRateLimiter({ maxRequests: 3, windowMs: 1000 });
      expect(limiter.remaining()).toBe(3);
      limiter.tryAcquire();
      expect(limiter.remaining()).toBe(2);
    });

    it('waitTimeMs returns 0 when slots available', () => {
      const limiter = new SlidingWindowRateLimiter({ maxRequests: 5, windowMs: 1000 });
      expect(limiter.waitTimeMs()).toBe(0);
    });

    it('currentCount tracks requests in window', () => {
      const limiter = new SlidingWindowRateLimiter({ maxRequests: 5, windowMs: 1000 });
      limiter.tryAcquire();
      limiter.tryAcquire();
      expect(limiter.currentCount()).toBe(2);
    });

    it('reset clears all tracked requests', () => {
      const limiter = new SlidingWindowRateLimiter({ maxRequests: 2, windowMs: 1000 });
      limiter.tryAcquire();
      limiter.tryAcquire();
      limiter.reset();
      expect(limiter.remaining()).toBe(2);
    });
  });

  describe('PerAgentRateLimiter', () => {
    it('tracks limits per agent independently', () => {
      const limiter = new PerAgentRateLimiter({ maxRequests: 2, windowMs: 1000 });
      expect(limiter.tryAcquire('agent-1').ok).toBe(true);
      expect(limiter.tryAcquire('agent-1').ok).toBe(true);
      expect(limiter.tryAcquire('agent-1').ok).toBe(false);
      expect(limiter.tryAcquire('agent-2').ok).toBe(true); // Different agent
    });

    it('remaining returns correct count', () => {
      const limiter = new PerAgentRateLimiter({ maxRequests: 5, windowMs: 1000 });
      limiter.tryAcquire('agent-1');
      limiter.tryAcquire('agent-1');
      expect(limiter.remaining('agent-1')).toBe(3);
    });

    it('resetAgent clears specific agent', () => {
      const limiter = new PerAgentRateLimiter({ maxRequests: 1, windowMs: 1000 });
      limiter.tryAcquire('agent-1');
      expect(limiter.tryAcquire('agent-1').ok).toBe(false);
      limiter.resetAgent('agent-1');
      expect(limiter.tryAcquire('agent-1').ok).toBe(true);
    });

    it('resetAll clears everything', () => {
      const limiter = new PerAgentRateLimiter({ maxRequests: 1, windowMs: 1000 });
      limiter.tryAcquire('agent-1');
      limiter.tryAcquire('agent-2');
      limiter.resetAll();
      expect(limiter.remaining('agent-1')).toBe(1);
      expect(limiter.remaining('agent-2')).toBe(1);
    });
  });
});