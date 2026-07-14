/**
 * @agentos/offline — Offline Runtime for AgentOS
 * Makes AgentOS a true OS: it keeps working with no internet, degrades predictably
 * on partial connectivity, and exploits the cloud when present.
 *
 * ZERO AI logic — like the kernel, this is a deterministic coordinator.
 * Design: docs/adr/008-offline-runtime.md
 *
 * Batch 1 (implemented): ExecutionMode contract, Connectivity Monitor, Mode Controller.
 * Batch 2 (implemented): Local Model Registry, Inference Router.
 * Batch 3 (implemented): Offline Execution Queue.
 * Batch 4 (implemented): Artifact Cache, Memory Cache.
 * Batch 5 (implemented): Synchronization Engine.
 */

// ─── Mode contract (Batch 1) ───────────────────────────────────────────────

export { ModeController, type ModeControllerConfig } from './mode-controller.js';
export { ConnectivityMonitor } from './connectivity-monitor.js';

// ─── Local inference (Batch 2) ──────────────────────────────────────────────

export { LocalModelRegistry } from './local-model-registry.js';
export { InferenceRouter } from './inference-router.js';
export type {
  InferenceRouterConfig,
  LocalExecutor,
  CloudExecutor,
  EnqueueFn,
  ConsumptionSink,
} from './inference-router.js';

// ─── Execution Queue (Batch 3) ──────────────────────────────────────────────

export { ExecutionQueue } from './execution-queue.js';
export type { ExecutionQueueConfig, EnqueueResult } from './execution-queue.js';

// ─── Caches (Batch 4) ────────────────────────────────────────────────────────

export { ArtifactCache } from './artifact-cache.js';
export type { ArtifactCacheConfig, StoreResult } from './artifact-cache.js';
export { MemoryCache } from './memory-cache.js';
export type { MemoryCacheConfig, BufferedWrite, FlushResult } from './memory-cache.js';

// ─── Sync Engine (Batch 5) ──────────────────────────────────────────────

export { SyncEngine } from './sync-engine.js';
export type { SyncEngineConfig, ReconcileParams } from './sync-engine.js';

export {
  ExecutionMode,
  ConnectivityState,
  OFF,
  DEFAULT_CONNECTIVITY_CONFIG,
  DEFAULT_ROUTING_POLICY,
} from './types.js';

export type {
  // Mode
  ModeTransition,
  ModeChangeListener,
  OfflineErrorCode,
  // Connectivity
  ProbeResult,
  ConnectivityMonitorConfig,
  // Local model registry + router (Batch 2)
  LocalModel,
  ModelModality,
  ModelReadiness,
  HardwareRequirements,
  HostProfile,
  RoutingTarget,
  RoutingPolicy,
  RoutingDecision,
  InferenceRequest,
  InferenceOutcome,
  // Subsystem contracts (implemented in later batches)
  QueuedOperation,
  QueuedOpKind,
  CachedArtifact,
  SyncResult,
  SyncOutcome,
  OfflineEligibility,
} from './types.js';
