# AgentOS ACP (Agent Communication Protocol) Constitution v1.0

**Status**: Ratified  
**Date**: 2026-06-06  
**Protocol Version**: ACP/1.0  
**Supersedes**: None (initial version)

---

## 1. Preamble

ACP is the universal communication protocol for AgentOS — the TCP/IP for intelligent workforces. Every message, every channel, every routing rule in this document is normative. Implementations MUST comply with all MUST-level requirements, SHOULD comply with SHOULD-level requirements unless a documented exception exists, and MAY implement MAY-level features.

ACP defines how agents discover each other, exchange messages, request actions, report results, and coordinate work. No agent may communicate outside of ACP. No component may bypass ACP's signing, routing, or validation.

---

## 2. Terminology

| Term | Definition |
|------|-----------|
| **Agent** | An autonomous entity registered with the Kernel that sends and receives ACP messages |
| **Kernel** | The central coordinator that routes, validates, and enforces ACP rules |
| **Channel** | A named communication path that agents subscribe to for message delivery |
| **Workspace** | An isolated execution context; ACP messages are scoped to workspaces |
| **Message** | The fundamental unit of communication in ACP |
| **Correlation ID** | Links a request message to its response message |
| **Causation ID** | Links a message to the event that caused it (distributed tracing) |
| **Dead Letter Queue (DLQ)** | Storage for messages that failed delivery after max retries |
| **Provider** | An entity (agent, MCP server, API) that can fulfill a capability |
| **Approval** | An authorization gate that must be satisfied before an action proceeds |

---

## 3. Message Schema

Every ACP message MUST conform to this envelope:

```typescript
interface ACPMessage {
  // Identity
  id: string;                    // UUID v7 (time-ordered, globally unique)
  version: string;               // Protocol version: "1.0"
  
  // Classification
  type: MessageType;             // What kind of message (see Section 4)
  channel: string;               // Target channel for routing
  priority: ACPPriority;         // Delivery priority
  
  // Parties
  sender: AgentID;               // Who sent this message
  recipient: AgentID | "*" | ChannelID;  // Direct agent, broadcast, or channel
  
  // Tracing
  correlation_id?: string;       // Links request↔response pairs
  causation_id?: string;          // Links caused-by chains for tracing
  
  // Timing
  timestamp: string;             // ISO 8601 with timezone
  ttl?: number;                  // Time-to-live in seconds (0 = no expiry)
  
  // Content
  payload: unknown;              // Message body, typed per MessageType
  metadata?: Record<string, string>;  // Extensible headers
  
  // Security
  signature: string;             // Ed25519 signature (Base64)
  signature_algorithm: "ed25519"; // Signing algorithm
}
```

### Field Constraints

| Field | Type | Required | Constraints |
|-------|------|----------|------------|
| id | UUID v7 | MUST | Globally unique, time-ordered |
| version | string | MUST | Must be "1.0" for this specification |
| type | MessageType | MUST | Must be a registered message type |
| channel | string | MUST | Must be a valid channel name (alphanumeric + dots + hyphens) |
| priority | integer | MUST | Must be 0-4 (see Section 14) |
| sender | AgentID | MUST | Must be a registered agent |
| recipient | string | MUST | AgentID, "*" for broadcast, or ChannelID |
| correlation_id | UUID | SHOULD | Required for request/response pairs |
| causation_id | UUID | SHOULD | Required for causal chain tracing |
| timestamp | ISO 8601 | MUST | Must be within ±60s of Kernel clock |
| ttl | number | MAY | Default: 3600 (1 hour). 0 = no expiry |
| payload | typed | MUST | Must conform to payload schema for `type` |
| metadata | object | MAY | Values must be strings, max 16 keys |
| signature | Base64 | MUST | Ed25519 signature covering canonical form |
| signature_algorithm | string | MUST | Must be "ed25519" |

### Canonical Form for Signing

The signature covers this exact byte sequence:
```
id + "|" + type + "|" + channel + "|" + sender + "|" + recipient + "|" + timestamp + "|" + SHA-256(payload)
```
Where SHA-256(payload) is the hex-encoded SHA-256 hash of the JSON-serialized payload.

### Message Size Limits

| Component | Maximum Size |
|-----------|-------------|
| Total message | 1 MB |
| Payload | 512 KB |
| Metadata | 4 KB |
| Channel name | 128 characters |
| Metadata keys | 16 keys, 256 chars each |

