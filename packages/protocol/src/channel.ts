/**
 * ChannelManager: subscribe/unsubscribe/delivery to subscribers
 * Manages named channels that agents can subscribe to for pub/sub messaging.
 */

import type { AgentID, ChannelID, ACPPriority } from '@agentos/types';
import { ok, err, ACP_E } from '@agentos/types';
import type { Outcome } from '@agentos/types';
import { channelNotFound, channelFull } from './errors.js';
import type { ACPMessage } from '@agentos/types';

export interface ChannelConfig {
  maxSubscribers?: number;
}

export interface ChannelEntry {
  id: ChannelID;
  subscribers: Set<AgentID>;
  maxSubscribers: number;
  createdAt: string;
}

export type MessageHandler = (message: ACPMessage) => void;

/**
 * ChannelManager manages named channels and their subscribers.
 * Agents subscribe to channels to receive messages published to them.
 */
export class ChannelManager {
  private channels = new Map<string, ChannelEntry>();
  private handlers = new Map<string, MessageHandler[]>();
  private defaultMaxSubscribers: number;

  constructor(opts?: { defaultMaxSubscribers?: number }) {
    this.defaultMaxSubscribers = opts?.defaultMaxSubscribers ?? 1000;
  }

  /**
   * Create a new channel.
   * Returns error if channel already exists.
   */
  create(channelId: ChannelID, config?: ChannelConfig): Outcome<ChannelEntry> {
    const existing = this.channels.get(channelId);
    if (existing) {
      return err(ACP_E.CHANNEL_NOT_FOUND, `Channel ${channelId} already exists`);
    }

    const entry: ChannelEntry = {
      id: channelId,
      subscribers: new Set(),
      maxSubscribers: config?.maxSubscribers ?? this.defaultMaxSubscribers,
      createdAt: new Date().toISOString(),
    };
    this.channels.set(channelId, entry);
    return ok(entry);
  }

  /**
   * Delete a channel, removing all subscribers.
   */
  delete(channelId: ChannelID): Outcome<true> {
    if (!this.channels.has(channelId)) {
      return channelNotFound(channelId);
    }
    this.channels.delete(channelId);
    this.handlers.delete(channelId);
    return ok(true);
  }

  /**
   * Subscribe an agent to a channel.
   * Returns error if channel not found or is full.
   */
  subscribe(channelId: ChannelID, agentId: AgentID): Outcome<true> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return channelNotFound(channelId);
    }
    if (channel.subscribers.has(agentId)) {
      return ok(true); // Already subscribed, idempotent
    }
    if (channel.subscribers.size >= channel.maxSubscribers) {
      return channelFull(channelId);
    }
    channel.subscribers.add(agentId);
    return ok(true);
  }

  /**
   * Unsubscribe an agent from a channel.
   * Returns error if channel not found.
   */
  unsubscribe(channelId: ChannelID, agentId: AgentID): Outcome<true> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return channelNotFound(channelId);
    }
    channel.subscribers.delete(agentId);
    return ok(true);
  }

  /**
   * Get all subscriber agent IDs for a channel.
   */
  getSubscribers(channelId: ChannelID): Outcome<AgentID[]> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return channelNotFound(channelId);
    }
    return ok([...channel.subscribers] as AgentID[]);
  }

  /**
   * Check if an agent is subscribed to a channel.
   */
  isSubscribed(channelId: ChannelID, agentId: AgentID): boolean {
    const channel = this.channels.get(channelId);
    if (!channel) return false;
    return channel.subscribers.has(agentId);
  }

  /**
   * Deliver a message to all subscribers of the channel.
   * Calls any registered handlers for the channel.
   */
  deliver(channelId: ChannelID, message: ACPMessage): Outcome<AgentID[]> {
    const channel = this.channels.get(channelId);
    if (!channel) {
      return channelNotFound(channelId);
    }

    const subscribers = [...channel.subscribers] as AgentID[];
    const channelHandlers = this.handlers.get(channelId) ?? [];

    for (const handler of channelHandlers) {
      handler(message);
    }

    return ok(subscribers);
  }

  /**
   * Register a handler that is called when a message is delivered to a channel.
   */
  onMessage(channelId: ChannelID, handler: MessageHandler): Outcome<true> {
    if (!this.channels.has(channelId)) {
      return channelNotFound(channelId);
    }
    const existing = this.handlers.get(channelId) ?? [];
    existing.push(handler);
    this.handlers.set(channelId, existing);
    return ok(true);
  }

  /**
   * Get a channel entry if it exists.
   */
  getChannel(channelId: ChannelID): ChannelEntry | undefined {
    return this.channels.get(channelId);
  }

  /**
   * List all channel IDs.
   */
  listChannels(): ChannelID[] {
    return [...this.channels.keys()] as ChannelID[];
  }

  /**
   * Get subscriber count for a channel.
   */
  subscriberCount(channelId: ChannelID): number {
    const channel = this.channels.get(channelId);
    return channel?.subscribers.size ?? 0;
  }
}