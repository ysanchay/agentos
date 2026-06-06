import { describe, it, expect } from 'vitest';
import { ACP_E } from '@agentos/types';
import {
  createACPError,
  unknownRecipient,
  channelNotFound,
  channelFull,
  signatureInvalid,
  timestampOutOfRange,
  messageTooLarge,
  payloadTooLarge,
  metadataTooLarge,
  rateLimitExceeded,
  rpcTimeout,
  rpcMaxRetries,
  rpcMethodNotFound,
  duplicateIdempotencyKey,
  heartbeatMissed,
  agentDegraded,
  agentFailed,
  encryptionFailed,
  decryptionFailed,
  keyNotFound,
  keyRevoked,
  circuitBreakerOpen,
  dlqEnqueued,
} from '../src/errors.js';

describe('errors', () => {
  it('createACPError creates error with code and message', () => {
    const error = createACPError(ACP_E.SIGNATURE_INVALID, 'bad sig');
    expect(error.error_code).toBe('ACP-E004');
    expect(error.error_message).toBe('bad sig');
    expect(error.retryable).toBe(false);
  });

  it('createACPError with retryable and retry_after options', () => {
    const error = createACPError(ACP_E.RATE_LIMIT_EXCEEDED, 'too many', {
      retryable: true,
      retry_after: 5000,
    });
    expect(error.retryable).toBe(true);
    expect(error.retry_after_ms).toBe(5000);
  });

  it('unknownRecipient', () => {
    const error = unknownRecipient('agent-123');
    expect(error.error_code).toBe(ACP_E.UNKNOWN_RECIPIENT);
    expect(error.error_message).toContain('agent-123');
  });

  it('channelNotFound', () => {
    const error = channelNotFound('ch-1');
    expect(error.error_code).toBe(ACP_E.CHANNEL_NOT_FOUND);
    expect(error.error_message).toContain('ch-1');
  });

  it('channelFull', () => {
    const error = channelFull('ch-1');
    expect(error.error_code).toBe(ACP_E.CHANNEL_FULL);
    expect(error.retryable).toBe(true);
  });

  it('signatureInvalid', () => {
    const error = signatureInvalid();
    expect(error.error_code).toBe(ACP_E.SIGNATURE_INVALID);
  });

  it('timestampOutOfRange', () => {
    const error = timestampOutOfRange();
    expect(error.error_code).toBe(ACP_E.TIMESTAMP_OUT_OF_RANGE);
  });

  it('messageTooLarge', () => {
    const error = messageTooLarge(2_000_000, 1_048_576);
    expect(error.error_code).toBe(ACP_E.MESSAGE_TOO_LARGE);
    expect(error.error_message).toContain('2_000_000');
  });

  it('payloadTooLarge', () => {
    const error = payloadTooLarge(600_000, 524_288);
    expect(error.error_code).toBe(ACP_E.PAYLOAD_TOO_LARGE);
  });

  it('metadataTooLarge', () => {
    const error = metadataTooLarge();
    expect(error.error_code).toBe(ACP_E.METADATA_TOO_LARGE);
  });

  it('rateLimitExceeded', () => {
    const error = rateLimitExceeded(5000);
    expect(error.error_code).toBe(ACP_E.RATE_LIMIT_EXCEEDED);
    expect(error.retryable).toBe(true);
  });

  it('rpcTimeout', () => {
    const error = rpcTimeout('getData', 30000);
    expect(error.error_code).toBe(ACP_E.RPC_TIMEOUT);
    expect(error.retryable).toBe(true);
  });

  it('rpcMaxRetries', () => {
    const error = rpcMaxRetries('getData', 3);
    expect(error.error_code).toBe(ACP_E.RPC_MAX_RETRIES);
  });

  it('rpcMethodNotFound', () => {
    const error = rpcMethodNotFound('nonexistent');
    expect(error.error_code).toBe(ACP_E.RPC_METHOD_NOT_FOUND);
  });

  it('duplicateIdempotencyKey', () => {
    const error = duplicateIdempotencyKey('key-1');
    expect(error.error_code).toBe(ACP_E.DUPLICATE_IDEMPOTENCY_KEY);
  });

  it('heartbeatMissed', () => {
    const error = heartbeatMissed('agent-1');
    expect(error.error_code).toBe(ACP_E.HEARTBEAT_MISSED);
    expect(error.retryable).toBe(true);
  });

  it('agentDegraded', () => {
    const error = agentDegraded('agent-1');
    expect(error.error_code).toBe(ACP_E.AGENT_DEGRADED);
  });

  it('agentFailed', () => {
    const error = agentFailed('agent-1');
    expect(error.error_code).toBe(ACP_E.AGENT_FAILED);
    expect(error.retryable).toBe(false);
  });

  it('encryptionFailed', () => {
    const error = encryptionFailed();
    expect(error.error_code).toBe(ACP_E.ENCRYPTION_FAILED);
  });

  it('decryptionFailed', () => {
    const error = decryptionFailed();
    expect(error.error_code).toBe(ACP_E.DECRYPTION_FAILED);
  });

  it('keyNotFound', () => {
    const error = keyNotFound('key-1');
    expect(error.error_code).toBe(ACP_E.KEY_NOT_FOUND);
  });

  it('keyRevoked', () => {
    const error = keyRevoked('key-1');
    expect(error.error_code).toBe(ACP_E.KEY_REVOKED);
  });

  it('circuitBreakerOpen', () => {
    const error = circuitBreakerOpen();
    expect(error.error_code).toBe(ACP_E.CIRCUIT_BREAKER_OPEN);
    expect(error.retryable).toBe(true);
  });

  it('dlqEnqueued', () => {
    const error = dlqEnqueued('msg-1', 'timeout');
    expect(error.error_code).toBe(ACP_E.DLQ_ENQUEUED);
    expect(error.retryable).toBe(true);
  });
});