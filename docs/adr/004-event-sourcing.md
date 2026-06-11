# ADR-004: Event Sourcing

**Status**: Accepted

**Date**: 2026-06-11

**Constitution Reference**: `docs/constitution/kernel-api-v1.md` (ratified 2026-06-06)

## Context

AgentOS objects have complex lifecycles: agents traverse 10 states, tasks traverse
9. Dozens of transitions have preconditions, side effects, and invariants.

The CRUD approach (store current state, mutate in place) has four critical
weaknesses. Audit gaps: a transition from RUNNING to ERRORED records the result
but not why. Debugging blindness: a stuck BLOCKED task shows current state but
not the event sequence that produced it. Recovery impossibility: database
corruption or invalid transitions leave no way to replay from a known-good point.
Trust erosion: without a tamper-evident record, a compromised agent or admin can
alter state undetected.

The Kernel API constitution mandates: "All state changes MUST be captured as
events. The event log is the source of truth. Any object's current state MUST be
reconstructable by replaying its events from creation."

## Decision

We adopt event sourcing as defined in `kernel-api-v1.md` as the state management
model for all Kernel objects. Key decisions:

### Events as Source of Truth

The event log is the authoritative state record. Every object's current state is
a projection of its event history. Materialized views are query optimizations
that can be rebuilt from the log. If view and log disagree, the log is correct.

Every state transition in every object must emit an event. The Kernel API defines
11 event domains: agent, task, workspace, project, capability, permission, memory,
resource, approval, system, security.

### SHA-256 Hash Chain

Consecutive events within a domain are linked by SHA-256 hashes. Each event
includes the hash of the previous event in its domain. Modification or deletion
breaks the chain, making tampering detectable. Cross-domain ordering uses
timestamps and correlation IDs, not hash links, allowing domain partitioning.

### Write-Ahead Persistence

Events are persisted to the audit log before any state mutation ("audit log first,
side effects second"). If the system crashes after the event but before the side
effect, the log is complete and replay reconstructs state. Event persistence
must succeed before any side effect commits.

### Event Immutability

Events must not be modified after creation. Incorrect data is corrected via a
new compensating event, not by mutating the original. This preserves complete
history and audit reliability.

### Correlation and Causation IDs

- `correlation_id`: Links request to response (Chief sends `task.assign`, Worker
  responds `task.claimed` -- same correlation_id).
- `causation_id`: Links an event to what caused it (`task.blocked` carries
  causation_id pointing to the `resource.exhausted` event).

Together they reconstruct causal chains: "Task X blocked because allocation Y
failed because workspace Z exceeded quota."

### Ten Kernel Invariants

Event sourcing must preserve these invariants:

1. **Conservation of Resources**: Every allocation offset by release/expiry.
2. **Agent Isolation**: Events scoped by agent and workspace.
3. **Terminal Finality**: No transition from terminal states (terminated, deleted).
4. **Audit Completeness**: Every transition has an event.
5. **Permission Enforcement**: Permission checks logged as events.
6. **Dependency Acyclicity**: Cycle detection rejects circular dependencies.
7. **Workspace Isolation**: Events workspace-scoped, no cross-workspace leaks.
8. **Budget Hard Limit**: Exhaustion triggers termination events.
9. **Event Ordering**: Same-source events totally ordered by timestamp (UUID v7).
10. **Idempotency**: Same key produces same result; no duplicate events per key.

### Conformance Tiers

- **MUST**: Agent/task/workspace/permission/resource events + audit logging on
  every transition.
- **SHOULD**: Project/capability/memory/approval events + event replay + resource
  rebalancing events.
- **MAY**: Workspace locking, agent suspension, advanced throttling events.

### Dual Store Architecture

- **InMemoryEventStore**: Development and testing. No persistence. Loses data on
  restart. Suitable for unit tests.
- **Persistent adapter**: Production. PostgreSQL partitioned by month. Crash
  recovery, replay, hash chain verification. Required where data loss is
  unacceptable.

## Consequences

### Positive

- **Complete audit trail**: Every transition, permission check, allocation, and
  action recorded. Audit is the primary data structure, not an afterthought.
- **Temporal debugging**: Replay the event log to see exactly which events led to
  a stuck BLOCKED task, which agent held which resource, which dependency failed.
  Impossible with CRUD.
- **Crash recovery**: Replay from last checkpoint reconstructs state. Write-ahead
  guarantee ensures log is always ahead of views.
- **Tamper evidence**: SHA-256 hash chain detects modification or deletion. A
  compromised admin cannot silently alter the audit trail.
- **Causal tracing**: correlation_id + causation_id enable end-to-end tracing
  from user request through task/resource/capability to result delivery.

### Negative

- **Storage growth**: 50 agents + 200 tasks = thousands of events/hour. Monthly
  partitioning and archiving mitigate but add operational burden.
- **Replay latency**: Reconstructing state requires replaying all events. An agent
  running months may have thousands. Materialized snapshots reduce this but add
  sync complexity.
- **Event schema evolution**: Field additions, type renames break old event
  deserialization. Versioned schemas and upcasting (transform old on read) needed.
- **Dual consistency burden**: Materialized views may lag the event log. Sync
  updates add write latency; async adds read staleness. Scheduling needs
  consistency; audit tolerates staleness.

### Risks and Mitigations

- **Storage cost**: Partition by month, compress old partitions, per-domain
  retention policies (security events > heartbeat events).
- **Replay performance**: Periodic snapshots (materialized views) replay from last
  snapshot, not creation. Snapshots optimize, not replace, the event log.
- **Hash chain gaps**: Write-ahead guarantee ensures durability before side
  effects. If corruption occurs, break point identifies the window. Replicated
  storage enables recovery.
- **Schema versioning**: Schema registry, upcasters tested against full history,
  schema version in every event. Immutability means old events are transformed
  on read, never deleted.