/**
 * @agentos/protocol — ACP (Agent Communication Protocol) Implementation
 * The TCP/IP for AI workforces
 */

// Message
export { buildMessage, canonicalForm, validateMessage, serializeMessage, replyTo } from './message.js';
export type { MessageBuilderOpts } from './message.js';

// Signing
export { generateKeyPair, signMessage, verifySignature, signBytes, verifyBytes, KeyRegistry } from './signing.js';
export type { KeyEntry } from './signing.js';

// Routing
export { MessageRouter } from './routing.js';
export type { RoutingMode, RoutingResult, MessageConsumer } from './routing.js';

// Channel
export { ChannelManager } from './channel.js';
export type { ChannelConfig, ChannelEntry, MessageHandler } from './channel.js';

// RPC
export { RPCClient, RPCServer } from './rpc.js';
export type { RPCHandler, RPCClientOpts } from './rpc.js';

// Heartbeat
export { HeartbeatManager } from './heartbeat.js';
export type { AgentLivenessEntry, HeartbeatManagerOpts } from './heartbeat.js';

// Retry
export { calculateBackoff, createBackoffIterator, sleep } from './retry.js';
export type { BackoffOptions, BackoffState } from './retry.js';

// Dead Letter Queue
export { DeadLetterQueue } from './dlq.js';
export type { DeadLetterEntry, DLQInspectResult, ReplayHandler } from './dlq.js';

// Rate Limiting
export { TokenBucketRateLimiter, SlidingWindowRateLimiter, PerAgentRateLimiter } from './rate-limit.js';

// Circuit Breaker
export { CircuitBreaker } from './circuit-breaker.js';
export type { CircuitBreakerState, CircuitBreakerOpts, CircuitBreakerStatus } from './circuit-breaker.js';

// Serializer
export { serialize, deserialize, validateMessageSize, validateMetadata, byteLength } from './serializer.js';
export type { SerializationOptions } from './serializer.js';

// Errors
export {
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
} from './errors.js';

// Validation
export { validateACPMessage, validateMessageType, validateLivenessState } from './validation.js';