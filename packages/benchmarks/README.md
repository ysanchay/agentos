# @agentos/benchmarks

100-benchmark validation suite for AgentOS Alpha. Runs benchmarks across ONLINE, OFFLINE, and CONNECTIVITY-CHAOS modes with failure injection, telemetry collection, and real-world task execution.

## Overview

The benchmarks package implements the harness defined in ALPHA_VALIDATION.md §2.5. `BenchmarkRunner` orchestrates a single benchmark through the full AgentOS stack. `BenchmarkSuite` runs all 100 benchmarks, collects 7 required metrics per benchmark, and generates a category-level summary report. `FailureInjector` injects agent crashes, network drops, and resource exhaustion. `OfflineSimulator` toggles connectivity during execution. `ConnectivityChaosTrack` adds a dedicated chaos track. `TelemetryCollector` gathers production-grade telemetry, and the real-world task framework executes actual API calls, file operations, and report generation.

## API

- **Types** — `BenchmarkSpec`, `BenchmarkMetrics`, `BenchmarkResult`, `BenchmarkSuiteResult`, `BenchmarkCategory`, `FailureType`, `OfflineMode`, `ValidationCriteria`.
- **`BENCHMARK_SPECS`** — 100 benchmark definitions; `TOTAL_BENCHMARKS`, `getSpecsByCategory()`, `getSpecById()`.
- **`BenchmarkRunner`** — runs a single benchmark with `BenchmarkRunnerDeps`.
- **`BenchmarkSuite`** — runs all benchmarks; `createDefaultBenchmarkSuite()`.
- **`FailureInjector`** — injects `FailureType` faults; returns `FailureRecord`.
- **`OfflineSimulator`** — toggles modes mid-run; returns `ModeTransitionRecord`.
- **`MetricsCollector`** — gathers 7 required metrics; tracks `TrackedEvent`.
- **`BenchmarkVerifier`** — validates `BenchmarkResult` against expected outputs.
- **`ConnectivityChaosTrack`** — chaos-mode track with `ChaosReport` and `ChaosEvent`.
- **`TelemetryCollector`** — `TaskTelemetry`, `SessionTelemetry`, `TelemetrySummary`, `CapabilityUsageRecord`.
- **Real-world tasks** — `createRealWorldTaskSuite()`, `executeRealWorldTaskSuite()`.

## Usage

```bash
# Run all 100 benchmarks
npx tsx packages/benchmarks/src/cli/run-all.ts

# Run three-mode (ONLINE / OFFLINE / CHAOS)
npx tsx packages/benchmarks/src/cli/run-three-modes.ts

# Run real-world tasks (actual API calls, file operations)
npx tsx packages/benchmarks/src/cli/run-real-world.ts

# Debug a single benchmark's invariants
npx tsx packages/benchmarks/src/cli/debug-invariant.ts
```

```typescript
import { createDefaultBenchmarkSuite } from '@agentos/benchmarks';

const suite = createDefaultBenchmarkSuite({ deps });
const result = await suite.runAll();
console.log(result.summary); // CategorySummary[]
```

## Configuration

Benchmark selection and mode are configured via CLI flags or `BenchmarkSuiteConfig`. Failure injection and offline scenarios are defined per-spec in `BENCHMARK_SPECS`.

## Tests

```bash
pnpm --filter @agentos/benchmarks test
```

## License

Proprietary — Nous Research