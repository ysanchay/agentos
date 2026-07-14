# @agentos/protocol

ACP (Agent Communication Protocol) implementation — the messaging layer for AgentOS agent workforces. Provides signed, routed, delivered, and retried message delivery with Ed25519 cryptography.

## Overview

ACP is the TCP/IP for AI workforces. Every inter-agent message is signed with Ed25519, routed through a `MessageRouter`, delivered via `ChannelManager`, and tracked for liveness through `HeartbeatManager`. The package includes RPC client/server, exponential backoff retry, dead-letter queues, rate limiting (token bucket + sliding window + per-agent), circuit breakers, and message serialization with size validation.

## API

- **Message** — `buildMessage`, `canonicalForm`, `validateMessage`, `serializeMessage`, `replyTo`.
- **Signing** — `generateKeyPair`, `signMessage`, `verifySignature`, `KeyRegistry` (Ed25519 via `@noble/ed25519`).
- **`MessageRouter`** — routes messages with `RoutingMode` support; returns `RoutingResult`.
- **`ChannelManager`** — pub/sub channels with `ChannelConfig` and `MessageHandler`.
- **`RPCClient` / `RPCServer`** — typed request/response over ACP channels.
- **`HeartbeatManager`** — tracks `AgentLivenessEntry`; detects missed heartbeats and degradation.
- **Retry** — `calculateBackoff`, `createBackoffIterator`, `sleep` with `BackoffOptions`.
- **`DeadLetterQueue`** — stores undeliverable messages; supports replay.
- **Rate limiting** — `TokenBucketRateLimiter`, `SlidingWindowRateLimiter`, `PerAgentRateLimiter`.
- **`CircuitBreaker`** — open/half-open/closed state machine for fault isolation.
- **Errors** — `createACPError` and 20+ typed error factories (`unknownRecipient`, `signatureInvalid`, `rateLimitExceeded`, ...).

## Usage

```typescript
import { generateKeyPair, buildMessage, signMessage, MessageRouter } from '@agentos/protocol';

const { publicKey, privateKey } = generateKeyPair();
const msg = buildMessage({ from: agentId, to: targetId, type: 'task.create', payload });
const signed = signMessage(msg, privateKey);

const router = new MessageRouter({ keyRegistry });
await router.route(signed);
```

## Configuration

No environment variables. Key management, routing, and channel configuration are passed programmatically.

## Tests

```bash
pnpm --filter @agentos/protocol test
```

## License

Proprietary — Nous Research