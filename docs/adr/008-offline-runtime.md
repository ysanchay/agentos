# ADR-008: Offline Runtime

**Status**: Proposed

**Date**: 2026-06-12

**Deciders**: _pending_ — requires 1 architect + 1 maintainer approval per GOVERNANCE.md Tier 2 (new package). Mode-switching semantics may additionally require Tier 1 constitutional review of kernel-api-v1.md.

**Constitution Reference**: kernel-api-v1.md (§5 Cross-Cutting Concerns, §6 Kernel Invariants), resource-model-v1.md, capability-graph-v1.md (Article VII), threat-model-v1.md

---

## Context

AgentOS today assumes the network is present. The `@agentos/llm` client routes every inference to a Model Router at `localhost:8080` and, by configuration, on to cloud models; capability providers, MCP servers, browser, and desktop runtimes all assume reachable endpoints. The moment connectivity drops, the swarm stalls: agents cannot reason, tasks cannot be claimed productively, and the system has no defined behavior for degraded operation.

This contradicts the founding claim that AgentOS is an **operating system** for intelligent workforces. A real OS does not stop scheduling when a network cable is pulled. For AgentOS to be a true platform — not a thin orchestration layer over cloud APIs — it must continue to function with **no internet at all**, degrade predictably when connectivity is partial, and exploit the cloud when it is available.

The problem is not "add a local model." The problem is defining a **runtime contract** under which every existing subsystem — Swarm, Memory, Capabilities, Browser Runtime, Desktop Runtime, Security Hypervisor, Mission Control, EventStore — keeps satisfying its constitutional invariants across three connectivity regimes, and a deterministic mechanism that moves the whole system between those regimes without violating any invariant.

### Forces

