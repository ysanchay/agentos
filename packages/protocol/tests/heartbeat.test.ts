import { describe, it, expect } from 'vitest';
import { HeartbeatManager } from '../src/heartbeat.js';
import { createUUID, asUUID } from '@agentos/types';
import type { AgentID } from '@agentos/types';

function makeAgentId(): AgentID {
  return asUUID<AgentID>(createUUID());
}

describe('heartbeat', () => {
  describe('HeartbeatManager', () => {
    it('registers an agent in healthy state', () => {
      const mgr = new HeartbeatManager();
      const agentId = makeAgentId();
      const entry = mgr.register(agentId);
      expect(entry.state).toBe('healthy');
      expect(entry.missedHeartbeats).toBe(0);
      expect(entry.agentId).toBe(agentId);
    });

    it('records heartbeat and maintains healthy state', () => {
      const mgr = new HeartbeatManager();
      const agentId = makeAgentId();
      mgr.register(agentId);
      const result = mgr.recordHeartbeat(agentId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.state).toBe('healthy');
        expect(result.data.missedHeartbeats).toBe(0);
      }
    });

    it('transitions healthy -> suspect when heartbeat is late', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      const agentId = makeAgentId();
      mgr.register(agentId);

      // Fast forward time by manipulating the last heartbeat
      const entry = mgr.getEntry(agentId)!;
      entry.lastHeartbeat = new Date(Date.now() - 150).toISOString();

      const changed = mgr.checkAll();
      expect(changed.length).toBeGreaterThan(0);
      expect(mgr.getState(agentId)).toBe('suspect');
      expect(entry.missedHeartbeats).toBe(1);
    });

    it('transitions suspect -> degraded when more heartbeats missed', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      const agentId = makeAgentId();
      mgr.register(agentId);

      const entry = mgr.getEntry(agentId)!;
      entry.lastHeartbeat = new Date(Date.now() - 250).toISOString();

      mgr.checkAll();
      expect(mgr.getState(agentId)).toBe('degraded');
      expect(entry.missedHeartbeats).toBe(2);
    });

    it('transitions degraded -> failed when enough heartbeats missed', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      const agentId = makeAgentId();
      mgr.register(agentId);

      const entry = mgr.getEntry(agentId)!;
      entry.lastHeartbeat = new Date(Date.now() - 400).toISOString();

      mgr.checkAll();
      expect(mgr.getState(agentId)).toBe('failed');
      expect(entry.missedHeartbeats).toBe(3);
    });

    it('does not transition if elapsed time is below threshold', () => {
      const mgr = new HeartbeatManager({ suspectMs: 1000, degradedMs: 2000, failedMs: 3000 });
      const agentId = makeAgentId();
      mgr.register(agentId);

      const entry = mgr.getEntry(agentId)!;
      entry.lastHeartbeat = new Date(Date.now() - 500).toISOString();

      mgr.checkAll();
      expect(mgr.getState(agentId)).toBe('healthy');
    });

    it('recovers suspect -> healthy on heartbeat', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      const agentId = makeAgentId();
      mgr.register(agentId);

      const entry = mgr.getEntry(agentId)!;
      entry.lastHeartbeat = new Date(Date.now() - 150).toISOString();
      mgr.checkAll();
      expect(mgr.getState(agentId)).toBe('suspect');

      mgr.recordHeartbeat(agentId);
      expect(mgr.getState(agentId)).toBe('healthy');
    });

    it('recovers degraded -> healthy on heartbeat', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      const agentId = makeAgentId();
      mgr.register(agentId);

      const entry = mgr.getEntry(agentId)!;
      entry.lastHeartbeat = new Date(Date.now() - 250).toISOString();
      mgr.checkAll();
      expect(mgr.getState(agentId)).toBe('degraded');

      mgr.recordHeartbeat(agentId);
      expect(mgr.getState(agentId)).toBe('healthy');
    });

    it('recovers failed -> degraded on heartbeat (partial recovery)', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      const agentId = makeAgentId();
      mgr.register(agentId);

      const entry = mgr.getEntry(agentId)!;
      entry.lastHeartbeat = new Date(Date.now() - 400).toISOString();
      mgr.checkAll();
      expect(mgr.getState(agentId)).toBe('failed');

      mgr.recordHeartbeat(agentId);
      expect(mgr.getState(agentId)).toBe('degraded');
    });

    it('tracks state history', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      const agentId = makeAgentId();
      mgr.register(agentId);

      const entry = mgr.getEntry(agentId)!;
      entry.lastHeartbeat = new Date(Date.now() - 150).toISOString();
      mgr.checkAll();

      expect(entry.stateHistory.length).toBeGreaterThan(0);
      expect(entry.stateHistory[0]!.from).toBe('healthy');
      expect(entry.stateHistory[0]!.to).toBe('suspect');
    });

    it('unregisters an agent', () => {
      const mgr = new HeartbeatManager();
      const agentId = makeAgentId();
      mgr.register(agentId);
      mgr.unregister(agentId);
      expect(mgr.getState(agentId)).toBeUndefined();
      expect(mgr.getEntry(agentId)).toBeUndefined();
    });

    it('returns error for unregistered agent heartbeat', () => {
      const mgr = new HeartbeatManager();
      const result = mgr.recordHeartbeat(makeAgentId());
      expect(result.ok).toBe(false);
    });

    it('getAgentsByState returns correct agents', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      const a1 = makeAgentId();
      const a2 = makeAgentId();
      const a3 = makeAgentId();
      mgr.register(a1);
      mgr.register(a2);
      mgr.register(a3);

      // Force agent-2 into suspect
      const entry2 = mgr.getEntry(a2)!;
      entry2.lastHeartbeat = new Date(Date.now() - 150).toISOString();
      mgr.checkAll();

      const healthy = mgr.getAgentsByState('healthy');
      const suspect = mgr.getAgentsByState('suspect');
      expect(healthy).toHaveLength(2);
      expect(suspect).toHaveLength(1);
      expect(suspect).toContain(a2);
    });

    it('getAgentsByState for failed returns empty when none failed', () => {
      const mgr = new HeartbeatManager();
      const agentId = makeAgentId();
      mgr.register(agentId);
      expect(mgr.getAgentsByState('failed')).toHaveLength(0);
    });

    it('timeSinceLastHeartbeat returns elapsed time', () => {
      const mgr = new HeartbeatManager();
      const agentId = makeAgentId();
      mgr.register(agentId);

      const elapsed = mgr.timeSinceLastHeartbeat(agentId);
      expect(elapsed).toBeGreaterThanOrEqual(0);
      expect(elapsed).toBeLessThan(1000); // Should be very recent
    });

    it('timeSinceLastHeartbeat returns undefined for unknown agent', () => {
      const mgr = new HeartbeatManager();
      expect(mgr.timeSinceLastHeartbeat(makeAgentId())).toBeUndefined();
    });

    it('isValidTransition checks state transitions', () => {
      const mgr = new HeartbeatManager();
      // Valid transitions
      expect(mgr.isValidTransition('healthy', 'suspect')).toBe(true);
      expect(mgr.isValidTransition('suspect', 'degraded')).toBe(true);
      expect(mgr.isValidTransition('degraded', 'failed')).toBe(true);
      expect(mgr.isValidTransition('suspect', 'healthy')).toBe(true);
      expect(mgr.isValidTransition('degraded', 'suspect')).toBe(true);
      expect(mgr.isValidTransition('failed', 'degraded')).toBe(true);

      // Invalid transitions
      expect(mgr.isValidTransition('healthy', 'failed')).toBe(false);
      expect(mgr.isValidTransition('healthy', 'degraded')).toBe(false);
      expect(mgr.isValidTransition('failed', 'healthy')).toBe(false);
      expect(mgr.isValidTransition('failed', 'suspect')).toBe(false);
    });

    it('getTrackedAgents returns all tracked agents', () => {
      const mgr = new HeartbeatManager();
      const a1 = makeAgentId();
      const a2 = makeAgentId();
      mgr.register(a1);
      mgr.register(a2);
      expect(mgr.getTrackedAgents()).toHaveLength(2);
    });

    it('checkAll handles recovery timeout for failed agents', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300, recoveryTimeoutMs: 500 });
      const agentId = makeAgentId();
      mgr.register(agentId);

      // Force to failed
      const entry = mgr.getEntry(agentId)!;
      entry.lastHeartbeat = new Date(Date.now() - 400).toISOString();
      mgr.checkAll();
      expect(mgr.getState(agentId)).toBe('failed');

      // Check again - should still be failed
      mgr.checkAll();
      expect(mgr.getState(agentId)).toBe('failed');
    });

    it('suspect does not transition to degraded if already degraded', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      const agentId = makeAgentId();
      mgr.register(agentId);

      const entry = mgr.getEntry(agentId)!;
      entry.lastHeartbeat = new Date(Date.now() - 250).toISOString();
      mgr.checkAll();
      expect(mgr.getState(agentId)).toBe('degraded');

      // Check again - should stay degraded, not try to transition suspect
      mgr.checkAll();
      expect(mgr.getState(agentId)).toBe('degraded');
    });
  });
});