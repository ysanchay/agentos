import { describe, it, expect } from 'vitest';
import { MessageRouter } from '../src/routing.js';
import { ChannelManager } from '../src/channel.js';
import { buildMessage } from '../src/message.js';
import { createUUID, asUUID } from '@agentos/types';
import type { ACPMessage, AgentID, ChannelID } from '@agentos/types';

function makeAgentId(): AgentID {
  return asUUID<AgentID>(createUUID());
}

function makeChannelId(): ChannelID {
  return asUUID<ChannelID>(createUUID());
}

describe('routing', () => {
  function createTestRouter(): MessageRouter {
    const channelMgr = new ChannelManager();
    return new MessageRouter(channelMgr);
  }

  describe('direct routing', () => {
    it('routes to registered agent', () => {
      const router = createTestRouter();
      const agent1 = makeAgentId();
      router.registerAgent(agent1);

      let received = false;
      router.onDirect(agent1, () => { received = true; });

      const msg = buildMessage('task.create', 'general', 3, makeAgentId(), agent1, {});
      const result = router.route(msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mode).toBe('direct');
        expect(result.data.recipients).toContain(agent1);
      }
      expect(received).toBe(true);
    });

    it('returns error for unknown recipient', () => {
      const router = createTestRouter();
      const msg = buildMessage('task.create', 'general', 3, makeAgentId(), makeAgentId(), {});
      const result = router.route(msg);
      expect(result.ok).toBe(false);
    });

    it('routeDirect explicitly routes to an agent', () => {
      const router = createTestRouter();
      const agent1 = makeAgentId();
      router.registerAgent(agent1);

      let received = false;
      router.onDirect(agent1, () => { received = true; });

      const msg = buildMessage('task.create', 'general', 3, makeAgentId(), agent1, {});
      const result = router.routeDirect(msg, agent1);
      expect(result.ok).toBe(true);
      expect(received).toBe(true);
    });
  });

  describe('channel routing', () => {
    it('routes to channel subscribers', () => {
      const channelMgr = new ChannelManager();
      const chId = makeChannelId();
      channelMgr.create(chId);
      const agent1 = makeAgentId();
      const agent2 = makeAgentId();
      channelMgr.subscribe(chId, agent1);
      channelMgr.subscribe(chId, agent2);

      const router = new MessageRouter(channelMgr);
      const msg = buildMessage('broadcast', 'ch-1', 3, makeAgentId(), chId, { topic: 'test' });
      const result = router.route(msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mode).toBe('channel');
        expect(result.data.recipients).toHaveLength(2);
      }
    });

    it('routeChannel returns error for non-existent channel', () => {
      const channelMgr = new ChannelManager();
      const router = new MessageRouter(channelMgr);
      const chId = makeChannelId();
      const msg = buildMessage('broadcast', 'ch-1', 3, makeAgentId(), chId, {});
      const result = router.routeChannel(msg, chId);
      expect(result.ok).toBe(false);
    });
  });

  describe('broadcast routing', () => {
    it('routes to all registered agents', () => {
      const router = createTestRouter();
      const agents = [makeAgentId(), makeAgentId(), makeAgentId()];
      for (const a of agents) router.registerAgent(a);

      const received: string[] = [];
      for (const a of agents) {
        router.onDirect(a, () => received.push(a));
      }

      const msg = buildMessage('broadcast', 'general', 3, makeAgentId(), '*', { topic: 'test' });
      const result = router.route(msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mode).toBe('broadcast');
        expect(result.data.recipients).toHaveLength(3);
      }
      expect(received).toHaveLength(3);
    });

    it('routeBroadcast returns empty recipients when no agents registered', () => {
      const router = createTestRouter();
      const msg = buildMessage('broadcast', 'general', 3, makeAgentId(), '*', {});
      const result = router.routeBroadcast(msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.recipients).toHaveLength(0);
      }
    });
  });

  describe('topic routing', () => {
    it('routes to topic subscribers', () => {
      const router = createTestRouter();
      const agent1 = makeAgentId();
      router.registerAgent(agent1);
      router.subscribeTopic('updates', agent1);

      const received: ACPMessage[] = [];
      router.onDirect(agent1, (msg) => received.push(msg));

      const msg = buildMessage('broadcast', 'general', 3, makeAgentId(), makeAgentId(), {}, {
        metadata: { topic: 'updates' },
      });
      const result = router.route(msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.mode).toBe('topic');
        expect(result.data.recipients).toContain(agent1);
      }
    });

    it('returns empty recipients for unknown topic', () => {
      const router = createTestRouter();
      const msg = buildMessage('broadcast', 'general', 3, makeAgentId(), makeAgentId(), {}, {
        metadata: { topic: 'nonexistent' },
      });
      const result = router.route(msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.recipients).toHaveLength(0);
      }
    });

    it('unsubscribe from topic', () => {
      const router = createTestRouter();
      const agent1 = makeAgentId();
      router.registerAgent(agent1);
      router.subscribeTopic('updates', agent1);
      router.unsubscribeTopic('updates', agent1);

      const msg = buildMessage('broadcast', 'general', 3, makeAgentId(), makeAgentId(), {}, {
        metadata: { topic: 'updates' },
      });
      const result = router.route(msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.recipients).toHaveLength(0);
      }
    });

    it('routeTopic delivers via topic handlers', () => {
      const router = createTestRouter();
      const agent1 = makeAgentId();
      router.registerAgent(agent1);
      router.subscribeTopic('updates', agent1);

      let handlerCalled = false;
      router.onTopic('updates', () => { handlerCalled = true; });

      const msg = buildMessage('broadcast', 'general', 3, makeAgentId(), makeAgentId(), {}, {
        metadata: { topic: 'updates' },
      });
      router.route(msg);
      expect(handlerCalled).toBe(true);
    });
  });

  describe('priority routing', () => {
    it('queues messages by priority', () => {
      const router = createTestRouter();
      const agent1 = makeAgentId();
      const msg1 = buildMessage('task.create', 'general', 0, makeAgentId(), agent1, { title: 'System' });
      const msg2 = buildMessage('task.create', 'general', 3, makeAgentId(), agent1, { title: 'Normal' });

      router.routePriority(msg1);
      router.routePriority(msg2);

      expect(router.priorityQueueSize(0)).toBe(1);
      expect(router.priorityQueueSize(3)).toBe(1);
    });

    it('dequeues from highest priority first', () => {
      const router = createTestRouter();
      const agent1 = makeAgentId();
      const low = buildMessage('task.create', 'general', 4, makeAgentId(), agent1, { title: 'Low' });
      const high = buildMessage('task.create', 'general', 0, makeAgentId(), agent1, { title: 'System' });

      router.routePriority(low);
      router.routePriority(high);

      const next = router.dequeueNext();
      expect(next).toBeTruthy();
      expect(next!.priority).toBe(0); // Higher priority dequeued first
    });

    it('dequeueNext returns undefined when all queues empty', () => {
      const router = createTestRouter();
      expect(router.dequeueNext()).toBeUndefined();
    });

    it('dequeues multiple messages in priority order', () => {
      const router = createTestRouter();
      const agent1 = makeAgentId();
      const msg0 = buildMessage('task.create', 'general', 0, makeAgentId(), agent1, { title: 'P0' });
      const msg2 = buildMessage('task.create', 'general', 2, makeAgentId(), agent1, { title: 'P2' });
      const msg4 = buildMessage('task.create', 'general', 4, makeAgentId(), agent1, { title: 'P4' });

      router.routePriority(msg4);
      router.routePriority(msg0);
      router.routePriority(msg2);

      expect(router.dequeueNext()!.priority).toBe(0);
      expect(router.dequeueNext()!.priority).toBe(2);
      expect(router.dequeueNext()!.priority).toBe(4);
      expect(router.dequeueNext()).toBeUndefined();
    });
  });

  describe('unregisterAgent', () => {
    it('removes agent from all routing', () => {
      const router = createTestRouter();
      const agent1 = makeAgentId();
      router.registerAgent(agent1);
      router.subscribeTopic('updates', agent1);

      router.unregisterAgent(agent1);

      const msg = buildMessage('task.create', 'general', 3, makeAgentId(), agent1, {});
      const result = router.route(msg);
      expect(result.ok).toBe(false);
    });
  });

  describe('getChannelManager', () => {
    it('returns the channel manager instance', () => {
      const channelMgr = new ChannelManager();
      const router = new MessageRouter(channelMgr);
      expect(router.getChannelManager()).toBe(channelMgr);
    });
  });

  describe('priorityQueueSize', () => {
    it('returns 0 for empty queue', () => {
      const router = createTestRouter();
      expect(router.priorityQueueSize(0)).toBe(0);
    });
  });
});