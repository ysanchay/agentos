/**
 * ACP Error Creation Helpers
 * Factory functions for creating typed AgentError objects using codes from @agentos/types
 * All helpers return AgentError (with ok: false) so they can be used directly as Outcome values.
 */

import { ACP_E } from '@agentos/types';
import type { ACPErrorCode, AgentError, Duration } from '@agentos/types';
import { err } from '@agentos/types';

/** Create an AgentError with a specific ACP error code */
export function createACPError(
  code: ACPErrorCode,
  message: string,
  opts?: { retryable?: boolean; retry_after?: Duration; details?: unknown },
): AgentError {
  return err(code, message, opts);
}

/** Unknown recipient error */
export function unknownRecipient(agentId: string): AgentError {
  return createACPError(ACP_E.UNKNOWN_RECIPIENT, `Unknown recipient: ${agentId}`);
}

/** Channel not found error */
export function channelNotFound(channel: string): AgentError {
  return createACPError(ACP_E.CHANNEL_NOT_FOUND, `Channel not found: ${channel}`);
}

/** Channel full error */
export function channelFull(channel: string): AgentError {
  return createACPError(ACP_E.CHANNEL_FULL, `Channel is full: ${channel}`, { retryable: true });
}

/** Invalid signature error */
export function signatureInvalid(): AgentError {
  return createACPError(ACP_E.SIGNATURE_INVALID, 'Message signature verification failed');
}

/** Timestamp out of range error */
export function timestampOutOfRange(): AgentError {
  return createACPError(ACP_E.TIMESTAMP_OUT_OF_RANGE, 'Message timestamp is outside acceptable clock skew');
}

/** Message too large error */
export function messageTooLarge(sizeBytes: number, maxBytes: number): AgentError {
  return createACPError(ACP_E.MESSAGE_TOO_LARGE, `Message size ${sizeBytes} exceeds maximum ${maxBytes} bytes`);
}

/** Payload too large error */
export function payloadTooLarge(sizeBytes: number, maxBytes: number): AgentError {
  return createACPError(ACP_E.PAYLOAD_TOO_LARGE, `Payload size ${sizeBytes} exceeds maximum ${maxBytes} bytes`);
}

/** Metadata too large error */
export function metadataTooLarge(): AgentError {
  return createACPError(ACP_E.METADATA_TOO_LARGE, 'Metadata exceeds size limits');
}

/** Rate limit exceeded error */
export function rateLimitExceeded(retryAfterMs: number): AgentError {
  return createACPError(ACP_E.RATE_LIMIT_EXCEEDED, 'Rate limit exceeded', {
    retryable: true,
    retry_after: retryAfterMs,
  });
}

/** RPC timeout error */
export function rpcTimeout(method: string, timeoutMs: number): AgentError {
  return createACPError(ACP_E.RPC_TIMEOUT, `RPC call "${method}" timed out after ${timeoutMs}ms`, {
    retryable: true,
    retry_after: timeoutMs,
  });
}

/** RPC max retries exceeded error */
export function rpcMaxRetries(method: string, retries: number): AgentError {
  return createACPError(ACP_E.RPC_MAX_RETRIES, `RPC call "${method}" exceeded max retries (${retries})`);
}

/** RPC method not found error */
export function rpcMethodNotFound(method: string): AgentError {
  return createACPError(ACP_E.RPC_METHOD_NOT_FOUND, `RPC method not found: ${method}`);
}

/** Duplicate idempotency key error */
export function duplicateIdempotencyKey(key: string): AgentError {
  return createACPError(ACP_E.DUPLICATE_IDEMPOTENCY_KEY, `Duplicate idempotency key: ${key}`);
}

/** Heartbeat missed error */
export function heartbeatMissed(agentId: string): AgentError {
  return createACPError(ACP_E.HEARTBEAT_MISSED, `Heartbeat missed from agent ${agentId}`, { retryable: true });
}

/** Agent degraded error */
export function agentDegraded(agentId: string): AgentError {
  return createACPError(ACP_E.AGENT_DEGRADED, `Agent ${agentId} is in degraded state`);
}

/** Agent failed error */
export function agentFailed(agentId: string): AgentError {
  return createACPError(ACP_E.AGENT_FAILED, `Agent ${agentId} has failed`, { retryable: false });
}

/** Encryption failed error */
export function encryptionFailed(): AgentError {
  return createACPError(ACP_E.ENCRYPTION_FAILED, 'Encryption operation failed');
}

/** Decryption failed error */
export function decryptionFailed(): AgentError {
  return createACPError(ACP_E.DECRYPTION_FAILED, 'Decryption operation failed');
}

/** Key not found error */
export function keyNotFound(keyId: string): AgentError {
  return createACPError(ACP_E.KEY_NOT_FOUND, `Key not found: ${keyId}`);
}

/** Key revoked error */
export function keyRevoked(keyId: string): AgentError {
  return createACPError(ACP_E.KEY_REVOKED, `Key has been revoked: ${keyId}`);
}

/** Circuit breaker open error */
export function circuitBreakerOpen(): AgentError {
  return createACPError(ACP_E.CIRCUIT_BREAKER_OPEN, 'Circuit breaker is open; requests are blocked', {
    retryable: true,
  });
}

/** DLQ enqueued notification (informational error) */
export function dlqEnqueued(messageId: string, reason: string): AgentError {
  return createACPError(ACP_E.DLQ_ENQUEUED, `Message ${messageId} enqueued in DLQ: ${reason}`, {
    retryable: true,
    details: { original_message_id: messageId, failure_reason: reason },
  });
}