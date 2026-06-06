import { describe, it, expect } from 'vitest';
import { ChannelManager } from '../src/channel.js';
import { buildMessage } from '../src/message.js';

describe('channel', () => {
  describe('ChannelManager', () => {
    it('creates a channel', () => {
      const mgr = new ChannelManager();
      const result = mgr.create('ch-1' as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.id).toBe('ch-1');
        expect(result.data.subscribers.size).toBe(0);
      }
    });

    it('rejects creating duplicate channel', () => {
      const mgr = new ChannelManager();
      mgr.create('ch-1' as any);
      const result = mgr.create('ch-1' as any);
      expect(result.ok).toBe(false);
    });

    it('deletes a channel', () => {
      const mgr = new ChannelManager();
      mgr.create('ch-1' as any);
      const result = mgr.delete('ch-1' as any);
      expect(result.ok).toBe(true);
      expect(mgr.getChannel('ch-1' as any)).toBeUndefined();
    });

    it('subscribes and unsubscribes agents', () => {
      const mgr = new ChannelManager();
      mgr.create('ch-1' as any);

      const subResult = mgr.subscribe('ch-1' as any, 'agent-1' as any);
      expect(subResult.ok).toBe(true);
      expect(mgr.subscriberCount('ch-1' as any)).toBe(1);

      const unsubResult = mgr.unsubscribe('ch-1' as any, 'agent-1' as any);
      expect(unsubResult.ok).toBe(true);
      expect(mgr.subscriberCount('ch-1' as any)).toBe(0);
    });

    it('subscribe is idempotent', () => {
      const mgr = new ChannelManager();
      mgr.create('ch-1' as any);
      mgr.subscribe('ch-1' as any, 'agent-1' as any);
      mgr.subscribe('ch-1' as any, 'agent-1' as any);
      expect(mgr.subscriberCount('ch-1' as any)).toBe(1);
    });

    it('rejects subscribe to non-existent channel', () => {
      const mgr = new ChannelManager();
      const result = mgr.subscribe('ch-999' as any, 'agent-1' as any);
      expect(result.ok).toBe(false);
    });

    it('rejects subscribe when channel is full', () => {
      const mgr = new ChannelManager({ defaultMaxSubscribers: 2 });
      mgr.create('ch-1' as any, { maxSubscribers: 2 });
      mgr.subscribe('ch-1' as any, 'agent-1' as any);
      mgr.subscribe('ch-1' as any, 'agent-2' as any);
      const result = mgr.subscribe('ch-1' as any, 'agent-3' as any);
      expect(result.ok).toBe(false);
    });

    it('gets subscribers', () => {
      const mgr = new ChannelManager();
      mgr.create('ch-1' as any);
      mgr.subscribe('ch-1' as any, 'agent-1' as any);
      mgr.subscribe('ch-1' as any, 'agent-2' as any);

      const result = mgr.getSubscribers('ch-1' as any);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
        expect(result.data).toContain('agent-1');
        expect(result.data).toContain('agent-2');
      }
    });

    it('delivers messages to channel subscribers', () => {
      const mgr = new ChannelManager();
      mgr.create('ch-1' as any);
      mgr.subscribe('ch-1' as any, 'agent-1' as any);
      mgr.subscribe('ch-1' as any, 'agent-2' as any);

      const msg = buildMessage('task.create', 'ch-1', 3, 'agent-0' as any, 'ch-1' as any, { title: 'Test' });
      const result = mgr.deliver('ch-1' as any, msg);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toHaveLength(2);
      }
    });

    it('registers message handlers', () => {
      const mgr = new ChannelManager();
      mgr.create('ch-1' as any);
      mgr.subscribe('ch-1' as any, 'agent-1' as any);

      let received = false;
      mgr.onMessage('ch-1' as any, () => { received = true; });

      const msg = buildMessage('task.create', 'ch-1', 3, 'agent-0' as any, 'ch-1' as any, { title: 'Test' });
      mgr.deliver('ch-1' as any, msg);
      expect(received).toBe(true);
    });

    it('isSubscribed works correctly', () => {
      const mgr = new ChannelManager();
      mgr.create('ch-1' as any);
      expect(mgr.isSubscribed('ch-1' as any, 'agent-1' as any)).toBe(false);
      mgr.subscribe('ch-1' as any, 'agent-1' as any);
      expect(mgr.isSubscribed('ch-1' as any, 'agent-1' as any)).toBe(true);
    });

    it('lists all channels', () => {
      const mgr = new ChannelManager();
      mgr.create('ch-1' as any);
      mgr.create('ch-2' as any);
      expect(mgr.listChannels()).toHaveLength(2);
    });
  });
});