---

## 4. Message Types and Payloads

### 4.1 System Messages

#### `agent.spawn`
```typescript
interface AgentSpawnPayload {
  agent_name: string;
  agent_type: AgentType;
  workspace_id: WorkspaceID;
  capabilities: string[];
  public_key: string;           // Ed25519 public key
  resource_budget?: ResourceBudget;
  metadata?: Record<string, string>;
}
```

#### `agent.terminate`
```typescript
interface AgentTerminatePayload {
  agent_id: AgentID;
  reason: "user_request" | "admin" | "parent" | "budget_exhausted" | "security" | "error_max_retries";
  graceful: boolean;            // true = allow checkpoint, false = immediate
}
```

#### `agent.heartbeat`
```typescript
interface AgentHeartbeatPayload {
  agent_id: AgentID;
  state: AgentState;
  active_tasks: number;
  resources_consumed: ResourceConsumption;
  timestamp: ISO8601;
}
```

#### `agent.capability.advertise`
```typescript
interface CapabilityAdvertisePayload {
  agent_id: AgentID;
  capabilities: {
    capability_id: CapabilityID;
    version: string;
    quality_score?: number;
  }[];
}
```

#### `agent.status`
```typescript
interface AgentStatusPayload {
  agent_id: AgentID;
  previous_state: AgentState;
  new_state: AgentState;
  reason: string;
}
```

### 4.2 Task Messages

#### `task.create`
```typescript
interface TaskCreatePayload {
  task_id: TaskID;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  workspace_id: WorkspaceID;
  project_id?: ProjectID;
  parent_task_id?: TaskID;
  depends_on?: TaskID[];
  resources_required?: ResourceBudget;
  deadline?: ISO8601;
  max_retries?: number;
  tags?: string[];
}
```

#### `task.assign`
```typescript
interface TaskAssignPayload {
  task_id: TaskID;
  agent_id: AgentID;
  assigned_by: AgentID;         // Must be Chief or Manager
}
```

#### `task.claim`
```typescript
interface TaskClaimPayload {
  task_id: TaskID;
  agent_id: AgentID;
  capabilities_matched: CapabilityID[];
  estimated_resources: ResourceBudget;
}
```

#### `task.release`
```typescript
interface TaskReleasePayload {
  task_id: TaskID;
  agent_id: AgentID;
  reason: "voluntary" | "timeout" | "blocked" | "preempted";
  partial_result?: unknown;     // Save partial work for next agent
}
```

#### `task.complete`
```typescript
interface TaskCompletePayload {
  task_id: TaskID;
  agent_id: AgentID;
  result: unknown;
  confidence: number;           // 0.0 - 1.0
  resources_consumed: ResourceConsumption;
  duration_ms: number;
  artifacts?: string[];         // References to created resources
}
```

#### `task.fail`
```typescript
interface TaskFailPayload {
  task_id: TaskID;
  agent_id: AgentID;
  error_code: string;
  error_message: string;
  retryable: boolean;
  partial_result?: unknown;
}
```

#### `task.cancel`
```typescript
interface TaskCancelPayload {
  task_id: TaskID;
  cancelled_by: AgentID | UserID;
  reason: string;
  cascade: boolean;             // Cancel dependent tasks?
}
```

#### `task.progress`
```typescript
interface TaskProgressPayload {
  task_id: TaskID;
  agent_id: AgentID;
  percent_complete: number;     // 0-100
  status_message: string;
  estimated_remaining_ms?: number;
}
```

### 4.3 Communication Pattern Messages

#### `rpc.request`
```typescript
interface RPCRequestPayload {
  method: string;
  params: unknown;
  idempotency_key?: string;
  timeout_ms?: number;         // Default: 30000
}
```

#### `rpc.response`
```typescript
interface RPCResponsePayload {
  result: unknown;
  duration_ms: number;
}
```

#### `rpc.error`
```typescript
interface RPCErrorPayload {
  error_code: string;
  error_message: string;
  retryable: boolean;
  retry_after_ms?: number;
}
```

#### `broadcast`
```typescript
interface BroadcastPayload {
  topic: string;
  message: string;
  data?: unknown;
  expires_at?: ISO8601;
}
```

