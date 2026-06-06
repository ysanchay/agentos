/**
 * JSON Serialization with size limits
 * Enforces 1MB message / 512KB payload constraints from constitutional constants
 */

import { MESSAGE_MAX_SIZE_BYTES, MESSAGE_MAX_PAYLOAD_BYTES, MESSAGE_MAX_METADATA_BYTES, MESSAGE_MAX_METADATA_KEYS, MESSAGE_MAX_METADATA_VALUE_LENGTH } from '@agentos/types';
import { err, ok } from '@agentos/types';
import type { Outcome } from '@agentos/types';
import { messageTooLarge, payloadTooLarge } from './errors.js';

export interface SerializationOptions {
  /** Maximum total message size in bytes (default: 1MB) */
  maxMessageSizeBytes?: number;
  /** Maximum payload size in bytes (default: 512KB) */
  maxPayloadSizeBytes?: number;
}

/**
 * Get byte length of a string in UTF-8 encoding.
 */
export function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Validate metadata constraints:
 * - Max 16 keys
 * - Max value length 256 chars
 * - Max total metadata size 4KB
 */
export function validateMetadata(metadata: Record<string, string> | undefined): Outcome<true> {
  if (!metadata) return ok(true);

  const keys = Object.keys(metadata);
  if (keys.length > MESSAGE_MAX_METADATA_KEYS) {
    return err('ACP-E008', `Metadata has ${keys.length} keys, maximum is ${MESSAGE_MAX_METADATA_KEYS}`);
  }

  for (const key of keys) {
    if (metadata[key]!.length > MESSAGE_MAX_METADATA_VALUE_LENGTH) {
      return err('ACP-E008', `Metadata value for key "${key}" exceeds ${MESSAGE_MAX_METADATA_VALUE_LENGTH} characters`);
    }
  }

  const serializedSize = byteLength(JSON.stringify(metadata));
  if (serializedSize > MESSAGE_MAX_METADATA_BYTES) {
    return err('ACP-E008', `Metadata size ${serializedSize} exceeds maximum ${MESSAGE_MAX_METADATA_BYTES} bytes`);
  }

  return ok(true);
}

/**
 * Serialize an ACP message to JSON string with size validation.
 * Returns an error outcome if the message or payload exceeds size limits.
 */
export function serialize(obj: unknown, opts?: SerializationOptions): Outcome<string> {
  const maxMsgSize = opts?.maxMessageSizeBytes ?? MESSAGE_MAX_SIZE_BYTES;
  const maxPayloadSize = opts?.maxPayloadSizeBytes ?? MESSAGE_MAX_PAYLOAD_BYTES;

  // Validate payload size if the object looks like an ACPMessage
  if (obj !== null && typeof obj === 'object' && 'payload' in obj) {
    const payload = (obj as { payload: unknown }).payload;
    const payloadJson = JSON.stringify(payload);
    const payloadSize = byteLength(payloadJson);
    if (payloadSize > maxPayloadSize) {
      return payloadTooLarge(payloadSize, maxPayloadSize);
    }
  }

  // Validate metadata if present
  if (obj !== null && typeof obj === 'object' && 'metadata' in obj) {
    const metadata = (obj as { metadata: unknown }).metadata;
    const metaResult = validateMetadata(metadata as Record<string, string> | undefined);
    if (!metaResult.ok) {
      return metaResult;
    }
  }

  const json = JSON.stringify(obj);
  const size = byteLength(json);

  if (size > maxMsgSize) {
    return messageTooLarge(size, maxMsgSize);
  }

  return ok(json);
}

/**
 * Deserialize a JSON string with size validation.
 * Returns an error outcome if the string exceeds size limits.
 */
export function deserialize(json: string, opts?: SerializationOptions): Outcome<unknown> {
  const maxMsgSize = opts?.maxMessageSizeBytes ?? MESSAGE_MAX_SIZE_BYTES;
  const size = byteLength(json);

  if (size > maxMsgSize) {
    return messageTooLarge(size, maxMsgSize);
  }

  try {
    const obj = JSON.parse(json);
    return ok(obj);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Invalid JSON';
    return err('ACP-E007', `JSON parse error: ${message}`);
  }
}

/**
 * Validate that a raw object conforms to the message size constraints
 * without full serialization.
 */
export function validateMessageSize(
  message: { payload?: unknown; metadata?: Record<string, string> },
  opts?: SerializationOptions,
): Outcome<true> {
  const maxPayloadSize = opts?.maxPayloadSizeBytes ?? MESSAGE_MAX_PAYLOAD_BYTES;

  if (message.payload !== undefined) {
    const payloadSize = byteLength(JSON.stringify(message.payload));
    if (payloadSize > maxPayloadSize) {
      return payloadTooLarge(payloadSize, maxPayloadSize);
    }
  }

  if (message.metadata !== undefined) {
    const metaResult = validateMetadata(message.metadata);
    if (!metaResult.ok) {
      return metaResult;
    }
  }

  return ok(true);
}