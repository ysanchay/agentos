# @agentos/simulation

100-agent simulation that verifies the AgentOS constitutional architecture works at scale. ZERO AI logic — deterministic simulation only.

## Overview

The simulation package spins up 100 fake agents (Chief, Manager, Worker, Validator roles) through `AgentFactory`, generates synthetic workloads via `WorkloadGenerator`, and runs them through the real kernel, protocol, blackboard, and resource scheduler. `SimulationClock` drives deterministic time advancement. `SimulationVerifier` checks all 10 constitutional invariants at each tick, and `SimulationReporter` produces `SimulationMetrics` and `VerificationResults`.

## API

- **`Simulation`** — main class; runs the full simulation and returns `SimulationResult`.
- **`createConfig` / `DEFAULT_CONFIG`** — `SimulationConfig` builder and defaults.
- **`SimulationClock`** — deterministic virtual clock for reproducible runs.
- **`SimulationReporter`** — collects `SimulationMetrics`, runs `VerificationCheck[]`, returns `VerificationResults`.
- **`SimulationVerifier`** — validates `SimulationState` against constitutional invariants.
- **`FakeAgent` / `AgentFactory`** — deterministic fake agents with `FakeAgentRole` and `FakeAgentConfig`.
- **`WorkloadGenerator`** — generates `GeneratedTask` instances from `TaskTemplate[]`.

## Usage

```typescript
import { Simulation, createConfig, SimulationReporter } from '@agentos/simulation';

const config = createConfig({ agentCount: 100, ticks: 1000 });
const sim = new Simulation(config);
const result = await sim.run();
console.log(result.metrics);
console.log(result.verification); // invariant check results
```

## Configuration

`SimulationConfig` (via `DEFAULT_CONFIG` or `createConfig()`) controls agent count, tick count, workload templates, and seed for deterministic replay. A CLI entry point is available via `pnpm --filter @agentos/simulation start`.

## Tests

```bash
pnpm --filter @agentos/simulation test
```

## License

Proprietary — Nous Research