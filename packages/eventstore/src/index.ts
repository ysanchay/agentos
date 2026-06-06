/**
 * @agentos/eventstore — Immutable Event Store for AgentOS
 * Every action becomes an event, forming a SHA-256 hash chain for tamper evidence.
 */

// Event Store
export type { IEventStore, EventFilter } from './event-store.js';
export { InMemoryEventStore } from './event-store.js';

// Audit Chain
export { AuditChain } from './audit-chain.js';

// Event Subscriber
export { EventSubscriber } from './event-subscriber.js';
export type { SubscriptionID } from './event-subscriber.js';

// Event Replayer
export { replayForEntity, replayFromTimestamp } from './event-replayer.js';

// Snapshots
export { SnapshotStore, createSnapshot, getLatestSnapshot, restoreFromSnapshot } from './snapshot.js';
export type { Snapshot } from './snapshot.js';