#### `event.publish`
```typescript
interface EventPublishPayload {
  event_type: string;
  event_data: unknown;
  scope: "workspace" | "project" | "global";
}
```

#### `event.subscribe`
```typescript
interface EventSubscribePayload {
  event_types: string[];        // Glob patterns supported: "task.*", "agent.error"
  filter?: Record<string, unknown>;  // Additional filter criteria
}
```

#### `event.unsubscribe`
```typescript
interface EventUnsubscribePayload {
  subscription_id: string;
}
```

### 4.4 Approval Messages

#### `approval.request`
```typescript
interface ApprovalRequestPayload {
  approval_type: ApprovalType;
  resource_type: string;
  resource_id?: string;
  action: string;
  action_params?: unknown;
  reason: string;
  urgency: "low" | "normal" | "high" | "critical";
  timeout_ms: number;          // Default: 300000 (5 min)
}
```

#### `approval.grant`
```typescript
interface ApprovalGrantPayload {
  approval_id: ApprovalID;
  approved_by: AgentID | UserID;
  conditions?: string[];        // Any conditions on the approval
}
```

#### `approval.deny`
```typescript
interface ApprovalDenyPayload {
  approval_id: ApprovalID;
  denied_by: AgentID | UserID;
  reason: string;
  alternative?: string;         // Suggested alternative action
}
```

#### `approval.expired`
```typescript
interface ApprovalExpiredPayload {
  approval_id: ApprovalID;
  expired_at: ISO8601;
  auto_denied: true;           // Timeouts default to denial
}
```

### 4.5 Memory Messages

#### `memory.store`
```typescript
interface MemoryStorePayload {
  memory_id: MemoryID;
  type: MemoryType;
  content: unknown;
  summary?: string;
  tags?: string[];
  confidence?: number;
  relations?: MemoryRelation[];
  expires_at?: ISO8601;
  tier?: MemoryTier;            // Default: L1
}
```

#### `memory.retrieve`
```typescript
interface MemoryRetrievePayload {
  memory_id: MemoryID;
  include_relations?: boolean;
  include_history?: boolean;
}
```

#### `memory.search`
```typescript
interface MemorySearchPayload {
  query: string;
  workspace_id: WorkspaceID;
  types?: MemoryType[];
  tags?: string[];
  semantic?: boolean;          // Enable vector similarity search
  limit?: number;              // Default: 20
  offset?: number;
}
```

#### `memory.delete`
```typescript
interface MemoryDeletePayload {
  memory_id: MemoryID;
  reason: string;
  soft_delete: boolean;        // MUST be true (hard deletes not allowed)
}
```

### 4.6 Resource Messages

#### `resource.allocate`
```typescript
interface ResourceAllocatePayload {
  agent_id: AgentID;
  task_id?: TaskID;
  ru: number;
  mu: number;
  eu: number;
  vu: number;
  priority: Priority;
  preemptible: boolean;
  duration_ms?: number;
}
```

#### `resource.grant`
```typescript
interface ResourceGrantPayload {
  allocation_id: AllocationID;
  granted: ResourceBudget;
  expires_at?: ISO8601;
}
```

#### `resource.deny`
```typescript
interface ResourceDenyPayload {
  reason: "quota_exceeded" | "unavailable" | "permission_denied";
  requested: ResourceBudget;
  available: ResourceBudget;
  retry_after_ms?: number;
}
```

#### `resource.release`
```typescript
interface ResourceReleasePayload {
  allocation_id: AllocationID;
  consumed: ResourceConsumption;
  released: ResourceBudget;
}
```

#### `resource.warning`
```typescript
interface ResourceWarningPayload {
  agent_id: AgentID;
  resource_type: ResourceUnit;
  percent_consumed: number;    // 0-100
  budget_remaining: number;
  estimated_exhaustion_at?: ISO8601;
}
```

### 4.7 Error Messages

#### `error.dead-letter`
```typescript
interface DeadLetterPayload {
  original_message_id: string;
  original_message_type: MessageType;
  failure_reason: string;
  retry_attempts: number;
  max_retries: number;
  original_sender: AgentID;
  timestamp: ISO8601;
  can_replay: boolean;
}
```

#### `error.timeout`
```typescript
interface ErrorTimeoutPayload {
  operation: string;
  timeout_ms: number;
  correlation_id?: string;
  retryable: true;
}
```

