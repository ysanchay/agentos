import { describe, it, expect } from 'vitest';
import { MessageRouter } from '../src/routing.js';
import { ChannelManager } from '../src/channel.js';
import { buildMessage } from '../src/message.js';
import type { ACPMessage } from '@agentos/types';

describe('routing', () => {
  function createTestRouter(): MessageRouter {
    const channelMgr = new ChannelManager();
    channelMgr.create('ch-general' as any);
    return new MessageRouter(channelMgr);
  }

  describe('direct routing', () => {
    it('routes to registered agent', () => {
      const router = createTestRouter();
      router.registerAgent('agent-1' as any);

      let received = false;
      router.onDirect('agent-1' as any, () => { received = true; });

      const msg = buildMessage('task.create', 'general', 3, 'agent-0' as any, 'agent-1' as any, {});
      const result = router.route(msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mode).toBe('direct');
        expect(result.data.recipients).toContain('agent-1');
      }
      expect(received).toBe(true);
    });

    it('returns error for unknown recipient', () => {
      const router = createTestRouter();
      const msg = buildMessage('task.create', 'general', 3, 'agent-0' as any, 'agent-999' as any, {});
      const result = router.route(msg);
      expect(result.ok).toBe(false);
    });
  });

  describe('channel routing', () => {
    it('routes to channel subscribers', () => {
      const channelMgr = new ChannelManager();
      channelMgr.create('ch-1' as any);
      channelMgr.subscribe('ch-1' as any, 'agent-1' as any);
      channelMgr.subscribe('ch-1' as any, 'agent-2' as any);

      const router = new MessageRouter(channelMgr);
      const msg = buildMessage('broadcast', 'ch-1', 3, 'agent-0' as any, 'ch-1' as any, { topic: 'test' });
      const result = router.route(msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mode).toBe('channel');
        expect(result.data.recipients).toHaveLength(2);
      }
    });
  });

  describe('broadcast routing', () => {
    it('routes to all registered agents', () => {
      const router = createTestRouter();
      router.registerAgent('agent-1' as any);
      router.registerAgent('agent-2' as any);
      router.registerAgent('agent-3' as any);

      const received: string[] = [];
      router.onDirect('agent-1' as any, () => received.push('agent-1'));
      router.onDirect('agent-2' as any, () => received.push('agent-2'));
      router.onDirect('agent-3' as any, () => received.push('agent-3'));

      const msg = buildMessage('broadcast', 'general', 3, 'agent-0' as any, '*', { topic: 'test' });
      const result = router.route(msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mode).toBe('broadcast');
        expect(result.data.recipients).toHaveLength(3);
      }
      expect(received).toHaveLength(3);
    });
  });

  describe('topic routing', () => {
    it('routes to topic subscribers', () => {
      const router = createTestRouter();
      router.registerAgent('agent-1' as any);
      router.subscribeTopic('updates', 'agent-1' as any);

      const received: ACPMessage[] = [];
      router.onDirect('agent-1' as any, (msg) => received.push(msg));

      const msg = buildMessage('broadcast', 'general', 3, 'agent-0' as any, 'unknown' as any, {}, {
        metadata: { topic: 'updates' },
      });
      const result = router.route(msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mode).toBe('topic');
        expect(result.data.recipients).toContain('agent-1');
      }
    });

    it('unsubscribe from topic', () => {
      const router = createTestRouter();
      router.registerAgent('agent-1' as any);
      router.subscribeTopic('updates', 'agent-1' as any);
      router.unsubscribeTopic('updates', 'agent-1' as any);

      const msg = buildMessage('broadcast', 'general', 3, 'agent-0' as any, 'unknown' as any, {}, {
        metadata: { topic: 'updates' },
      });
      const result = router.route(msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.recipients).toHaveLength(0);
      }
    });
  });

  describe('priority routing', () => {
    it('queues messages by priority', () => {
      const router = createTestRouter();
      const msg1 = buildMessage('task.create', 'general', 0, 'agent-0' as any, 'agent-1' as any, { title: 'System' });
      const msg2 = buildMessage('task.create', 'general', 3, 'agent-0' as any, 'agent-1' as any, { title: 'Normal' });

      router.routePriority(msg1);
      router.routePriority(msg2);

      expect(router.priorityQueueSize(0)).toBe(1);
      expect(router.priorityQueueSize(3)).toBe(1);
    });

    it('dequeues from highest priority first', () => {
      const router = createTestRouter();
      const low = buildMessage('task.create', 'general', 4, 'agent-0' as any, 'agent-1' as any, { title: 'Low' });
      const high = buildMessage('task.create', 'general', 0, 'agent-0' as any, 'agent-1' as any, { title: 'System' });

      router.routePriority(low);
      router.routePriority(high);

      const next = router.dequeueNext();
      expect(next).toBeTruthy();
      expect(next!.priority).toBe(0); // Higher priority dequeued first
    });
  });

  describe('unregisterAgent', () => {
    it('removes agent from all routing', () => {
      const router = createTestRouter();
      router.registerAgent('agent-1' as any);
      router.subscribeTopic('updates', 'agent-1' as any);

      router.unregisterAgent('agent-1' as any);

      // Agent should not receive direct messages
      const msg = buildMessage('task.create', 'general', 3, 'agent-0' as any, 'agent-1' as any, {});
      const result = router.route(msg);
      expect(result.ok).toBe(false);
    });
  });
});