| Force | Tension |
|-------|---------|
| Availability | The system must make progress offline, but offline inference is lower-capability than cloud frontier models. |
| Determinism | The kernel is constitutionally AI-free and deterministic; mode switching must be a deterministic state machine, not a heuristic guess. |
| Conservation | Offline work still consumes RU/MU/EU/VU. Resource accounting (kernel-api §5.3) cannot be skipped just because compute is local and "free." |
| Auditability | Kernel invariant #4 (Audit Completeness): every mode transition and every queued/replayed operation must emit events to EventStore. |
| Consistency | Work performed offline (memory writes, task results, artifacts) must reconcile with the canonical state when connectivity returns, without data loss and without double-application (idempotency, kernel invariant #10). |
| Security | threat-model TB-7 (Agent to External): offline operation must not become a way to bypass the Security Hypervisor's egress controls; sync must re-validate on reconnect. |

---

## Decision

Introduce a new package **`@agentos/offline`** that owns connectivity awareness and the Offline/Online/Hybrid execution contract. It contains **no AI logic** — like the kernel, it is a deterministic coordinator. It exposes seven subsystems plus a mode controller:

1. **Local Model Registry** — catalog of locally-available models (path, modality, capabilities, RU-cost profile, checksum, readiness). The authority on "what can I run with no network."
2. **Local Inference Router** — the offline analogue of `@agentos/llm`'s router. Resolves a capability/task-type to a registered local model; refuses (does not silently degrade) when no local model satisfies the request.
3. **Offline Execution Queue** — durable, ordered queue of operations that *require* connectivity (cloud inference, external HTTP, MCP calls to remote servers) but were issued while offline. Each entry carries an idempotency key, correlation/causation IDs, and the originating workspace.
4. **Synchronization Engine** — on reconnect, drains the queue and reconciles locally-produced state (memory entries, task results, artifacts) against canonical state. Last-writer-wins is **not** assumed; reconciliation is per-object and conflict-aware, emitting `sync.*` events for every action.
5. **Artifact Cache** — content-addressed (SHA-256) store for capability outputs and files, so artifacts produced or fetched online remain available offline.
6. **Memory Cache** — offline-durable mirror of L1/L2 memory reads (read-through) and a write-buffer for memory writes issued offline, replayed through `memory.store` semantics on reconnect.
7. **Mode Controller** — the deterministic state machine that owns the current `ExecutionMode` and drives every subsystem's behavior.

### Execution Modes

```
enum ExecutionMode { OFFLINE, ONLINE, HYBRID }
```

| Mode | Inference | External capabilities | Queue | Sync |
|------|-----------|----------------------|-------|------|
| ONLINE | cloud-first via @agentos/llm, local as fallback | executed immediately | empty / draining | idle |
| OFFLINE | local-only via Local Inference Router; cloud requests enqueued | enqueued, not executed | accepting | idle |
| HYBRID | route per-capability: local for offline-eligible, cloud for the rest when reachable | executed if reachable, else enqueued | accepting + draining | active |

### Mode Transition State Machine (deterministic)

```
States: [ONLINE, HYBRID, OFFLINE]

ONLINE → HYBRID : connectivity degraded (probe latency/loss past threshold) OR partial endpoint reachability
ONLINE → OFFLINE: connectivity lost (consecutive probe failures ≥ N)
HYBRID → ONLINE : connectivity restored AND queue drained
HYBRID → OFFLINE: connectivity fully lost
OFFLINE → HYBRID: connectivity partially restored; begin draining queue
OFFLINE → ONLINE: connectivity fully restored AND queue drained
```

Transitions are driven **only** by the Connectivity Monitor's debounced signal plus queue state — never by an agent or a model. Every transition emits a `system.mode.*` event (EventDomain.SYSTEM) to EventStore before any subsystem reconfiguration (invariant #4, ordering before side effects per kernel-api §3.9).

### Invariants introduced by this package

1. **Mode determinism**: given the same ordered sequence of connectivity probes and queue states, the Mode Controller produces the same mode transitions.
2. **No silent capability loss**: an offline request for a capability with no local provider MUST return an explicit `OFF-xxxx` error or be enqueued — never a degraded/hallucinated local result.
3. **Queue durability & idempotency**: every enqueued operation carries an idempotency key; replay MUST be exactly-once in effect (kernel invariant #10).
4. **Conservation across modes**: local inference still records ResourceConsumption (RU/MU/EU/VU). Offline is not free.
5. **Reconcile-before-online**: the system MUST NOT report `ONLINE` while the queue is non-empty; a non-empty queue with connectivity is `HYBRID`.
6. **Audit completeness**: every mode transition, enqueue, dequeue, and reconciliation decision emits an event.
7. **Security re-validation on sync**: queued external operations are re-checked by the Security Hypervisor at drain time, not trusted because they passed pre-checks while offline.

### Error namespace

Offline-specific failures use the `OFF-xxxx` namespace (parallel to `KER-xxxx`), e.g. `OFF-0001` No local provider, `OFF-0002` Queue full, `OFF-0003` Sync conflict unresolved, `OFF-0004` Model not ready, `OFF-0005` Artifact checksum mismatch.

---

## Consequences

### Positive

- **True OS positioning**: AgentOS makes progress with the network unplugged. This is the differentiator the Alpha program is meant to prove.
- **Single ownership of connectivity**: every subsystem asks the Mode Controller "what mode are we in" rather than each re-implementing reachability checks and fallback logic (the same anti-duplication argument as ADR-005's single choke point).
- **Deterministic & testable**: the mode machine is pure state + probe input, so it is simulation-verifiable like the kernel — the 100-agent simulation can run a "connectivity chaos" track.
- **Constitution-aligned**: reuses existing invariants (conservation, audit, idempotency) rather than inventing parallel mechanisms; mode transitions are events, not hidden state.
- **Graceful cloud exploitation**: HYBRID lets the system use frontier models when present without making them load-bearing.

### Negative

- **Capability matrix complexity**: every capability must declare offline-eligibility. Capabilities that are inherently online (e.g. `navigate.browser.goto` to a remote site) are simply unavailable offline; the capability graph must carry this metadata.
- **State reconciliation is hard**: memory writes and task results produced offline can conflict with online changes. The Synchronization Engine introduces genuine distributed-systems complexity (conflict detection, causal ordering) that did not exist before.
- **Local model footprint**: shipping/registering local models adds disk and memory cost; the Local Model Registry must be honest about what is actually runnable on the host.
- **Lower offline capability ceiling**: results produced offline may be lower quality than cloud; the Reputation Engine (next on the roadmap) will need to score by mode so this is measurable rather than hidden.
- **Mode flapping risk**: a flaky connection could oscillate ONLINE↔OFFLINE. Mitigated by debounced, hysteresis-based probing (separate enter/exit thresholds).

### Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Mode flapping under flaky network | Medium | Medium | Hysteresis: separate degrade/restore thresholds + N-consecutive-probe debounce |
| Queue grows unbounded while offline | Medium | High | Bounded queue with backpressure (`OFF-0002`); oldest-non-critical eviction policy + persistence to disk |
| Sync double-applies operations | Medium | High | Idempotency keys + EventStore causation chain; reconciliation is event-sourced and replay-safe |
| Offline path bypasses Security Hypervisor | Low | High | Invariant #7: re-validate every queued external op at drain time |
| Local result silently substituted for cloud | Medium | High | Invariant #2: explicit `OFF-0001` or enqueue, never silent degradation |

---

## Implementation Plan (batched)

1. **Batch 1 (this ADR + scaffold)**: package scaffold, type system (`types.ts`), Connectivity Monitor, Mode Controller + tests. _(no AI logic; deterministic core)_
2. **Batch 2**: Local Model Registry + Local Inference Router.
3. **Batch 3**: Offline Execution Queue (durable, idempotent) + backpressure.
4. **Batch 4**: Artifact Cache + Memory Cache (content-addressed).
5. **Batch 5**: Synchronization Engine + conflict reconciliation + `sync.*` events.
6. **Batch 6**: integration — wire Swarm/Memory/Capabilities/LLM to query the Mode Controller; add a connectivity-chaos track to `@agentos/simulation`.

---

*This ADR is Proposed, not Accepted. Implementation has begun for Batch 1 (deterministic core only) to de-risk the design; no constitutional document has been amended. Acceptance requires the approvals named above.*
