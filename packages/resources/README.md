# @agentos/resources

Deterministic resource scheduler for AgentOS. Enforces RU/MU/EU/VU budget limits, conservation laws, quotas, preemption, throttling, and fairness across agents, workspaces, users, and enterprises. ZERO AI logic.

## Overview

The resource package guarantees Invariants 1 (Conservation) and 8 (Budget Hard Limit). Every resource allocation, consumption, and release is tracked and validated. The `ResourceScheduler` is the entry point; it delegates to specialized engines for quota checking, preemption, throttling, fairness, budget enforcement, conservation, efficiency scoring, anomaly detection, and token-bucket rate limiting.

## API

- **`ResourceScheduler`** — top-level scheduler with `SchedulerConfig`; allocates and releases `ResourceBudget`.
- **`AllocationStateMachine`** — manages `AllocationRecord` lifecycle (pending → granted → released).
- **`QuotaEngine`** — enforces per-agent, workspace, user, and enterprise quotas; returns `QuotaCheckResult`.
- **`PreemptionEngine`** — reclaims resources from lower-priority consumers; returns `PreemptionResult`.
- **`ThrottleEngine`** — graduated `ThrottleLevel` based on consumption pressure.
- **`FairnessEngine`** — fair-share scheduling, priority-inversion detection, burst management.
- **`BudgetEnforcer`** — hard/soft budget limits at agent/workspace/user/enterprise `BudgetLevel`.
- **`ConservationEnforcer`** — verifies RU/MU/EU/VU conservation (Invariant 1).
- **`EfficiencyScorer`** — computes `EfficiencyMetrics` from usage data.
- **`AnomalyDetector`** — flags abnormal consumption patterns as `AnomalyEvent`.
- **`TokenBucket`** — rate-limiting primitive with `TokenBucketConfig`.

## Usage

```typescript
import { ResourceScheduler } from '@agentos/resources';
import { ResourceUnit } from '@agentos/types';

const scheduler = new ResourceScheduler({ eventStore });
const result = scheduler.allocate({
  agentId,
  request: ResourceUnit.compute(50, 10, 0, 0), // 50 RU, 10 MU
});
if (result.granted) {
  scheduler.consume(agentId, ResourceUnit.compute(20, 5, 0, 0));
}
```

## Configuration

No environment variables. Scheduler behavior is controlled via `SchedulerConfig` passed at construction.

## Tests

```bash
pnpm --filter @agentos/resources test
```

## License

Proprietary — Nous Research