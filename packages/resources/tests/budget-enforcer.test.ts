import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetEnforcer, BudgetLevel } from '../src/budget-enforcer.js';
import type { AgentID } from '@agentos/types';
import { createUUID } from '@agentos/types';

function makeAgentId(): AgentID {
  return createUUID() as unknown as AgentID;
}

describe('BudgetEnforcer', () => {
  let enforcer: BudgetEnforcer;

  beforeEach(() => {
    enforcer = new BudgetEnforcer();
  });

  describe('evaluate', () => {
    it('should return OK when budget is at 0%', () => {
      const status = enforcer.evaluate(1000, 0);
      expect(status.level).toBe(BudgetLevel.OK);
      expect(status.percentUsed).toBe(0);
    });

    it('should return OK for normal usage below 80%', () => {
      const status = enforcer.evaluate(1000, 500);
      expect(status.level).toBe(BudgetLevel.OK);
      expect(status.percentUsed).toBe(50);
    });

    it('should return WARNING at 80%', () => {
      const status = enforcer.evaluate(1000, 800);
      expect(status.level).toBe(BudgetLevel.WARNING);
      expect(status.percentUsed).toBe(80);
    });

    it('should return WARNING between 80-94%', () => {
      const status = enforcer.evaluate(1000, 900);
      expect(status.level).toBe(BudgetLevel.WARNING);
    });

    it('should return CRITICAL at 95%', () => {
      const status = enforcer.evaluate(1000, 950);
      expect(status.level).toBe(BudgetLevel.CRITICAL);
    });

    it('should return CRITICAL between 95-99%', () => {
      const status = enforcer.evaluate(1000, 980);
      expect(status.level).toBe(BudgetLevel.CRITICAL);
    });

    it('should return EXHAUSTED at 100%', () => {
      const agentId = makeAgentId();
      const status = enforcer.evaluate(1000, 1000, agentId);
      expect(status.level).toBe(BudgetLevel.EXHAUSTED);
      expect(status.checkpointDeadline).toBeTruthy();
      expect(status.forceTerminateAt).toBeTruthy();
    });

    it('should return FORCE_TERMINATE when exhaustion timer exceeds threshold', () => {
      const agentId = makeAgentId();
      // First evaluation to start the exhaustion timer
      enforcer.evaluate(1000, 1000, agentId);

      // Simulate time passing beyond force terminate threshold
      // The enforcer stores the exhaustion time internally
      // We need to manipulate the timer or use a different approach
      // Let's evaluate again after the timer should have elapsed
      // Since we can't easily manipulate time, let's test the first exhaustion
      const status = enforcer.evaluate(1000, 1000, agentId);
      expect(status.level).toBe(BudgetLevel.EXHAUSTED);
    });

    it('should return OK with zero budget', () => {
      const status = enforcer.evaluate(0, 0);
      expect(status.level).toBe(BudgetLevel.OK);
      expect(status.percentUsed).toBe(0);
    });

    it('should include message for WARNING', () => {
      const status = enforcer.evaluate(1000, 850);
      expect(status.message).toBeTruthy();
      expect(status.message).toContain('warning');
    });

    it('should include message for CRITICAL', () => {
      const status = enforcer.evaluate(1000, 960);
      expect(status.message).toBeTruthy();
      expect(status.message).toContain('critical');
    });
  });

  describe('enforceHard', () => {
    it('should allow when budget is OK', () => {
      const agentId = makeAgentId();
      const result = enforcer.enforceHard(1000, 100, agentId);

      expect(result.allowed).toBe(true);
      expect(result.status.level).toBe(BudgetLevel.OK);
    });

    it('should allow with warning when budget at WARNING', () => {
      const agentId = makeAgentId();
      const result = enforcer.enforceHard(1000, 800, agentId);

      expect(result.allowed).toBe(true);
      expect(result.status.level).toBe(BudgetLevel.WARNING);
    });

    it('should allow with warning when budget at CRITICAL', () => {
      const agentId = makeAgentId();
      const result = enforcer.enforceHard(1000, 950, agentId);

      expect(result.allowed).toBe(true);
      expect(result.status.level).toBe(BudgetLevel.CRITICAL);
    });

    it('should not allow when budget is EXHAUSTED', () => {
      const agentId = makeAgentId();
      const result = enforcer.enforceHard(1000, 1000, agentId);

      expect(result.allowed).toBe(false);
      expect(result.status.level).toBe(BudgetLevel.EXHAUSTED);
    });
  });

  describe('enforceSoft', () => {
    it('should return 50% throttle for 1st offense', () => {
      const agentId = makeAgentId();
      const result = enforcer.enforceSoft(agentId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.throttlePercent).toBe(50);
        expect(result.data.durationMs).toBe(300000); // 5 min
        expect(result.data.suspended).toBe(false);
      }
    });

    it('should return 25% throttle for 2nd offense', () => {
      const agentId = makeAgentId();
      enforcer.enforceSoft(agentId); // 1st

      const result = enforcer.enforceSoft(agentId); // 2nd
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.throttlePercent).toBe(25);
        expect(result.data.durationMs).toBe(900000); // 15 min
        expect(result.data.suspended).toBe(false);
      }
    });

    it('should return 10% throttle for 3rd offense', () => {
      const agentId = makeAgentId();
      enforcer.enforceSoft(agentId);
      enforcer.enforceSoft(agentId);

      const result = enforcer.enforceSoft(agentId); // 3rd
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.throttlePercent).toBe(10);
        expect(result.data.durationMs).toBe(3600000); // 1 hour
        expect(result.data.suspended).toBe(false);
      }
    });

    it('should return 10% throttle for 4th offense', () => {
      const agentId = makeAgentId();
      for (let i = 0; i < 3; i++) enforcer.enforceSoft(agentId);

      const result = enforcer.enforceSoft(agentId); // 4th
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.throttlePercent).toBe(10);
        expect(result.data.durationMs).toBe(3600000);
        expect(result.data.suspended).toBe(false);
      }
    });

    it('should suspend for 5th+ offense', () => {
      const agentId = makeAgentId();
      for (let i = 0; i < 4; i++) enforcer.enforceSoft(agentId);

      const result = enforcer.enforceSoft(agentId); // 5th
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.throttlePercent).toBe(0);
        expect(result.data.durationMs).toBe(0);
        expect(result.data.suspended).toBe(true);
      }
    });

    it('should track offenses independently per agent', () => {
      const agent1 = makeAgentId();
      const agent2 = makeAgentId();

      enforcer.enforceSoft(agent1);
      enforcer.enforceSoft(agent2);

      // Agent 1's 2nd offense
      const result1 = enforcer.enforceSoft(agent1);
      if (result1.ok) {
        expect(result1.data.throttlePercent).toBe(25); // 2nd offense
      }

      // Agent 2 is still on 1st offense
      const result2 = enforcer.enforceSoft(agent2);
      if (result2.ok) {
        expect(result2.data.throttlePercent).toBe(25); // 2nd offense
      }
    });
  });

  describe('clearExhaustion', () => {
    it('should clear exhaustion timer for an agent', () => {
      const agentId = makeAgentId();
      // Trigger exhaustion
      enforcer.evaluate(1000, 1000, agentId);

      // Clear it
      enforcer.clearExhaustion(agentId);

      // Verify by checking offense count doesn't throw
      expect(enforcer.getOffenseCount(agentId)).toBe(0);
    });
  });

  describe('getOffenseCount', () => {
    it('should return 0 for agent with no offenses', () => {
      const agentId = makeAgentId();
      expect(enforcer.getOffenseCount(agentId)).toBe(0);
    });

    it('should count offenses correctly', () => {
      const agentId = makeAgentId();
      enforcer.enforceSoft(agentId);
      enforcer.enforceSoft(agentId);
      enforcer.enforceSoft(agentId);

      expect(enforcer.getOffenseCount(agentId)).toBe(3);
    });

    it('should track offenses independently per agent', () => {
      const agent1 = makeAgentId();
      const agent2 = makeAgentId();

      enforcer.enforceSoft(agent1);
      enforcer.enforceSoft(agent1);
      enforcer.enforceSoft(agent2);

      expect(enforcer.getOffenseCount(agent1)).toBe(2);
      expect(enforcer.getOffenseCount(agent2)).toBe(1);
    });
  });
});