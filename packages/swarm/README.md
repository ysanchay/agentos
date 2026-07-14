# @agentos/swarm

Swarm runtime for AgentOS. Coordinates Chief, Manager, Worker, and Validator agents through ACP messaging, blackboard task coordination, and resource scheduling. Includes Mission Control and Operational Console for live observability.

## Overview

The swarm package implements the four-role agent hierarchy: `ChiefAgent` decomposes goals and allocates budgets, `ManagerAgent` breaks workstreams into tasks and publishes them to the blackboard, `WorkerAgent` claims tasks and executes work via LLM and capabilities, and `ValidatorAgent` reviews outputs for consistency and confidence. `SwarmCoordinator` orchestrates the full lifecycle. `MissionControl` provides a live dashboard snapshot, and `OperationalConsole` extends it with alerts, offline status, security audit entries, and event timeline. All swarm activity persists through the EventStore.

## API

- **Agent classes** — `SwarmAgent` (base), `ChiefAgent`, `ManagerAgent`, `WorkerAgent`, `ValidatorAgent`.
- **`SwarmCoordinator`** — orchestrates a full swarm run; returns `SwarmResult`.
- **`SwarmMetricsCollector`** — gathers operational metrics.
- **`MissionControl`** — live snapshot: `AgentOverview`, `TaskOverview`, `ResourceOverview`, `MessageTraffic`, `WorkflowProgress`.
- **`OperationalConsole`** — expanded dashboard with `Alert`, `OfflineStatus`, `SecurityAuditEntry`, `ResourceAlert`, `PerformanceMetric`, `EventTimelineEntry`.
- **Types** — `SwarmConfig`, `SwarmGoal`, `Workstream`, `ValidationResult`, `SwarmMetrics`, `WorkerResult`.

## Usage

```typescript
import { SwarmCoordinator, DEFAULT_SWARM_CONFIG } from '@agentos/swarm';

const coordinator = new SwarmCoordinator({
  kernel, protocol, blackboard, resources, llm, memory, capabilities,
});
const result: SwarmResult = await coordinator.run({
  goal: { description: 'Build and deploy REST API', budget: { ru: 10000 } },
  config: DEFAULT_SWARM_CONFIG,
});
console.log(result.metrics);
```

## Configuration

`SwarmConfig` (via `DEFAULT_SWARM_CONFIG`) controls agent counts, validation consensus strategy, and timeout policies. No environment variables read directly.

## Tests

```bash
pnpm --filter @agentos/swarm test
```

## License

Proprietary — Nous Research