#### `error.rate-limit`
```typescript
interface ErrorRateLimitPayload {
  limit: number;
  window_ms: number;
  current_count: number;
  retry_after_ms: number;
}
```

#### `error.unauthorized`
```typescript
interface ErrorUnauthorizedPayload {
  agent_id: AgentID;
  permission_required: string;
  resource_type: string;
  resource_id?: string;
}
```

#### `error.invalid`
```typescript
interface ErrorInvalidPayload {
  field: string;
  constraint: string;
  value: unknown;
  schema_ref?: string;
}
```

---

## 5. Message Routing

### 5.1 Routing Modes

| Mode | Recipient Format | Delivery Rule |
|------|-----------------|--------------|
| **Direct** | AgentID | Deliver to exactly one agent |
| **Channel** | ChannelID | Deliver to all current subscribers |
| **Broadcast** | "*" | Deliver to all agents in workspace |
| **Topic** | "topic:pattern" | Deliver to agents subscribed to matching topic |
| **Priority** | Any | Higher-priority messages preempt lower in delivery queue |

### 5.2 Delivery Rules

1. Messages addressed to a specific AgentID MUST be delivered only to that agent
2. Messages addressed to a ChannelID MUST be delivered to all current subscribers
3. Messages with recipient "*" MUST be broadcast to all agents in the same workspace
4. Priority ordering: CRITICAL(0) > HIGH(1) > NORMAL(2) > LOW(3) > BACKGROUND(4)
5. Same-priority messages MUST be delivered in timestamp order (FIFO within priority)
6. Cross-workspace delivery is FORBIDDEN unless explicit bridge exists

### 5.3 Delivery Guarantees

| Level | Guarantee | Use Case |
|-------|-----------|----------|
| **At-most-once** | Message delivered 0 or 1 times | Heartbeats, metrics |
| **At-least-once** | Message delivered 1+ times (duplicates possible) | Task events, notifications |
| **Exactly-once** | Message delivered exactly once (via idempotency) | RPC requests, approval grants |

Default: at-least-once. RPC uses exactly-once via idempotency keys.

---

## 6. Message Signing and Verification

### 6.1 Keypair Lifecycle

1. **Generation**: Each agent generates an Ed25519 keypair on spawn. Private key NEVER leaves the agent process.
2. **Registration**: Agent sends `public_key` in `agent.spawn` message. Kernel stores it.
3. **Verification**: Kernel verifies every inbound message's signature against the sender's registered public key.
4. **Rotation**: Agent sends `agent.key-rotate` signed with OLD private key, containing NEW public key. Kernel allows 24-hour grace period where both keys are valid.
5. **Revocation**: If a key is compromised, admin revokes via Kernel API. Agent must re-authenticate.

### 6.2 Signing Process

```
1. Construct canonical form: id|type|channel|sender|recipient|timestamp|SHA256(payload)
2. Sign canonical form with agent's Ed25519 private key
3. Base64-encode the 64-byte signature
4. Set signature_algorithm = "ed25519"
```

### 6.3 Verification Process

```
1. Lookup sender's registered public key from Kernel
2. Decode Base64 signature
3. Reconstruct canonical form from message fields
4. Verify signature against canonical form using sender's public key
5. If verification fails: REJECT message, log security event, return error.unauthorized
6. If timestamp is outside ±60s of Kernel clock: REJECT (replay protection)
```

### 6.4 Unsigned Message Policy

- Unsigned messages MUST be REJECTED at the Kernel boundary
- The only exception: system bootstrap messages during initial handshake (must be replaced by signed messages within 30 seconds)

---

## 7. Encryption

### 7.1 Encryption Tiers

| Tier | Algorithm | Scope | When to Use |
|------|-----------|-------|------------|
| **None** | — | — | Default for non-sensitive messages |
| **E2E** | X25519 key exchange + AES-256-GCM | Between two specific agents | Sensitive agent-to-agent communication |
| **Channel** | AES-256-GCM with shared symmetric key | All messages on a channel | Channel-level confidentiality |
| **Workspace** | AES-256-GCM with workspace key | All messages in a workspace | Workspace-wide confidentiality |

### 7.2 Encryption Rules

