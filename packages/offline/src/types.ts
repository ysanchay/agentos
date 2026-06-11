/**
 * @agentos/offline — Type System
 * Types and Zod schemas for the Offline Runtime, derived from ADR-008.
 *
 * Constitutional alignment:
 *   - Mode transitions are SYSTEM-domain events (kernel-api-v1 §3.9).
 *   - Local inference still records ResourceConsumption (kernel-api-v1 §5.3) — offline is not free.
 *   - Queue replay is idempotent (kernel invariant #10).
 *
 * This file declares the contract for ALL seven subsystems so later batches
 * implement against a fixed surface. Only the Connectivity Monitor and Mode
 * Controller are implemented in Batch 1.
 */

import { z } from 'zod';
import type { ResourceBudget, CapabilityPath, WorkspaceID } from '@agentos/types';

// ─── Execution Modes ─────────────────────────────────────────────────────

/**
 * The three connectivity regimes AgentOS operates under.
 * The Mode Controller is the single authority on the current mode.
 */
export enum ExecutionMode {
  /** No network. Local-only inference; cloud/external requests are enqueued. */
  OFFLINE = 'offline',
  /** Full connectivity AND a drained queue. Cloud-first with local fallback. */
  ONLINE = 'online',
  /** Partial connectivity OR a non-empty queue with connectivity. Per-capability routing. */
  HYBRID = 'hybrid',
}

/**
 * Debounced connectivity signal produced by the Connectivity Monitor.
 * Distinct from raw probe results — this is the hysteresis-stabilized verdict.
 */
export enum ConnectivityState {
  /** All probed endpoints reachable within latency budget. */
  FULL = 'full',
  /** Some endpoints reachable, or reachable but degraded (latency/loss). */
  PARTIAL = 'partial',
  /** No endpoint reachable. */
  NONE = 'none',
}

// ─── Connectivity Probing ────────────────────────────────────────────────

/**
 * Result of a single connectivity probe. The Connectivity Monitor is fed these
 * and is responsible for debouncing them into a stable ConnectivityState.
 * Probing itself (how endpoints are reached) is injected — this package performs
 * no network I/O of its own, keeping it deterministic and testable.
 */
export interface ProbeResult {
  /** Was at least one endpoint reachable? */
  reachable: boolean;
  /** Endpoints that responded, out of those attempted. Enables PARTIAL detection. */
  endpointsReachable?: number;
  endpointsTotal?: number;
  /** Round-trip latency of the best endpoint, in ms. Drives degraded detection. */
  latencyMs?: number;
}

export interface ConnectivityMonitorConfig {
  /** Consecutive failed probes required to declare NONE. Default 3. */
  failuresToOffline: number;
  /** Consecutive healthy probes required to declare FULL. Default 2. */
  successesToFull: number;
  /** Latency (ms) above which a reachable endpoint is considered degraded → PARTIAL. Default 2000. */
  degradedLatencyMs: number;
}

export const DEFAULT_CONNECTIVITY_CONFIG: ConnectivityMonitorConfig = {
  failuresToOffline: 3,
  successesToFull: 2,
  degradedLatencyMs: 2000,
};

// ─── Mode Controller ─────────────────────────────────────────────────────

export interface ModeTransition {
  from: ExecutionMode;
  to: ExecutionMode;
  /** The connectivity verdict that drove this transition. */
  connectivity: ConnectivityState;
  /** Queue depth at transition time (a non-empty queue forbids ONLINE — ADR-008 invariant #5). */
  queueDepth: number;
  timestamp: string;
  reason: string;
}

export type ModeChangeListener = (transition: ModeTransition) => void;

// ─── Offline Error Codes (OFF-xxxx) ──────────────────────────────────────

/** Parallel to KER-xxxx; offline-specific failure namespace (ADR-008). */
export const OFF = {
  NO_LOCAL_PROVIDER: 'OFF-0001',
  QUEUE_FULL: 'OFF-0002',
  SYNC_CONFLICT: 'OFF-0003',
  MODEL_NOT_READY: 'OFF-0004',
  ARTIFACT_CHECKSUM_MISMATCH: 'OFF-0005',
} as const;

export type OfflineErrorCode = (typeof OFF)[keyof typeof OFF];

// ─── Local Model Registry (Batch 2) ──────────────────────────────────────

export const ModelModalitySchema = z.enum(['text', 'code', 'vision', 'embedding']);
export type ModelModality = z.infer<typeof ModelModalitySchema>;

export const ModelReadinessSchema = z.enum(['available', 'loading', 'unavailable']);
export type ModelReadiness = z.infer<typeof ModelReadinessSchema>;

/** A locally-runnable model — the authority on "what can I run with no network". */
export const LocalModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  modality: ModelModalitySchema,
  /** Capability task-types this model can serve offline (e.g. 'coding', 'reasoning'). */
  servesTaskTypes: z.array(z.string()),
  /** Filesystem path or local endpoint. */
  location: z.string(),
  /** SHA-256 of the model artifact, for integrity (OFF-0005). */
  checksum: z.string().optional(),
  readiness: ModelReadinessSchema,
  /** Per-1k-token RU cost profile — offline inference still consumes RU (§5.3). */
  ruPer1kTokens: z.number().nonnegative(),
});
export type LocalModel = z.infer<typeof LocalModelSchema>;

// ─── Offline Execution Queue (Batch 3) ───────────────────────────────────

export const QueuedOpKindSchema = z.enum(['inference', 'http', 'mcp', 'capability']);
export type QueuedOpKind = z.infer<typeof QueuedOpKindSchema>;

/** An operation that requires connectivity, deferred while OFFLINE. */
export const QueuedOperationSchema = z.object({
  id: z.string(),
  kind: QueuedOpKindSchema,
  /** Exactly-once replay key (kernel invariant #10). */
  idempotencyKey: z.string(),
  capabilityPath: z.string().optional(),
  workspaceId: z.string(),
  payload: z.unknown(),
  correlationId: z.string().optional(),
  causationId: z.string().optional(),
  enqueuedAt: z.string(),
  /** Lower = drained first; ties broken by enqueue order (FIFO). */
  priority: z.number().int().min(0).max(5),
});
export type QueuedOperation = z.infer<typeof QueuedOperationSchema>;

// ─── Caches (Batch 4) ────────────────────────────────────────────────────

/** Content-addressed artifact (SHA-256 key). */
export interface CachedArtifact {
  sha256: string;
  contentType: string;
  sizeBytes: number;
  data: Uint8Array;
  cachedAt: string;
}

// ─── Synchronization (Batch 5) ───────────────────────────────────────────

export const SyncOutcomeSchema = z.enum(['applied', 'skipped_duplicate', 'conflict', 'failed']);
export type SyncOutcome = z.infer<typeof SyncOutcomeSchema>;

export interface SyncResult {
  operationId: string;
  outcome: SyncOutcome;
  detail?: string;
}

// ─── Capability offline-eligibility (cross-cutting) ───────────────────────

/**
 * Declares whether a capability can run offline. Inherently-online capabilities
 * (e.g. navigate.browser.goto to a remote site) are simply unavailable offline.
 */
export interface OfflineEligibility {
  path: CapabilityPath;
  offlineEligible: boolean;
  /** If offline-eligible, which local task-type serves it. */
  localTaskType?: string;
}

// Re-export commonly paired constitutional types for convenience.
export type { ResourceBudget, WorkspaceID };
