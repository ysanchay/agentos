import { z } from 'zod';
import { zAgentID, zChannelID } from './primitives.js';
import { zACPPriority, zMetadata } from './common.js';

export const zMessageType = z.enum([
  'agent.spawn', 'agent.terminate', 'agent.heartbeat', 'capability.advertise', 'agent.status',
  'task.create', 'task.assign', 'task.claim', 'task.release', 'task.complete', 'task.fail', 'task.cancel', 'task.progress',
  'rpc.request', 'rpc.response', 'rpc.error', 'broadcast',
  'event.publish', 'event.subscribe', 'event.unsubscribe',
  'approval.request', 'approval.grant', 'approval.deny', 'approval.expired',
  'memory.store', 'memory.retrieve', 'memory.search', 'memory.delete',
  'resource.allocate', 'resource.grant', 'resource.deny', 'resource.release', 'resource.warning',
  'error.timeout', 'error.rate_limit', 'error.unauthorized', 'error.invalid',
  'dead.letter',
]);

export const zACPPriorityValue = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

export const zACPMessage = z.object({
  id: z.string().uuid(),
  version: z.string(),
  type: zMessageType,
  channel: z.string().max(128),
  priority: zACPPriorityValue,
  sender: zAgentID,
  recipient: z.union([zAgentID, z.literal('*'), zChannelID]),
  correlation_id: z.string().optional(),
  causation_id: z.string().optional(),
  timestamp: z.string().datetime(),
  ttl: z.number().optional(),
  payload: z.unknown(),
  metadata: zMetadata.optional(),
  signature: z.string(),
  signature_algorithm: z.literal('ed25519'),
});

export const zLivenessState = z.enum(['healthy', 'suspect', 'degraded', 'failed']);