1. Signing is MANDATORY on every message; encryption is OPTIONAL
2. The Kernel NEVER has access to plaintext of encrypted messages
3. E2E encryption: sender derives shared secret via X25519 key exchange with recipient's public key, then encrypts payload with AES-256-GCM
4. Channel encryption: symmetric key distributed to channel subscribers by the channel owner
5. Workspace encryption: workspace key distributed to workspace members by the Kernel on workspace entry
6. If decryption fails, the message MUST still be routed but the payload is opaque

---

## 8. Approval System

### 8.1 Approval Flow

```
1. Agent identifies action requires approval (per permission model)
2. Agent sends approval.request via ACP
3. Kernel routes to designated approver(s)
4. Approver reviews and sends approval.grant or approval.deny
5. If no response within timeout: approval.expired → auto-denied
6. If primary approver unavailable: escalate to backup approver
7. Approval results are idempotent (same request_id → same result)
```

### 8.2 Approval Timeout Defaults

| Urgency | Timeout | Escalation |
|---------|---------|------------|
| Critical | 1 minute | Immediate to backup |
| High | 5 minutes | After 2 min to backup |
| Normal | 30 minutes | After 10 min to backup |
| Low | 4 hours | After 1 hour to backup |

---

## 9. Heartbeat Protocol

### 9.1 Agent Heartbeat

- Agents MUST send `agent.heartbeat` every 30 seconds (±5s jitter to avoid thundering herd)
- Heartbeat payload includes: agent_id, state, active_tasks, resources_consumed

### 9.2 Liveness States

```
HEALTHY → SUSPECT → DEGRADED → FAILED

HEALTHY:  Last heartbeat within 30s
SUSPECT:   1 missed heartbeat (30-60s since last)
DEGRADED:  2 missed heartbeats (60-90s since last)
FAILED:    3 missed heartbeats (90s+ since last)
```

### 9.3 Actions Per State

| State | Action |
|-------|--------|
| HEALTHY | Normal operation |
| SUSPECT | Log warning. No action yet. |
| DEGRADED | Tasks marked as "at risk". Notify Manager/Chief. Prepare for reassignment. |
| FAILED | Mark agent as unresponsive. Freeze resources. Reassign tasks. Attempt recovery. If recovery fails within 5 min → force terminate. |

---

## 10. RPC Pattern

### 10.1 Request-Response Flow

```
1. Caller sends rpc.request with correlation_id
2. Callee processes request
3. Callee sends rpc.response with SAME correlation_id
4. If no response within timeout: caller receives rpc.error with timeout code
5. Caller may retry up to max_retries (default: 3) with exponential backoff
```

### 10.2 Idempotency

- Caller MUST include `idempotency_key` for exactly-once semantics
- Callee stores result keyed by idempotency_key
- Duplicate requests with same key return cached result without re-execution
- Idempotency keys expire after 24 hours

### 10.3 Backpressure

- If callee's request queue is full, return `error.rate-limit` with `retry_after_ms`
- Caller MUST wait at least `retry_after_ms` before retrying
- Persistent backpressure triggers circuit breaker (after 5 consecutive rate-limits, pause for 60s)

---

## 11. Error Handling

### 11.1 Error Classification

| Category | Type | Retryable | Examples |
|----------|------|-----------|---------|
| **Transient** | Timeout, rate-limit, unavailable | Yes | Network timeout, queue full, provider down |
| **Permanent** | Unauthorized, invalid, not found | No | Permission denied, schema violation, resource gone |
| **Partial** | Some operations succeeded, some failed | Maybe | Batch operation with mixed results |

### 11.2 Error Envelope

Every error MUST include:
```typescript
interface ACPError {
  error_code: string;           // Categorized error code
  error_message: string;       // Human-readable description
  retryable: boolean;           // Whether retry makes sense
  retry_after_ms?: number;      // Suggested retry delay
  details?: unknown;            // Additional context
}
```

### 11.3 Dead Letter Queue

- Messages that fail delivery after `max_retries` go to the DLQ
- Default `max_retries`: 3 for NORMAL priority, 1 for LOW, 0 for BACKGROUND
- DLQ messages retained for 7 days
- Admin agents CAN inspect DLQ: `error.dead-letter.query(filter)`
- Admin agents CAN replay DLQ messages: `error.dead-letter.replay(message_id)`
- DLQ MUST be persistent (survives Kernel restart)

