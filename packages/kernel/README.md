# @agentos/kernel

The deterministic heart of AgentOS. The kernel enforces 10 constitutional invariants at all times and hosts the core registries, permission engine, dependency graph, and event bus that every agent and task flows through.

## Overview

The kernel is a pure, deterministic coordinator with ZERO AI logic. It owns `AgentRegistry`, `TaskRegistry`, and `WorkspaceRegistry`, applies state-machine transitions for agents, tasks, and workspaces, validates the DAG of task dependencies, enforces permissions, and checks all 10 invariants after every mutation. Every state transition is published to the `EventBus` and persisted via the `EventStore`.

## API

- **`Kernel`** — top-level facade that wires registries, state machines, permission engine, dependency graph, event bus, and invariant checker together.
- **State machines** — `GenericStateMachine`, `AgentStateMachine`, `TaskStateMachine`, `WorkspaceStateMachine` with `TransitionDef` / `TransitionRecord` types.
- **Registries** — `AgentRegistry`, `TaskRegistry`, `WorkspaceRegistry` for create/read/update of entities.
- **`DependencyGraph`** — DAG of task dependencies; detects cycles (Invariant 6).
- **`PermissionEngine`** — evaluates `Permission` sets per agent (Invariant 5).
- **`EventBus`** — in-process pub/sub for `Event` objects.
- **`InvariantChecker`** — runs all 10 checks, returns `InvariantReport` with `InvariantViolation[]`.

## Usage

```typescript
import { Kernel } from '@agentos/kernel';

const kernel = new Kernel({ eventStore, protocol });
const agent = kernel.agents.create({ type: 'worker', permissions: [...] });
const task = kernel.tasks.create({ workspaceId, dependencies: [] });
const report = kernel.invariants.check();
if (report.violations.length > 0) {
  throw new Error(`Invariant violated: ${report.violations[0].invariant}`);
}
```

## Configuration

Kernel behavior is configured through `AgentOSConfig` (from `@agentos/types`). No environment variables are read directly by the kernel; the caller passes a resolved config object.

## Tests

```bash
pnpm --filter @agentos/kernel test
```

## License

Proprietary — Nous Research