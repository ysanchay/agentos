import { describe, it, expect, beforeEach } from 'vitest';
import { ResourceScheduler } from '../src/scheduler.js';
import type { AllocationRecord } from '../src/allocator.js';
import { AllocationState } from '@agentos/types';
import type { AgentID, WorkspaceID, Priority, ResourceBudget } from '@agentos/types';
import { createUUID } from '@agentos/types';

function makeAgentId(): AgentID {
  return createUUID() as unknown as AgentID;
}

function makeWorkspaceId(): WorkspaceID {
  return createUUID() as unknown as WorkspaceID;
}

function makeRequest(overrides: Partial<{
  requester: string;
  workspace_id: string;
  priority: number;
  ru: number;
  mu: number;
  eu: number;
  vu: number;
  duration_ms: number;
  preemptible: boolean;
  reason: string;
}> = {}) {
  return {
    requester: overrides.requester ?? makeAgentId(),
    workspace_id: overrides.workspace_id ?? makeWorkspaceId(),
    priority: (overrides.priority ?? 3) as Priority,
    ru: overrides.ru ?? 10,
    mu: overrides.mu ?? 5,
    eu: overrides.eu ?? 1,
    vu: overrides.vu ?? 1,
    duration_ms: overrides.duration_ms ?? 3600000,
    preemptible: overrides.preemptible ?? true,
    reason: overrides.reason ?? 'test',
  };
}

const smallCapacity: ResourceBudget = { ru: 100, mu: 50, eu: 10, vu: 5 };