---

## 12. Retry Policy

### 12.1 Default Retry

| Attempt | Delay | Jitter |
|---------|-------|--------|
| 1st retry | 1 second | 0-500ms random |
| 2nd retry | 2 seconds | 0-500ms random |
| 3rd retry | 4 seconds | 0-500ms random |

### 12.2 Rules

1. Exponential backoff: delay = 2^(attempt-1) seconds
2. Jitter: random 0-500ms added to prevent thundering herd
3. Max delay cap: 30 seconds
4. Retry count tracked per `correlation_id`, NOT per message `id`
5. After max retries exhausted → dead letter queue
6. Non-retryable errors (unauthorized, invalid) skip retry entirely

---

## 13. Workspace Channels

### 13.1 Default Channels

Every workspace MUST have these channels created automatically:

| Channel | Purpose | Subscribers |
|---------|---------|-------------|
| `workspace.{id}.events` | System events (agent/task/workspace changes) | All agents |
| `workspace.{id}.tasks` | Task lifecycle events | Managers, Chiefs, Validators |
| `workspace.{id}.agents` | Agent lifecycle events | All agents |
| `workspace.{id}.memory` | Memory change events | Agents with memory.read |
| `workspace.{id}.resources` | Resource allocation events | Managers, Chiefs |
| `workspace.{id}.audit` | Audit log events | Admin agents only |

### 13.2 Custom Channels

- Agents with `channel.create` permission can create custom channels
- Custom channels follow naming: `workspace.{id}.custom.{name}`
- Channel creation requires specifying: name, description, access_level, max_subscribers
- Subscription is permission-gated

---

## 14. Priority System

### 14.1 Priority Levels

| Level | Name | Numeric | Use Case | Can Preempt |
|-------|------|---------|----------|-------------|
| CRITICAL | 0 | System shutdown, error recovery | LOW, BACKGROUND |
| HIGH | 1 | Task deadlines, user interactions | LOW, BACKGROUND |
| NORMAL | 2 | Default agent communication | None |
| LOW | 3 | Analytics, logging, archival | BACKGROUND |
| BACKGROUND | 4 | Cleanup, optimization, reporting | None |

### 14.2 Rules

1. CRITICAL messages preempt all others in the delivery queue
2. Agents CANNOT send CRITICAL messages unless they have `messaging.critical` permission
3. HIGH messages from Chiefs and Managers preempt NORMAL messages from Workers
4. Rate limiting applies per agent per priority level
5. CRITICAL messages have unlimited rate limit; others are bounded
6. A message's priority MUST NOT be upgraded after sending

---

## 15. Conformance

### 15.1 Compliance Levels

| Level | Requirements | Typical Use |
|-------|-------------|------------|
| **Minimal** | Message schema, signing, direct routing, heartbeat | Lightweight agents |
| **Standard** | All routing modes, RPC, approval, retry, workspace channels | Full agents |
| **Full** | Encryption, DLQ management, custom channels, priority override | Infrastructure agents |

### 15.2 Test Requirements

A conformant ACP implementation MUST pass:
1. Message schema validation tests (all 30+ message types)
2. Signing and verification tests (generation, rotation, revocation)
3. Routing tests (direct, channel, broadcast, topic, priority)
4. Heartbeat liveness tests (healthy → suspect → degraded → failed)
5. RPC request-response tests (correlation, timeout, retry, idempotency)
6. Error handling tests (transient vs permanent, DLQ, replay)
7. Priority preemption tests (correct ordering under load)

---

## Appendix A: Message Type Registry

