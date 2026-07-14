# @agentos/offline

Offline runtime for AgentOS. Makes the operating system work with no internet, degrade predictably under partial connectivity, and exploit the cloud when present. Implemented across 6 batches with ZERO AI logic.

## Overview

The offline runtime is a deterministic coordinator (per ADR-008) that manages three execution modes: ONLINE (cloud-first), OFFLINE (local-only, queued), and HYBRID (per-capability routing). It monitors connectivity, routes inference between local and cloud executors, queues operations when offline, caches artifacts and memory writes, and synchronizes state when connectivity is restored.

## API

- **Batch 1 — Mode** — `ModeController` (mode transitions), `ConnectivityMonitor` (probe-based liveness).
- **Batch 2 — Local inference** — `LocalModelRegistry` (registers local models), `InferenceRouter` (routes `InferenceRequest` to `RoutingTarget`).
- **Batch 3 — Queue** — `ExecutionQueue` (durable operation queue with `EnqueueResult`).
- **Batch 4 — Caches** — `ArtifactCache` (store/retrieve `CachedArtifact`), `MemoryCache` (buffered writes with `FlushResult`).
- **Batch 5 — Sync** — `SyncEngine` (reconciles offline state with cloud via `ReconcileParams`).
- **Types** — `ExecutionMode`, `ConnectivityState`, `LocalModel`, `RoutingPolicy`, `RoutingDecision`, `QueuedOperation`, `SyncResult`, `OfflineEligibility`.
- **Constants** — `OFF` (default offline config), `DEFAULT_CONNECTIVITY_CONFIG`, `DEFAULT_ROUTING_POLICY`.

## Usage

```typescript
import { ModeController, ConnectivityMonitor, InferenceRouter, ExecutionQueue } from '@agentos/offline';

const monitor = new ConnectivityMonitor(DEFAULT_CONNECTIVITY_CONFIG);
const controller = new ModeController({ monitor });
const router = new InferenceRouter({ localModels, cloudExecutor, queue });
await controller.start(); // begins probing and mode transitions

const outcome = await router.route({
  request: { prompt: 'Generate code', taskType: 'code.gen' },
  mode: controller.currentMode,
});
```

## Configuration

`DEFAULT_CONNECTIVITY_CONFIG` controls probe interval, timeout, and thresholds. `DEFAULT_ROUTING_POLICY` defines per-capability routing rules. `ModeControllerConfig` and `SyncEngineConfig` are passed programmatically.

## Tests

```bash
pnpm --filter @agentos/offline test
```

## License

Proprietary — Nous Research