describe('ResourceScheduler', () => {
  let scheduler: ResourceScheduler;

  beforeEach(() => {
    scheduler = new ResourceScheduler({ totalCapacity: smallCapacity });
  });

  describe('requestAllocation', () => {
    it('should successfully allocate resources', () => {
      const agentId = makeAgentId();
      const workspaceId = makeWorkspaceId();
      const request = makeRequest({ requester: agentId, workspace_id: workspaceId, ru: 10, mu: 5, eu: 1, vu: 1 });

      const result = scheduler.requestAllocation(agentId, workspaceId, request);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.state).toBe(AllocationState.ACTIVE);
        expect(result.data.ru_allocated).toBe(10);
        expect(result.data.mu_allocated).toBe(5);
        expect(result.data.agent_id).toBe(agentId);
        expect(result.data.workspace_id).toBe(workspaceId);
      }
    });

    it('should track allocation after granting', () => {
      const agentId = makeAgentId();
      const request = makeRequest({ requester: agentId, ru: 10, mu: 5, eu: 1, vu: 1 });

      const result = scheduler.requestAllocation(agentId, makeWorkspaceId(), request);
      expect(result.ok).toBe(true);

      if (result.ok) {
        const retrieved = scheduler.getAllocation(result.data.id);
        expect(retrieved).toBeDefined();
        expect(retrieved!.state).toBe(AllocationState.ACTIVE);
      }
    });

    it('should fail when resources are exhausted', () => {
      // Fill up capacity
      const agent1 = makeAgentId();
      const ws1 = makeWorkspaceId();
      const bigRequest = makeRequest({ requester: agent1, workspace_id: ws1, ru: 90, mu: 45, eu: 9, vu: 4 });
      const r1 = scheduler.requestAllocation(agent1, ws1, bigRequest);
      expect(r1.ok).toBe(true);

      // Try to allocate more than remaining
      const agent2 = makeAgentId();
      const ws2 = makeWorkspaceId();
      const overflowRequest = makeRequest({ requester: agent2, workspace_id: ws2, ru: 20, mu: 10, eu: 2, vu: 2 });
      const r2 = scheduler.requestAllocation(agent2, ws2, overflowRequest);
      expect(r2.ok).toBe(false);
    });

    it('should reject allocation when concurrent limit is reached', () => {
      const smallScheduler = new ResourceScheduler({
        totalCapacity: { ru: 10000, mu: 5000, eu: 1000, vu: 500 },
        maxConcurrentPerAgent: 2,
      });

      const agentId = makeAgentId();
      const wsId = makeWorkspaceId();

      // Create 2 allocations (max)
      smallScheduler.requestAllocation(agentId, wsId, makeRequest({ requester: agentId }));
      smallScheduler.requestAllocation(agentId, wsId, makeRequest({ requester: agentId }));

      // 3rd should fail
      const result = smallScheduler.requestAllocation(agentId, wsId, makeRequest({ requester: agentId }));
      expect(result.ok).toBe(false);
    });
  });

  describe('releaseAllocation', () => {
    it('should release an active allocation', () => {
      const agentId = makeAgentId();
      const request = makeRequest({ requester: agentId, ru: 10, mu: 5, eu: 1, vu: 1 });

      const allocResult = scheduler.requestAllocation(agentId, makeWorkspaceId(), request);
      expect(allocResult.ok).toBe(true);

      if (allocResult.ok) {
        const releaseResult = scheduler.releaseAllocation(allocResult.data.id);
        expect(releaseResult.ok).toBe(true);

        const retrieved = scheduler.getAllocation(allocResult.data.id);
        expect(retrieved!.state).toBe(AllocationState.RELEASED);
      }
    });

    it('should fail for non-existent allocation', () => {
      const result = scheduler.releaseAllocation('non-existent' as any);
      expect(result.ok).toBe(false);
    });
  });

  describe('revokeAllocation', () => {
    it('should revoke an active allocation', () => {
      const agentId = makeAgentId();
      const request = makeRequest({ requester: agentId });

      const allocResult = scheduler.requestAllocation(agentId, makeWorkspaceId(), request);
      expect(allocResult.ok).toBe(true);

      if (allocResult.ok) {
        const revokeResult = scheduler.revokeAllocation(allocResult.data.id, 'admin action');
        expect(revokeResult.ok).toBe(true);

        const retrieved = scheduler.getAllocation(allocResult.data.id);
        expect(retrieved!.state).toBe(AllocationState.REVOKED);
      }
    });

    it('should fail for non-existent allocation', () => {
      const result = scheduler.revokeAllocation('non-existent' as any, 'test');
      expect(result.ok).toBe(false);
    });
  });

  describe('reportConsumption', () => {
    it('should update consumption for an active allocation', () => {
      const agentId = makeAgentId();
      const request = makeRequest({ requester: agentId, ru: 100, mu: 50, eu: 10, vu: 5 });

      const allocResult = scheduler.requestAllocation(agentId, makeWorkspaceId(), request);
      expect(allocResult.ok).toBe(true);

      if (allocResult.ok) {
        const consumptionResult = scheduler.reportConsumption(allocResult.data.id, {
          ru: 10, mu: 5, eu: 1, vu: 0,
        });
        expect(consumptionResult.ok).toBe(true);
        if (consumptionResult.ok) {
          expect(consumptionResult.data.ru_consumed).toBe(10);
          expect(consumptionResult.data.mu_consumed).toBe(5);
          expect(consumptionResult.data.eu_consumed).toBe(1);
        }
      }
    });

    it('should accumulate consumption across reports', () => {
      const agentId = makeAgentId();
      const request = makeRequest({ requester: agentId, ru: 100, mu: 50, eu: 10, vu: 5 });

      const allocResult = scheduler.requestAllocation(agentId, makeWorkspaceId(), request);
      expect(allocResult.ok).toBe(true);

      if (allocResult.ok) {
        scheduler.reportConsumption(allocResult.data.id, { ru: 10, mu: 5, eu: 1, vu: 0 });
        const result = scheduler.reportConsumption(allocResult.data.id, { ru: 5, mu: 3, eu: 0, vu: 1 });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.data.ru_consumed).toBe(15);
          expect(result.data.mu_consumed).toBe(8);
        }
      }
    });

    it('should fail for non-existent allocation', () => {
      const result = scheduler.reportConsumption('non-existent' as any, { ru: 10, mu: 5, eu: 1, vu: 0 });
      expect(result.ok).toBe(false);
    });

    it('should reject consumption exceeding allocation (conservation)', () => {
      const agentId = makeAgentId();
      const request = makeRequest({ requester: agentId, ru: 10, mu: 5, eu: 1, vu: 1 });

      const allocResult = scheduler.requestAllocation(agentId, makeWorkspaceId(), request);
      expect(allocResult.ok).toBe(true);

      if (allocResult.ok) {
        const result = scheduler.reportConsumption(allocResult.data.id, {
          ru: 100, mu: 5, eu: 1, vu: 0, // ru: 100 > 10 allocated
        });
        expect(result.ok).toBe(false);
      }
    });
  });

  describe('query methods', () => {
    it('getActiveAllocations should return active allocations', () => {
      const agent1 = makeAgentId();
      const agent2 = makeAgentId();

      scheduler.requestAllocation(agent1, makeWorkspaceId(), makeRequest({ requester: agent1 }));
      scheduler.requestAllocation(agent2, makeWorkspaceId(), makeRequest({ requester: agent2 }));

      const active = scheduler.getActiveAllocations();
      expect(active).toHaveLength(2);
      expect(active.every(a => a.state === AllocationState.ACTIVE)).toBe(true);
    });

    it('getActiveAllocationsForAgent should filter by agent', () => {
      const agent1 = makeAgentId();
      const agent2 = makeAgentId();
      const wsId = makeWorkspaceId();

      scheduler.requestAllocation(agent1, wsId, makeRequest({ requester: agent1 }));
      scheduler.requestAllocation(agent1, wsId, makeRequest({ requester: agent1 }));
      scheduler.requestAllocation(agent2, wsId, makeRequest({ requester: agent2 }));

      const active1 = scheduler.getActiveAllocationsForAgent(agent1);
      expect(active1).toHaveLength(2);
      expect(active1.every(a => a.agent_id === agent1)).toBe(true);
    });

    it('getAllocationsForWorkspace should filter by workspace', () => {
      const ws1 = makeWorkspaceId();
      const ws2 = makeWorkspaceId();
      const agent = makeAgentId();

      scheduler.requestAllocation(agent, ws1, makeRequest({ requester: agent, workspace_id: ws1 }));
      scheduler.requestAllocation(agent, ws2, makeRequest({ requester: agent, workspace_id: ws2 }));

      const ws1Allocs = scheduler.getAllocationsForWorkspace(ws1);
      expect(ws1Allocs).toHaveLength(1);
      expect(ws1Allocs[0].workspace_id).toBe(ws1);
    });

    it('getTotalAllocated should sum active allocations', () => {
      const agent = makeAgentId();
      const ws1 = makeWorkspaceId();
      const ws2 = makeWorkspaceId();

      scheduler.requestAllocation(agent, ws1, makeRequest({ requester: agent, ru: 20, mu: 10, eu: 2, vu: 1 }));
      scheduler.requestAllocation(agent, ws2, makeRequest({ requester: agent, ru: 30, mu: 15, eu: 3, vu: 1 }));

      const total = scheduler.getTotalAllocated();
      expect(total.ru).toBe(50);
      expect(total.mu).toBe(25);
      expect(total.eu).toBe(5);
      expect(total.vu).toBe(2);
    });

    it('getAvailableCapacity should return remaining capacity', () => {
      const agent = makeAgentId();
      const wsId = makeWorkspaceId();
      scheduler.requestAllocation(agent, wsId, makeRequest({ requester: agent, ru: 30, mu: 15, eu: 3, vu: 1 }));

      const available = scheduler.getAvailableCapacity();
      expect(available.ru).toBe(70); // 100 - 30
      expect(available.mu).toBe(35); // 50 - 15
      expect(available.eu).toBe(7); // 10 - 3
      expect(available.vu).toBe(4); // 5 - 1
    });
  });

  describe('verifyConservation', () => {
    it('should verify conservation laws hold', () => {
      const agent = makeAgentId();
      const wsId = makeWorkspaceId();
      scheduler.requestAllocation(agent, wsId, makeRequest({ requester: agent, ru: 20, mu: 10, eu: 2, vu: 1 }));

      const result = scheduler.verifyConservation();
      expect(result.valid).toBe(true);
    });
  });

  describe('subsystem access', () => {
    it('should expose quota engine', () => {
      expect(scheduler.getQuotaEngine()).toBeDefined();
    });

    it('should expose preemption engine', () => {
      expect(scheduler.getPreemptionEngine()).toBeDefined();
    });

    it('should expose throttle engine', () => {
      expect(scheduler.getThrottleEngine()).toBeDefined();
    });

    it('should expose fairness engine', () => {
      expect(scheduler.getFairnessEngine()).toBeDefined();
    });

    it('should expose budget enforcer', () => {
      expect(scheduler.getBudgetEnforcer()).toBeDefined();
    });

    it('should expose conservation enforcer', () => {
      expect(scheduler.getConservationEnforcer()).toBeDefined();
    });
  });
});