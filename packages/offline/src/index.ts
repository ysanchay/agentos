/**
 * @agentos/offline — Offline Runtime for AgentOS
 * Makes AgentOS a true OS: it keeps working with no internet, degrades predictably
 * on partial connectivity, and exploits the cloud when present.
 *
 * ZERO AI logic — like the kernel, this is a deterministic coordinator.
 * Design: docs/adr/008-offline-runtime.md
 *
 * Batch 1 (implemented): ExecutionMode contract, Connectivity Monitor, Mode Controller.
 * Batches 2–5 (typed, not yet implemented): Local Model Registry, Local Inference Router,
 * Offline Execution Queue, Artifact/Memory Caches, Synchronization Engine.
 */

// ─── Mode contract (Batch 1) ───────────────────────────────────────────────

export { ModeController, type ModeControllerConfig } from './mode-controller.js';
export { ConnectivityMonitor } from './connectivity-monitor.js';

export {
  ExecutionMode,
  ConnectivityState,
  OFF,
  DEFAULT_CONNECTIVITY_CONFIG,
} from './types.js';

export type {
  // Mode
  ModeTransition,
  ModeChangeListener,
  OfflineErrorCode,
  // Connectivity
  ProbeResult,
  ConnectivityMonitorConfig,
  // Subsystem contracts (implemented in later batches)
  LocalModel,
  ModelModality,
  ModelReadiness,
  QueuedOperation,
  QueuedOpKind,
  CachedArtifact,
  SyncResult,
  SyncOutcome,
  OfflineEligibility,
} from './types.js';
