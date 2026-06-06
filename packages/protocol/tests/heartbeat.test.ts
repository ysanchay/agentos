import { describe, it, expect, vi } from 'vitest';
import { HeartbeatManager } from '../src/heartbeat.js';

describe('heartbeat', () => {
  describe('HeartbeatManager', () => {
    it('registers an agent in healthy state', () => {
      const mgr = new HeartbeatManager();
      const entry = mgr.register('agent-1' as any);
      expect(entry.state).toBe('healthy');
      expect(entry.missedHeartbeats).toBe(0);
    });

    it('records heartbeat and maintains healthy state', () => {
      const mgr = new HeartbeatManager();
      mgr.register('agent-1' as any);
      const result = mgr.recordHeartbeat('agent-1' as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.state).toBe('healthy');
      }
    });

    it('transitions healthy -> suspect when heartbeat is late', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      mgr.register('agent-1' as any);

      // Fast forward time by manipulating the last heartbeat
      const entry = mgr.getEntry('agent-1' as any)!;
      entry.lastHeartbeat = new Date(Date.now() - 150).toISOString();

      const changed = mgr.checkAll();
      expect(changed.length).toBeGreaterThan(0);
      expect(mgr.getState('agent-1' as any)).toBe('suspect');
    });

    it('transitions suspect -> degraded when more heartbeats missed', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      mgr.register('agent-1' as any);

      const entry = mgr.getEntry('agent-1' as any)!;
      entry.lastHeartbeat = new Date(Date.now() - 250).toISOString();

      mgr.checkAll();
      expect(mgr.getState('agent-1' as any)).toBe('degraded');
    });

    it('transitions degraded -> failed when enough heartbeats missed', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      mgr.register('agent-1' as any);

      const entry = mgr.getEntry('agent-1' as any)!;
      entry.lastHeartbeat = new Date(Date.now() - 400).toISOString();

      mgr.checkAll();
      expect(mgr.getState('agent-1' as any)).toBe('failed');
    });

    it('recovers suspect -> healthy on heartbeat', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      mgr.register('agent-1' as any);

      // Force suspect state
      const entry = mgr.getEntry('agent-1' as any)!;
      entry.lastHeartbeat = new Date(Date.now() - 150).toISOString();
      mgr.checkAll();
      expect(mgr.getState('agent-1' as any)).toBe('suspect');

      // Heartbeat recovers to healthy
      mgr.recordHeartbeat('agent-1' as any);
      expect(mgr.getState('agent-1' as any)).toBe('healthy');
    });

    it('recovers degraded -> healthy on heartbeat', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      mgr.register('agent-1' as any);

      const entry = mgr.getEntry('agent-1' as any)!;
      entry.lastHeartbeat = new Date(Date.now() - 250).toISOString();
      mgr.checkAll();
      expect(mgr.getState('agent-1' as any)).toBe('degraded');

      mgr.recordHeartbeat('agent-1' as any);
      expect(mgr.getState('agent-1' as any)).toBe('healthy');
    });

    it('recovers failed -> degraded on heartbeat (partial recovery)', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      mgr.register('agent-1' as any);

      const entry = mgr.getEntry('agent-1' as any)!;
      entry.lastHeartbeat = new Date(Date.now() - 400).toISOString();
      mgr.checkAll();
      expect(mgr.getState('agent-1' as any)).toBe('failed');

      mgr.recordHeartbeat('agent-1' as any);
      expect(mgr.getState('agent-1' as any)).toBe('degraded');
    });

    it('tracks state history', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      mgr.register('agent-1' as any);

      const entry = mgr.getEntry('agent-1' as any)!;
      entry.lastHeartbeat = new Date(Date.now() - 150).toISOString();
      mgr.checkAll();

      expect(entry.stateHistory.length).toBeGreaterThan(0);
      expect(entry.stateHistory[0]!.from).toBe('healthy');
      expect(entry.stateHistory[0]!.to).toBe('suspect');
    });

    it('unregisters an agent', () => {
      const mgr = new HeartbeatManager();
      mgr.register('agent-1' as any);
      mgr.unregister('agent-1' as any);
      expect(mgr.getState('agent-1' as any)).toBeUndefined();
    });

    it('returns error for unregistered agent heartbeat', () => {
      const mgr = new HeartbeatManager();
      const result = mgr.recordHeartbeat('agent-999' as any);
      expect(result.ok).toBe(false);
    });

    it('getAgentsByState returns correct agents', () => {
      const mgr = new HeartbeatManager({ suspectMs: 100, degradedMs: 200, failedMs: 300 });
      mgr.register('agent-1' as any);
      mgr.register('agent-2' as any);
      mgr.register('agent-3' as any);

      // Force agent-2 into suspect
      const entry2 = mgr.getEntry('agent-2' as any)!;
      entry2.lastHeartbeat = new Date(Date.now() - 150).toISOString();
      mgr.checkAll();

      const healthy = mgr.getAgentsByState('healthy');
      const suspect = mgr.getAgentsByState('suspect');
      expect(healthy).toHaveLength(2);
      expect(suspect).toHaveLength(1);
      expect(suspect).toContain('agent-2');
    });

    it('timeSinceLastHeartbeat returns elapsed time', () => {
      const mgr = new HeartbeatManager();
      mgr.register('agent-1' as any);

      const elapsed = mgr.timeSinceLastHeartbeat('agent-1' as any);
      expect(elapsed).toBeGreaterThanOrEqual(0);
      expect(elapsed).toBeLessThan(1000); // Should be very recent
    });

    it('isValidTransition checks state transitions', () => {
      const mgr = new HeartbeatManager();
      expect(mgr.isValidTransition('healthy', 'suspect')).toBe(true);
      expect(mgr.isValidTransition('suspect', 'degraded')).toBe(true);
      expect(mgr.isValidTransition('degraded', 'failed')).toBe(true);
      expect(mgr.isValidTransition('suspect', 'healthy')).toBe(true);
      expect(mgr.isValidTransition('failed', 'degraded')).toBe(true);
      expect(mgr.isValidTransition('healthy', 'failed')).toBe(false);
      expect(mgr.isValidTransition('failed', 'healthy')).toBe(false);
    });

    it('getTrackedAgents returns all tracked agents', () => {
      const mgr = new HeartbeatManager();
      mgr.register('agent-1' as any);
      mgr.register('agent-2' as any);
      expect(mgr.getTrackedAgents()).toHaveLength(2);
    });
  });
});