| Category | Type | Code | Payload Required |
|----------|------|------|------------------|
| System | agent.spawn | SYS-001 | Yes |
| System | agent.terminate | SYS-002 | Yes |
| System | agent.heartbeat | SYS-003 | Yes |
| System | agent.capability.advertise | SYS-004 | Yes |
| System | agent.status | SYS-005 | Yes |
| Task | task.create | TSK-001 | Yes |
| Task | task.assign | TSK-002 | Yes |
| Task | task.claim | TSK-003 | Yes |
| Task | task.release | TSK-004 | Yes |
| Task | task.complete | TSK-005 | Yes |
| Task | task.fail | TSK-006 | Yes |
| Task | task.cancel | TSK-007 | Yes |
| Task | task.progress | TSK-008 | Yes |
| Communication | rpc.request | COM-001 | Yes |
| Communication | rpc.response | COM-002 | Yes |
| Communication | rpc.error | COM-003 | Yes |
| Communication | broadcast | COM-004 | Yes |
| Communication | event.publish | COM-005 | Yes |
| Communication | event.subscribe | COM-006 | Yes |
| Communication | event.unsubscribe | COM-007 | Yes |
| Approval | approval.request | APR-001 | Yes |
| Approval | approval.grant | APR-002 | Yes |
| Approval | approval.deny | APR-003 | Yes |
| Approval | approval.expired | APR-004 | Yes |
| Memory | memory.store | MEM-001 | Yes |
| Memory | memory.retrieve | MEM-002 | Yes |
| Memory | memory.search | MEM-003 | Yes |
| Memory | memory.delete | MEM-004 | Yes |
| Resource | resource.allocate | RES-001 | Yes |
| Resource | resource.grant | RES-002 | Yes |
| Resource | resource.deny | RES-003 | Yes |
| Resource | resource.release | RES-004 | Yes |
| Resource | resource.warning | RES-005 | Yes |
| Error | error.dead-letter | ERR-001 | Yes |
| Error | error.timeout | ERR-002 | Yes |
| Error | error.rate-limit | ERR-003 | Yes |
| Error | error.unauthorized | ERR-004 | Yes |
| Error | error.invalid | ERR-005 | Yes |

---

## Appendix B: Error Code Catalog

| Code | Category | Retryable | Description |
|------|----------|-----------|-------------|
| ACP-E001 | Routing | No | Unknown recipient |
| ACP-E002 | Routing | Yes | Recipient queue full |
| ACP-E003 | Routing | No | Cross-workspace routing denied |
| ACP-E010 | Signing | No | Invalid signature |
| ACP-E011 | Signing | No | Unknown public key |
| ACP-E012 | Signing | No | Expired key |
| ACP-E013 | Signing | No | Timestamp out of range |
| ACP-E020 | Schema | No | Unknown message type |
| ACP-E021 | Schema | No | Payload validation failed |
| ACP-E022 | Schema | No | Missing required field |
| ACP-E023 | Schema | No | Message too large |
| ACP-E030 | Permission | No | Sender lacks permission |
| ACP-E031 | Permission | No | Recipient access denied |
| ACP-E040 | Channel | No | Channel does not exist |
| ACP-E041 | Channel | Yes | Channel at capacity |
| ACP-E042 | Channel | No | Not subscribed to channel |
| ACP-E050 | RPC | Yes | RPC timeout |
| ACP-E051 | RPC | No | RPC method not found |
| ACP-E052 | RPC | Yes | Circuit breaker open |
| ACP-E060 | Approval | No | Approval denied |
| ACP-E061 | Approval | No | Approval expired |
| ACP-E070 | Rate | Yes | Rate limit exceeded |
| ACP-E071 | Rate | No | Quota exceeded |

---

## Appendix C: State Machines

### Heartbeat State Machine
```
HEALTHY ──(1 miss)──→ SUSPECT ──(2nd miss)──→ DEGRADED ──(3rd miss)──→ FAILED
   ↑                    │                      │                        │
   │                    │                      │                        │
   └──(heartbeat)───────┘──────────────────────┘────(force terminate)──┘
```

### Approval State Machine
```
PENDING ──(approver grants)──→ APPROVED ──(terminal)
   │
   ├──(approver denies)──→ DENIED ──(terminal)
   │
   └──(timeout expires)──→ EXPIRED ──(terminal, auto-denied)
```

### RPC State Machine
```
IDLE ──(request sent)──→ WAITING ──(response received)──→ COMPLETED
   │                      │
   │                      ├──(timeout)──→ TIMEOUT ──(retry if allowed)──→ WAITING
   │                      │                                    │
   │                      │                    (max retries)──→ FAILED
   │                      │
   └──(circuit breaker)──→ BLOCKED ──(cooldown expires)──→ IDLE
```

---

*This constitution defines the communication fabric of AgentOS. Every message, every channel, every signature traces back to this document. ACP is the nervous system of the operating system — if it is wrong, nothing works correctly.*

**Ratified**: 2026-06-06  
**Signatories**: Chief Architect, AI Architect, Backend Architect, Security Architect