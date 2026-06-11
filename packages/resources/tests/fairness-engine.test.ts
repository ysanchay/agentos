import { describe, it, expect, beforeEach } from 'vitest';
import { FairnessEngine } from '../src/fairness-engine.js';
import { PRIORITY_SYSTEM, PRIORITY_CRITICAL, PRIORITY_HIGH, PRIORITY_NORMAL, PRIORITY_LOW, PRIORITY_IDLE } from '@agentos/types';
import type { AgentID, Priority, ResourceBudget } from '@agentos/types';
import { createUUID } from '@agentos/types';

function makeAgentId(): AgentID {
  return createUUID() as unknown as AgentID;
}

describe('FairnessEngine', () => {
  let engine: FairnessEngine;

  beforeEach(() => {
    engine = new FairnessEngine();
  });

  describe('registerWait', () => {
    it('should register an agent in the wait queue', () => {
      const agentId = makeAgentId();
      engine.registerWait(agentId, PRIORITY_NORMAL as Priority);

      expect(engine.getQueueDepth()).toBe(1);
      expect(engine.getEffectivePriority(agentId)).toBe(PRIORITY_NORMAL);
    });

    it('should register with custom timestamp', () => {
      const agentId = makeAgentId();
      const ts = '2026-01-01T00:00:00.000Z';
      engine.registerWait(agentId, PRIORITY_HIGH as Priority, ts);

      expect(engine.getQueueDepth()).toBe(1);
    });
  });

  describe('removeWait', () => {
    it('should remove an agent from the wait queue', () => {
      const agentId = makeAgentId();
      engine.registerWait(agentId, PRIORITY_NORMAL as Priority);
      expect(engine.getQueueDepth()).toBe(1);

      engine.removeWait(agentId);
      expect(engine.getQueueDepth()).toBe(0);
    });

    it('should handle removing unknown agent gracefully', () => {
      expect(() => engine.removeWait(makeAgentId())).not.toThrow();
    });
  });

  describe('checkStarvation', () => {
    it('should not upgrade SYSTEM priority', () => {
      const agentId = makeAgentId();
      const longAgo = new Date(Date.now() - 600000).toISOString();
      engine.registerWait(agentId, PRIORITY_SYSTEM, longAgo);

      const upgraded = engine.checkStarvation();
      expect(upgraded).toHaveLength(0);
    });

    it('should upgrade CRITICAL after 10s wait', () => {
      const agentId = makeAgentId();
      const tenSecondsAgo = new Date(Date.now() - 11000).toISOString();
      engine.registerWait(agentId, PRIORITY_CRITICAL as Priority, tenSecondsAgo);

      const upgraded = engine.checkStarvation(Date.now());
      expect(upgraded).toHaveLength(1);
      expect(upgraded[0].agentId).toBe(agentId);
      expect(upgraded[0].from).toBe(PRIORITY_CRITICAL);
      expect(upgraded[0].to).toBe(PRIORITY_SYSTEM);
    });

    it('should upgrade HIGH after 60s wait', () => {
      const agentId = makeAgentId();
      const sixtySecondsAgo = new Date(Date.now() - 61000).toISOString();
      engine.registerWait(agentId, PRIORITY_HIGH as Priority, sixtySecondsAgo);

      const upgraded = engine.checkStarvation(Date.now());
      expect(upgraded).toHaveLength(1);
    });

    it('should upgrade NORMAL after 300s wait', () => {
      const agentId = makeAgentId();
      const fiveMinAgo = new Date(Date.now() - 301000).toISOString();
      engine.registerWait(agentId, PRIORITY_NORMAL as Priority, fiveMinAgo);

      const upgraded = engine.checkStarvation(Date.now());
      expect(upgraded).toHaveLength(1);
      expect(upgraded[0].to).toBe(PRIORITY_HIGH);
    });

    it('should not upgrade LOW or IDLE (no guarantee)', () => {
      const agentLow = makeAgentId();
      const agentIdle = makeAgentId();
      const longAgo = new Date(Date.now() - 600000).toISOString();

      engine.registerWait(agentLow, PRIORITY_LOW as Priority, longAgo);
      engine.registerWait(agentIdle, PRIORITY_IDLE as Priority, longAgo);

      const upgraded = engine.checkStarvation(Date.now());
      expect(upgraded).toHaveLength(0);
    });

    it('should not upgrade more than 2 times', () => {
      const agentId = makeAgentId();
      // Register with NORMAL priority long ago
      const veryLongAgo = new Date(Date.now() - 600000).toISOString();
      engine.registerWait(agentId, PRIORITY_NORMAL as Priority, veryLongAgo);

      // First upgrade: NORMAL -> HIGH
      let upgraded = engine.checkStarvation(Date.now());
      expect(upgraded).toHaveLength(1);
      expect(upgraded[0].to).toBe(PRIORITY_HIGH);

      // Second upgrade: HIGH -> CRITICAL (still waiting)
      upgraded = engine.checkStarvation(Date.now());
      expect(upgraded).toHaveLength(1);
      expect(upgraded[0].to).toBe(PRIORITY_CRITICAL);

      // Third check: already at 2 upgrades, should not upgrade further
      upgraded = engine.checkStarvation(Date.now());
      expect(upgraded).toHaveLength(0);
    });

    it('should not upgrade recently registered agents', () => {
      const agentId = makeAgentId();
      engine.registerWait(agentId, PRIORITY_NORMAL as Priority);

      const upgraded = engine.checkStarvation(Date.now());
      expect(upgraded).toHaveLength(0);
    });
  });

  describe('calculateFairShare', () => {
    const budget: ResourceBudget = { ru: 1000, mu: 500, eu: 100, vu: 50 };

    it('should distribute equally among agents at same priority', () => {
      const agents = [
        { agentId: makeAgentId(), priority: PRIORITY_NORMAL as Priority },
        { agentId: makeAgentId(), priority: PRIORITY_NORMAL as Priority },
        { agentId: makeAgentId(), priority: PRIORITY_NORMAL as Priority },
      ];

      const shares = engine.calculateFairShare(budget, agents);
      expect(shares).toHaveLength(3);

      for (const share of shares) {
        expect(share.share.ru).toBe(Math.floor(1000 / 3));
        expect(share.share.mu).toBe(Math.floor(500 / 3));
      }
    });

    it('should give higher priority agents resources first', () => {
      const agent1 = makeAgentId();
      const agent2 = makeAgentId();
      const agents = [
        { agentId: agent1, priority: PRIORITY_CRITICAL as Priority },
        { agentId: agent2, priority: PRIORITY_LOW as Priority },
      ];

      const shares = engine.calculateFairShare(budget, agents);
      expect(shares).toHaveLength(2);

      // Both get shares from the full budget since fair share divides equally
      // but higher priority gets processed first
      const criticalShare = shares.find(s => s.agentId === agent1);
      const lowShare = shares.find(s => s.agentId === agent2);

      expect(criticalShare).toBeDefined();
      expect(lowShare).toBeDefined();
    });

    it('should handle single agent', () => {
      const agentId = makeAgentId();
      const agents = [{ agentId, priority: PRIORITY_HIGH as Priority }];

      const shares = engine.calculateFairShare(budget, agents);
      expect(shares).toHaveLength(1);
      expect(shares[0].share.ru).toBe(1000);
      expect(shares[0].share.mu).toBe(500);
      expect(shares[0].share.eu).toBe(100);
      expect(shares[0].share.vu).toBe(50);
    });

    it('should handle empty agents array', () => {
      const shares = engine.calculateFairShare(budget, []);
      expect(shares).toHaveLength(0);
    });
  });

  describe('requestInversionPrevention', () => {
    it('should grant priority promotion', () => {
      const agentId = makeAgentId();
      const result = engine.requestInversionPrevention(
        agentId,
        PRIORITY_NORMAL as Priority,
        PRIORITY_HIGH as Priority,
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.promoted).toBe(true);
        expect(result.data.promotedTo).toBe(PRIORITY_HIGH);
      }
    });

    it('should limit to 3 promotions per hour', () => {
      const agentId = makeAgentId();

      // Request 3 promotions
      for (let i = 0; i < 3; i++) {
        const result = engine.requestInversionPrevention(
          agentId,
          PRIORITY_NORMAL as Priority,
          PRIORITY_HIGH as Priority,
        );
        expect(result.ok).toBe(true);
      }

      // 4th should fail
      const result = engine.requestInversionPrevention(
        agentId,
        PRIORITY_NORMAL as Priority,
        PRIORITY_HIGH as Priority,
      );
      expect(result.ok).toBe(false);
    });
  });

  describe('getActivePromotion', () => {
    it('should return active promotion for agent', () => {
      const agentId = makeAgentId();
      engine.requestInversionPrevention(
        agentId,
        PRIORITY_NORMAL as Priority,
        PRIORITY_HIGH as Priority,
      );

      const promotion = engine.getActivePromotion(agentId);
      expect(promotion).toBeDefined();
      expect(promotion!.promotedTo).toBe(PRIORITY_HIGH);
      expect(promotion!.originalPriority).toBe(PRIORITY_NORMAL);
    });

    it('should return undefined for agent without promotion', () => {
      const agentId = makeAgentId();
      const promotion = engine.getActivePromotion(agentId);
      expect(promotion).toBeUndefined();
    });
  });

  describe('checkBurst', () => {
    it('should allow burst within allowance', () => {
      const agentId = makeAgentId();
      const hourlyQuota = 100;
      // 20% of 100 = 20 burst allowance
      const allowed = engine.checkBurst(agentId, 10, hourlyQuota);
      expect(allowed).toBe(true);
    });

    it('should deny burst exceeding allowance', () => {
      const agentId = makeAgentId();
      const hourlyQuota = 100;
      // 20% of 100 = 20 burst allowance
      const allowed = engine.checkBurst(agentId, 25, hourlyQuota);
      expect(allowed).toBe(false);
    });

    it('should track burst consumption across calls', () => {
      const agentId = makeAgentId();
      const hourlyQuota = 100;
      // 20% of 100 = 20 burst allowance

      expect(engine.checkBurst(agentId, 10, hourlyQuota)).toBe(true);
      engine.recordBurstConsumption(agentId, 10, hourlyQuota);

      expect(engine.checkBurst(agentId, 10, hourlyQuota)).toBe(true);
      engine.recordBurstConsumption(agentId, 10, hourlyQuota);

      expect(engine.checkBurst(agentId, 1, hourlyQuota)).toBe(false);
    });
  });

  describe('recordBurstConsumption', () => {
    it('should track consumption', () => {
      const agentId = makeAgentId();
      const hourlyQuota = 100;

      engine.recordBurstConsumption(agentId, 5, hourlyQuota);
      // After recording 5, burst allowance is 20, consumed is 5, so 15 remaining
      expect(engine.checkBurst(agentId, 15, hourlyQuota)).toBe(true);
      expect(engine.checkBurst(agentId, 16, hourlyQuota)).toBe(false);
    });
  });

  describe('getQueueDepth', () => {
    it('should return total queue depth', () => {
      engine.registerWait(makeAgentId(), PRIORITY_HIGH as Priority);
      engine.registerWait(makeAgentId(), PRIORITY_NORMAL as Priority);
      engine.registerWait(makeAgentId(), PRIORITY_LOW as Priority);

      expect(engine.getQueueDepth()).toBe(3);
    });

    it('should return queue depth for specific priority', () => {
      engine.registerWait(makeAgentId(), PRIORITY_HIGH as Priority);
      engine.registerWait(makeAgentId(), PRIORITY_HIGH as Priority);
      engine.registerWait(makeAgentId(), PRIORITY_NORMAL as Priority);

      expect(engine.getQueueDepth(PRIORITY_HIGH as Priority)).toBe(2);
      expect(engine.getQueueDepth(PRIORITY_NORMAL as Priority)).toBe(1);
      expect(engine.getQueueDepth(PRIORITY_LOW as Priority)).toBe(0);
    });
  });

  describe('getEffectivePriority', () => {
    it('should return original priority before starvation upgrade', () => {
      const agentId = makeAgentId();
      engine.registerWait(agentId, PRIORITY_NORMAL as Priority);

      expect(engine.getEffectivePriority(agentId)).toBe(PRIORITY_NORMAL);
    });

    it('should return upgraded priority after starvation check', () => {
      const agentId = makeAgentId();
      const longAgo = new Date(Date.now() - 600000).toISOString();
      engine.registerWait(agentId, PRIORITY_NORMAL as Priority, longAgo);

      engine.checkStarvation(Date.now());

      expect(engine.getEffectivePriority(agentId)).toBe(PRIORITY_HIGH);
    });

    it('should return undefined for unknown agent', () => {
      expect(engine.getEffectivePriority(makeAgentId())).toBeUndefined();
    });
  });
});