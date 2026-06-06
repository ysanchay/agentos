import { describe, it, expect } from 'vitest';
import { ChannelManager } from '../src/channel.js';
import { buildMessage } from '../src/message.js';
import { createUUID, asUUID } from '@agentos/types';
import type { AgentID, ChannelID, ACPMessage } from '@agentos/types';

function makeChannelId(): ChannelID {
  return asUUID<ChannelID>(createUUID());
}

function makeAgentId(): AgentID {
  return asUUID<AgentID>(createUUID());
}

describe('channel', () => {
  describe('ChannelManager', () => {
    it('creates a channel', () => {
      const mgr = new ChannelManager();
      const chId = makeChannelId();
      const result = mgr.create(chId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe(chId);
        expect(result.data.subscribers.size).toBe(0);
      }
    });

    it('rejects creating duplicate channel', () => {
      const mgr = new ChannelManager();
      const chId = makeChannelId();
      mgr.create(chId);
      const result = mgr.create(chId);
      expect(result.ok).toBe(false);
    });

    it('creates a channel with custom maxSubscribers', () => {
      const mgr = new ChannelManager();
      const chId = makeChannelId();
      const result = mgr.create(chId, { maxSubscribers: 50 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.maxSubscribers).toBe(50);
      }
    });

    it('deletes a channel', () => {
      const mgr = new ChannelManager();
      const chId = makeChannelId();
      mgr.create(chId);
      const result = mgr.delete(chId);
      expect(result.ok).toBe(true);
      expect(mgr.getChannel(chId)).toBeUndefined();
    });

    it('returns error when deleting non-existent channel', () => {
      const mgr = new ChannelManager();
      const result = mgr.delete(makeChannelId());
      expect(result.ok).toBe(false);
    });

    it('subscribes and unsubscribes agents', () => {
      const mgr = new ChannelManager();
      const chId = makeChannelId();
      mgr.create(chId);

      const agentId = makeAgentId();
      const subResult = mgr.subscribe(chId, agentId);
      expect(subResult.ok).toBe(true);
      expect(mgr.subscriberCount(chId)).toBe(1);

      const unsubResult = mgr.unsubscribe(chId, agentId);
      expect(unsubResult.ok).toBe(true);
      expect(mgr.subscriberCount(chId)).toBe(0);
    });

    it('subscribe is idempotent', () => {
      const mgr = new ChannelManager();
      const chId = makeChannelId();
      mgr.create(chId);
      const agentId = makeAgentId();
      mgr.subscribe(chId, agentId);
      mgr.subscribe(chId, agentId);
      expect(mgr.subscriberCount(chId)).toBe(1);
    });

    it('rejects subscribe to non-existent channel', () => {
      const mgr = new ChannelManager();
      const result = mgr.subscribe(makeChannelId(), makeAgentId());
      expect(result.ok).toBe(false);
    });

    it('rejects subscribe when channel is full', () => {
      const mgr = new ChannelManager({ defaultMaxSubscribers: 2 });
      const chId = makeChannelId();
      mgr.create(chId, { maxSubscribers: 2 });
      mgr.subscribe(chId, makeAgentId());
      mgr.subscribe(chId, makeAgentId());
      const result = mgr.subscribe(chId, makeAgentId());
      expect(result.ok).toBe(false);
    });

    it('gets subscribers', () => {
      const mgr = new ChannelManager();
      const chId = makeChannelId();
      mgr.create(chId);
      const a1 = makeAgentId();
      const a2 = makeAgentId();
      mgr.subscribe(chId, a1);
      mgr.subscribe(chId, a2);

      const result = mgr.getSubscribers(chId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
        expect(result.data).toContain(a1);
        expect(result.data).toContain(a2);
      }
    });

    it('getSubscribers returns error for non-existent channel', () => {
      const mgr = new ChannelManager();
      const result = mgr.getSubscribers(makeChannelId());
      expect(result.ok).toBe(false);
    });

    it('delivers messages to channel subscribers', () => {
      const mgr = new ChannelManager();
      const chId = makeChannelId();
      mgr.create(chId);
      const a1 = makeAgentId();
      const a2 = makeAgentId();
      mgr.subscribe(chId, a1);
      mgr.subscribe(chId, a2);

      const msg = buildMessage('task.create', 'ch-1', 3, makeAgentId(), chId, { title: 'Test' });
      const result = mgr.deliver(chId, msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
      }
    });

    it('deliver returns error for non-existent channel', () => {
      const mgr = new ChannelManager();
      const msg = buildMessage('task.create', 'ch-1', 3, makeAgentId(), makeChannelId(), { title: 'Test' });
      const result = mgr.deliver(makeChannelId(), msg);
      expect(result.ok).toBe(false);
    });

    it('registers message handlers', () => {
      const mgr = new ChannelManager();
      const chId = makeChannelId();
      mgr.create(chId);
      mgr.subscribe(chId, makeAgentId());

      let received = false;
      mgr.onMessage(chId, () => { received = true; });

      const msg = buildMessage('task.create', 'ch-1', 3, makeAgentId(), chId, { title: 'Test' });
      mgr.deliver(chId, msg);
      expect(received).toBe(true);
    });

    it('onMessage returns error for non-existent channel', () => {
      const mgr = new ChannelManager();
      const result = mgr.onMessage(makeChannelId(), () => {});
      expect(result.ok).toBe(false);
    });

    it('isSubscribed works correctly', () => {
      const mgr = new ChannelManager();
      const chId = makeChannelId();
      mgr.create(chId);
      const agentId = makeAgentId();
      expect(mgr.isSubscribed(chId, agentId)).toBe(false);
      mgr.subscribe(chId, agentId);
      expect(mgr.isSubscribed(chId, agentId)).toBe(true);
    });

    it('isSubscribed returns false for non-existent channel', () => {
      const mgr = new ChannelManager();
      expect(mgr.isSubscribed(makeChannelId(), makeAgentId())).toBe(false);
    });

    it('lists all channels', () => {
      const mgr = new ChannelManager();
      mgr.create(makeChannelId());
      mgr.create(makeChannelId());
      expect(mgr.listChannels()).toHaveLength(2);
    });

    it('subscriberCount returns 0 for non-existent channel', () => {
      const mgr = new ChannelManager();
      expect(mgr.subscriberCount(makeChannelId())).toBe(0);
    });

    it('delivers to empty channel', () => {
      const mgr = new ChannelManager();
      const chId = makeChannelId();
      mgr.create(chId);

      const msg = buildMessage('task.create', 'ch-1', 3, makeAgentId(), chId, { title: 'Test' });
      const result = mgr.deliver(chId, msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(0);
      }
    });

    it('multiple handlers on same channel', () => {
      const mgr = new ChannelManager();
      const chId = makeChannelId();
      mgr.create(chId);
      mgr.subscribe(chId, makeAgentId());

      const received: ACPMessage[] = [];
      mgr.onMessage(chId, (msg) => received.push(msg));
      mgr.onMessage(chId, (msg) => received.push(msg));

      const msg = buildMessage('task.create', 'ch-1', 3, makeAgentId(), chId, { title: 'Test' });
      mgr.deliver(chId, msg);
      expect(received).toHaveLength(2);
    });
  });
});