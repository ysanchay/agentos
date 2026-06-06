/**
 * ACPMessage builder, validation, serialization, canonical form for signing
 */

import type { ACPMessage, MessageType, ACPPriority, AgentID, ChannelID, Metadata } from '@agentos/types';
import { createUUID, asUUID, DEFAULT_TTL_MS, TIMESTAMP_CLOCK_SKEW_MS } from '@agentos/types';
import { ok, err } from '@agentos/types';
import type { Outcome } from '@agentos/types';
import { serialize, validateMessageSize, byteLength } from './serializer.js';
import { timestampOutOfRange } from './errors.js';
import { validateACPMessage } from './validation.js';

export interface MessageBuilderOpts {
  /** Message version (default "1.0") */
  version?: string;
  /** TTL in milliseconds (default 1 hour) */
  ttl?: number;
  /** Correlation ID for request-response chains */
  correlation_id?: string;
  /** Causation ID for event sourcing chains */
  causation_id?: string;
  /** Metadata key-value pairs */
  metadata?: Metadata;
}

/**
 * Build an ACPMessage envelope with defaults.
 * The signature field is empty and must be set by the signing module.
 */
export function buildMessage(
  type: MessageType,
  channel: string,
  priority: ACPPriority,
  sender: AgentID,
  recipient: AgentID | '*' | ChannelID,
  payload: unknown,
  opts?: MessageBuilderOpts,
): ACPMessage {
  return {
    id: createUUID(),
    version: opts?.version ?? '1.0',
    type,
    channel,
    priority,
    sender,
    recipient,
    correlation_id: opts?.correlation_id,
    causation_id: opts?.causation_id,
    timestamp: new Date().toISOString(),
    ttl: opts?.ttl ?? DEFAULT_TTL_MS,
    payload,
    metadata: opts?.metadata,
    signature: '',
    signature_algorithm: 'ed25519',
  };
}

/**
 * Produce the canonical form of an ACPMessage for signing.
 * Canonical form is a deterministic JSON string with:
 * 1. Sorted keys at every level
 * 2. Signature field omitted
 * 3. Undefined optional fields omitted
 */
export function canonicalForm(message: ACPMessage): string {
  const canonical: Record<string, unknown> = {};

  // Ordered field list for deterministic output
  const fields: (keyof ACPMessage)[] = [
    'id', 'version', 'type', 'channel', 'priority', 'sender', 'recipient',
    'correlation_id', 'causation_id', 'timestamp', 'ttl', 'payload', 'metadata',
    'signature_algorithm',
  ];

  for (const key of fields) {
    const value = message[key];
    if (value === undefined) continue;
    // Skip the signature field itself from canonical form
    if (key === 'signature') continue;
    canonical[key] = value;
  }

  return sortedJsonStringify(canonical);
}

/**
 * Recursively sort object keys and produce deterministic JSON string.
 */
function sortedJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(sortedJsonStringify).join(',') + ']';
  }

  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = keys.map((key) => {
    const value = (obj as Record<string, unknown>)[key];
    return JSON.stringify(key) + ':' + sortedJsonStringify(value);
  });
  return '{' + pairs.join(',') + '}';
}

/**
 * Validate an ACPMessage for structural correctness and size constraints.
 */
export function validateMessage(message: ACPMessage): Outcome<true> {
  // Schema validation via Zod
  const schemaResult = validateACPMessage(message);
  if (!schemaResult.ok) {
    return schemaResult;
  }

  // Size validation
  const sizeResult = validateMessageSize(message);
  if (!sizeResult.ok) {
    return sizeResult;
  }

  // Timestamp clock skew check
  const now = Date.now();
  const msgTime = new Date(message.timestamp).getTime();
  if (isNaN(msgTime)) {
    return err('ACP-E005', 'Invalid timestamp format');
  }
  const skew = Math.abs(now - msgTime);
  if (skew > TIMESTAMP_CLOCK_SKEW_MS) {
    return timestampOutOfRange();
  }

  return ok(true);
}

/**
 * Serialize an ACPMessage to a JSON string, validating constraints first.
 */
export function serializeMessage(message: ACPMessage): Outcome<string> {
  const validationResult = validateMessage(message);
  if (!validationResult.ok) {
    return validationResult;
  }
  return serialize(message);
}

/**
 * Create a reply message that sets correlation_id and causation_id appropriately.
 */
export function replyTo(
  original: ACPMessage,
  type: MessageType,
  sender: AgentID,
  payload: unknown,
  opts?: Omit<MessageBuilderOpts, 'correlation_id' | 'causation_id'>,
): ACPMessage {
  return buildMessage(
    type,
    original.channel,
    original.priority,
    sender,
    original.sender,
    payload,
    {
      ...opts,
      correlation_id: original.correlation_id ?? original.id,
      causation_id: original.id,
    },
  );
}