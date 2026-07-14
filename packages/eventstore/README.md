# @agentos/eventstore

Immutable, SHA-256 hash-chained event store for AgentOS. Every state transition becomes an event that is cryptographically linked to its predecessor, producing a tamper-evident audit trail.

## Overview

The event store is the audit backbone of the operating system (Invariant 4 — Audit Completeness). Events are appended-only, each carrying a `prevHash` field that chains it to the previous event. The package provides an in-memory implementation (`InMemoryEventStore`), an `AuditChain` for hash verification, an `EventSubscriber` for reactive consumption, event-replay utilities for reconstructing entity state, and snapshot support for fast restoration.

## API

- **`InMemoryEventStore`** — append-only store implementing `IEventStore`; supports `EventFilter` queries.
- **`AuditChain`** — verifies SHA-256 hash continuity across the event log.
- **`EventSubscriber`** — typed subscription to event domains; returns `SubscriptionID` for unsubscribe.
- **`replayForEntity` / `replayFromTimestamp`** — reconstruct state by replaying events for a specific entity or from a point in time.
- **`SnapshotStore`** — key/value snapshot storage; `createSnapshot`, `getLatestSnapshot`, `restoreFromSnapshot`. `Snapshot` type for serialization.

## Usage

```typescript
import { InMemoryEventStore, AuditChain, EventSubscriber } from '@agentos/eventstore';

const store = new InMemoryEventStore();
const sub = new EventSubscriber(store);
const unsub = sub.subscribe('agent.*', (event) => console.log(event));

await store.append({ domain: 'agent', type: 'agent.created', entityId: agentId, payload });
const chain = new AuditChain(store);
const valid = await chain.verify(); // true if hash chain intact
```

## Configuration

No environment variables. The in-memory store is the default implementation; persistent backends can implement `IEventStore`.

## Tests

```bash
pnpm --filter @agentos/eventstore test
```

## License

Proprietary — Nous Research