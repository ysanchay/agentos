/**
 * MessageRouter with 5 routing modes:
 * direct, channel, broadcast, topic, priority
 */

import type { ACPMessage, AgentID, ChannelID, ACPPriority } from '@agentos/types';
import { ok, err } from '@agentos/types';
import type { Outcome } from '@agentos/types';
import { unknownRecipient, channelNotFound } from './errors.js';
import { ChannelManager } from './channel.js';

export type RoutingMode = 'direct' | 'channel' | 'broadcast' | 'topic' | 'priority';

export interface RoutingResult {
  mode: RoutingMode;
  recipients: AgentID[];
}

export type MessageConsumer = (message: ACPMessage) => void;

/**
 * MessageRouter routes ACPMessages to appropriate recipients
 * using five distinct routing strategies.
 */
export class MessageRouter {
  private channelManager: ChannelManager;
  private directHandlers = new Map<string, MessageConsumer[]>();
  private topicSubscriptions = new Map<string, Set<AgentID>>();
  private topicHandlers = new Map<string, MessageConsumer[]>();
  private priorityQueues = new Map<number, ACPMessage[]>();
  private agentRegistry = new Set<AgentID>();

  constructor(channelManager?: ChannelManager) {
    this.channelManager = channelManager ?? new ChannelManager();
  }

  /**
   * Register an agent as available for direct messaging.
   */
  registerAgent(agentId: AgentID): void {
    this.agentRegistry.add(agentId);
  }

  /**
   * Unregister an agent (removes from direct and topic routing).
   */
  unregisterAgent(agentId: AgentID): void {
    this.agentRegistry.delete(agentId);
    this.directHandlers.delete(agentId);
    for (const subs of this.topicSubscriptions.values()) {
      subs.delete(agentId);
    }
  }

  /**
   * Register a direct message handler for an agent.
   */
  onDirect(agentId: AgentID, handler: MessageConsumer): void {
    const existing = this.directHandlers.get(agentId) ?? [];
    existing.push(handler);
    this.directHandlers.set(agentId, existing);
  }

  /**
   * Route a message using the appropriate strategy based on the recipient field.
   *
   * - recipient is a specific AgentID -> direct
   * - recipient is a ChannelID -> channel
   * - recipient is '*' -> broadcast
   * - message has topic metadata -> topic
   * - otherwise -> priority queue
   */
  route(message: ACPMessage): Outcome<RoutingResult> {
    const recipient = message.recipient;

    // Broadcast: recipient === '*'
    if (recipient === '*') {
      return this.routeBroadcast(message);
    }

    // Channel: recipient matches a known channel
    if (this.channelManager.getChannel(recipient as ChannelID)) {
      return this.routeChannel(message, recipient as ChannelID);
    }

    // Direct: recipient is a specific agent
    if (this.agentRegistry.has(recipient as AgentID)) {
      return this.routeDirect(message, recipient as AgentID);
    }

    // Topic: check for topic in metadata
    const meta = message.metadata as Record<string, string> | undefined;
    const topic = meta?.['topic'];
    if (topic) {
      return this.routeTopic(message, topic);
    }

    // Fallback: try as direct even if not registered, return error if truly unknown
    if (typeof recipient === 'string' && recipient !== '*') {
      // Check if it could be a channel that doesn't exist yet
      if (this.directHandlers.has(recipient)) {
        return this.routeDirect(message, recipient as AgentID);
      }
      return unknownRecipient(recipient);
    }

    return unknownRecipient(String(recipient));
  }

  /**
   * Direct routing: deliver to a single specific agent.
   */
  routeDirect(message: ACPMessage, recipient: AgentID): Outcome<RoutingResult> {
    const handlers = this.directHandlers.get(recipient) ?? [];
    for (const handler of handlers) {
      handler(message);
    }
    return ok({ mode: 'direct', recipients: [recipient] });
  }

  /**
   * Channel routing: deliver to all subscribers of the channel.
   */
  routeChannel(message: ACPMessage, channelId: ChannelID): Outcome<RoutingResult> {
    const result = this.channelManager.deliver(channelId, message);
    if (!result.ok) {
      return result;
    }
    return ok({ mode: 'channel', recipients: result.data });
  }

  /**
   * Broadcast routing: deliver to all registered agents.
   */
  routeBroadcast(message: ACPMessage): Outcome<RoutingResult> {
    const allAgents = [...this.agentRegistry] as AgentID[];
    for (const agentId of allAgents) {
      const handlers = this.directHandlers.get(agentId) ?? [];
      for (const handler of handlers) {
        handler(message);
      }
    }
    return ok({ mode: 'broadcast', recipients: allAgents });
  }

  /**
   * Topic routing: deliver to agents subscribed to a specific topic.
   */
  routeTopic(message: ACPMessage, topic: string): Outcome<RoutingResult> {
    const subscribers = this.topicSubscriptions.get(topic);
    if (!subscribers || subscribers.size === 0) {
      return ok({ mode: 'topic', recipients: [] });
    }

    const recipients = [...subscribers] as AgentID[];
    for (const agentId of recipients) {
      const handlers = this.topicHandlers.get(topic) ?? [];
      for (const handler of handlers) {
        handler(message);
      }
      // Also deliver via direct handlers if registered
      const directHandlers = this.directHandlers.get(agentId) ?? [];
      for (const handler of directHandlers) {
        handler(message);
      }
    }
    return ok({ mode: 'topic', recipients });
  }

  /**
   * Priority routing: queue the message in a priority-based queue.
   * Lower number = higher priority.
   */
  routePriority(message: ACPMessage): Outcome<RoutingResult> {
    const priority = message.priority;
    const queue = this.priorityQueues.get(priority) ?? [];
    queue.push(message);
    this.priorityQueues.set(priority, queue);
    return ok({ mode: 'priority', recipients: [] });
  }

  /**
   * Subscribe an agent to a topic.
   */
  subscribeTopic(topic: string, agentId: AgentID): void {
    const subs = this.topicSubscriptions.get(topic) ?? new Set();
    subs.add(agentId);
    this.topicSubscriptions.set(topic, subs);
  }

  /**
   * Unsubscribe an agent from a topic.
   */
  unsubscribeTopic(topic: string, agentId: AgentID): void {
    const subs = this.topicSubscriptions.get(topic);
    if (subs) {
      subs.delete(agentId);
    }
  }

  /**
   * Register a handler for topic messages.
   */
  onTopic(topic: string, handler: MessageConsumer): void {
    const existing = this.topicHandlers.get(topic) ?? [];
    existing.push(handler);
    this.topicHandlers.set(topic, existing);
  }

  /**
   * Dequeue the next message from the highest-priority non-empty queue.
   */
  dequeueNext(): ACPMessage | undefined {
    for (let p = 0; p <= 4; p++) {
      const queue = this.priorityQueues.get(p);
      if (queue && queue.length > 0) {
        return queue.shift();
      }
    }
    return undefined;
  }

  /**
   * Get the channel manager instance.
   */
  getChannelManager(): ChannelManager {
    return this.channelManager;
  }

  /**
   * Get the number of messages in a priority queue.
   */
  priorityQueueSize(priority: ACPPriority): number {
    return this.priorityQueues.get(priority)?.length ?? 0;
  }
}