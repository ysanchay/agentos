# ADR-003: Resource Model

**Status**: Accepted

**Date**: 2026-06-11

**Constitution Reference**: `docs/constitution/resource-model-v1.md` (ratified 2026-06-06)

## Context

AgentOS agents consume real resources: LLM inference tokens, persistent memory,
code execution, and image processing. These have fundamentally different cost
profiles from traditional OS resources (CPU, RAM). LLM inference is billed per
token externally. Memory includes storage plus vector search. Execution includes
browser automation. Vision includes GPU analysis.

Without resource accounting, three failure modes emerge: budget overruns (unlimited
LLM calls spike API bills), starvation (greedy agents block others), and priority
inversion (LOW agents holding resources block CRITICAL work).

Existing frameworks ignore resource management (LangChain, CrewAI) or use a single
type like "tokens" (AutoGen). One metric cannot capture distinct profiles: a
caching agent uses few inference tokens but significant memory; a browser agent
consumes execution but no vision. Collapsing into one metric makes fair scheduling
impossible.

The Resource Model constitution defines resource management as "the economic
foundation on which the entire operating system runs."

## Decision

We adopt the Resource Model as defined in `resource-model-v1.md` as the exclusive
resource accounting and scheduling system. Key decisions:

### Four Fundamental Resource Types

1. **Reasoning Units (RU)**: 1 RU ~ 1,000 output tokens or 10,000 prompt tokens.
   Dominant cost driver. Non-transferable. Accounted per inference call (batching
   encouraged).
2. **Memory Units (MU)**: 1 MU ~ 1MB for 1 hour, or 10 vector searches, or 100
   graph traversals. Dual accounting: storage accrues over time, retrieval per
   operation. Tiered: L0 hot costs more than L3 archival.
3. **Execution Units (EU)**: 1 EU ~ 1 tool call, 10s sandboxed code, or 1 browser
   action. Weighted: reads=1EU, API calls=2-5EU, navigations=5EU. Batched 20% off.
4. **Vision Units (VU)**: 1 VU ~ 1 image analysis, 10s video, or 1 screen capture.
   Batched 20% off (5 images = 4 VU).

### Seven Allocation States

```
PENDING -> GRANTED -> ACTIVE -> RELEASED | EXPIRED | REVOKED
                   |-> THROTTLED -> ACTIVE | PREEMPTED
                   |-> PREEMPTED -> PENDING (rescheduled)
```

### Seven Conservation Invariants

Must hold at all times. Violation is a system bug:

1-4. Per-type conservation: total consumed <= total available (RU, MU, EU, VU).
5. Per-agent: consumed <= allocated for every type.
6. Non-negative: all counts >= 0.
7. No double-counting: a unit allocated to one agent cannot be allocated to another.

### Six Priority Levels with Preemption

| Level | Name | Use Case | Preemption Rights |
|-------|------|----------|-------------------|
| 0 | SYSTEM | Kernel, recovery | Cannot be preempted |
| 1 | CRITICAL | Deadlines, user interactions | Preempt LOW, IDLE |
| 2 | HIGH | Chief/Manager work | Preempt IDLE |
| 3 | NORMAL | Default agent work | None |
| 4 | LOW | Background analysis | None |
| 5 | IDLE | Only when no other work | None |

Same-priority: FIFO. MIN_RUNTIME_MS (30s) before preemption allowed. Critical
sections immune until complete. 3 preemptions/24hr = scheduling penalty; 5 = review.

### Throttle Levels

| Level | Reduction | Duration | Recovery |
|-------|-----------|----------|----------|
| Mild | 50% | 5 min | Automatic |
| Moderate | 75% | 15 min | Automatic |
| Severe | 90% | 1 hr | Automatic |
| Critical | 95% | Until admin | Manual |

Circuit breaker: if infrastructure failure (not abuse) triggers throttle 3 times
consecutively, or component down >5min, escalation pauses for 10 minutes.

### Fair-Share Scheduling

Same-priority agents share available capacity equally. Recalculated every 30s.
Burst: 20% of hourly quota consumable in 1-min window via token-bucket. After
burst exhausted, throttled to steady-state.

### Priority Inversion Prevention

LOW agent holding resources needed by CRITICAL agent gets temporary promotion to
CRITICAL for up to 30s. Must complete critical section and release. Max 3
promotions/hour. Logged for audit.

### Budget Enforcement

Hard (lifetime): 80% = warning, 95% = critical, 100% = 10s checkpoint then
terminate, 100%+30s = force terminate. Soft (hourly): progressive throttle from
50% to suspension after 5+ offenses.

### Five Compute Tiers

Nano(100 RU/hr) through Enterprise(1M RU/hr) with proportional MU/EU/VU/agent/task
limits.

## Consequences

### Positive

- **Cost control**: Every operation metered. 80/95/100% thresholds warn before
  hard termination.
- **Fairness by design**: Fair-share + max wait times (CRITICAL:10s, HIGH:1m,
  NORMAL:5m) + auto-upgrade prevent starvation.
- **Priority inversion resolved**: 30s promotion window + 3/hr limit prevent
  classic OS problem without abuse risk.
- **Four-type granularity**: Scheduler can distinguish memory-heavy from
  inference-heavy agents. Single metric forces both into same bucket.
- **Graceful degradation**: Throttle levels, circuit breaker, and preemption
  protocol reduce load before termination. 10s checkpoint prevents data loss.

### Negative

- **Accounting overhead**: Every operation metered in real time at 1s granularity.
  High write throughput requirement.
- **RU calibration drift**: 1 RU = 1,000 tokens is a reference point. As models
  evolve, calibration table needs architect approval. Wrong calibration =
  misreported consumption.
- **Throttle complexity**: Four levels with different triggers, durations, and
  recovery. Circuit breaker adds conditional behavior. Hard to diagnose.
- **Multi-level quota checks**: Agent -> workspace -> user -> enterprise. Passes
  agent but fails workspace = denied, surprising users with available agent quota.

### Risks and Mitigations

- **Hot path performance**: Atomic counters for tracking, batch persistence for
  audit, in-memory caches for quota lookups.
- **Calibration gaming**: 2/3 architect approval. Cannot retroactively reduce
  budgets. Kernel enforces table at allocation time.
- **Priority escalation loops**: Auto-upgrade capped at twice. Max wait bounded
  per level.