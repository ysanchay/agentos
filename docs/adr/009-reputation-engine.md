# ADR-009: Reputation Engine and Agent Economy

**Status**: Accepted (Design Only — Implementation Deferred)

**Date**: 2026-06-23

**Deciders**: Chief Architect, AI Architect, Backend Architect, Systems Architect. Design framework established under GOVERNANCE.md Tier 1 (new cross-cutting concern: architect quorum ≥2/3 consulted). Implementation is deferred until Alpha Validation benchmark telemetry is available; this ADR establishes the design contract that telemetry will calibrate.

**Constitution Reference**: resource-model-v1.md (RU/MU/EU/VU, budget enforcement), capability-graph-v1.md (Article VII scoring profiles, Phase 6 health monitoring), kernel-api-v1.md (§5.3 Resource Accounting, §6 Kernel Invariants), threat-model-v1.md

---

## Context

AgentOS is designed to run hundreds to thousands of autonomous agents doing real work — coding, browsing, reasoning, desktop automation, validation. At that scale two questions become load-bearing:

1. **Which agents are good?** Without a reputation system, the swarm cannot distinguish an agent that consistently produces validated, efficient work from one that fails silently, abandons tasks, or burns budget for no output. The Capability Graph (ADR-002) already has per-capability scoring in Phase 6, but that scores *capabilities* (is `code.edit` healthy?) not *agents* (is agent `worker-7f3a` reliable at `code.edit`?).

2. **What should things cost?** The Resource Model (ADR-003) defines four resource types — RU, MU, EU, VU — as the internal currency and enforces budgets at 80/95/100% thresholds. But it has no pricing: there is no notion of what a capability invocation *should* cost, whether a task's value justifies its resource consumption, or how to reallocate budget from underperforming workstreams to overperforming ones. The Offline Runtime (ADR-008) compounds this by flagging `producedOffline` results — local inference is cheaper (lower RU) but potentially lower quality, and the system has no mechanism to score agents by mode.

Existing multi-agent frameworks provide no precedent here. AutoGen, CrewAI, and LangGraph treat all agents as interchangeable and have no reputation, economics, or cost-aware routing. They assume a human is in the loop making every allocation decision. AgentOS's swarm (ADR-007) automates that decision — which means it needs the signal to make it well.

The Alpha Validation Program (ALPHA_VALIDATION.md) explicitly calls out this gap:

> The Reputation Engine and Agent Economy need real benchmark telemetry to calibrate:
> - What capabilities are actually expensive vs cheap?
> - What failure modes actually occur in practice?
> - What quality thresholds produce useful validation?
> - What resource ratios (RU:MU:EU:VU) reflect real workloads?

Designing scoring parameters before having this data would produce theoretical numbers that do not match reality. This ADR therefore establishes the **design framework** — the scoring dimensions, the economic model, the integration points — while deferring **calibrated implementation** until 10+ benchmarks produce initial telemetry.

### Forces

| Force | Tension |
|-------|---------|
| Scale | Hundreds-to-thousands of agents require automated quality differentiation; manual curation does not scale. |
| Cost awareness | The system spends finite RU/MU/EU/VU; without pricing it cannot decide whether a task is worth its cost. |
| Incentive alignment | Agents that produce good work should receive more budget and harder tasks; agents that waste resources should lose allocation. |
| Calibration | Scoring weights and pricing rates are meaningless without empirical data; premature calibration produces garbage signals. |
| Gaming | Any reputation metric will be optimized for; the system must cross-validate reputation against independent Validator consensus. |
| Cold start | New agents have no history; the system must bootstrap them without giving them either unearned trust or an impossible barrier. |
| Mode separation | An agent may be excellent online and poor offline (or vice versa); per-mode scoring is required so the Offline Runtime's `producedOffline` flag translates into a routing signal. |

---

## Decision

Establish the design framework for two interlocking subsystems: the **Reputation Engine** (per-agent scoring) and the **Agent Economy** (pricing, value accounting, and budget allocation). Implementation is deferred until benchmark telemetry is available; this ADR fixes the contract that telemetry will calibrate.

### Reputation Engine

A per-agent reputation system that scores each agent along three independent dimensions plus a composite. All scores are 0–100.

#### 1. Quality Score (0–100)

Based on validation pass rate, output confidence, and peer reviews.

- **Per-capability breakdown**: an agent may excel at `browser.*` and fail at `desktop.*`. Quality is tracked as a vector `{capability: score}`, not a single scalar. The composite uses the agent's quality across the capabilities relevant to the task being routed.
- **Per-mode breakdown**: online and offline performance are scored independently. A result carrying `producedOffline: true` (ADR-008) feeds the offline quality vector, not the online one. This makes mode-specific routing possible: an agent that is excellent offline but mediocre online can be preferentially routed to offline-eligible work.
- **Confidence-weighted**: a score computed from 200 validated tasks is weighted higher than one from 5. The system uses a Wilson lower bound (or equivalent) so an agent with 95% pass rate over 200 tasks outranks one with 100% over 3.
- **Time-decay**: recent performance is weighted higher. Half-life of 7 days — a task completed today counts fully; one from two weeks ago counts at ~25%. This ensures reputation tracks current capability, not historical glory.

#### 2. Reliability Score (0–100)

Based on failure rate, recovery success, and heartbeat stability.

- **Crash frequency**: how often the agent process terminates unexpectedly. Sourced from heartbeat state transitions (HEALTHY → SUSPECT → DEGRADED → FAILED, ADR-001).
- **Task abandonment rate**: fraction of claimed tasks the agent released without completing (excluding legitimate reassignment via the Blackboard).
- **Deadline miss rate**: fraction of tasks that exceeded their deadline, sourced from task lifecycle events.
- **Recovery success**: did the agent recover from a failure autonomously (re-claimed, re-attempted, succeeded) or did it require Manager intervention? Autonomous recovery is a positive signal; requiring escalation is neutral; silent failure is negative.

#### 3. Efficiency Score (0–100)

Based on resource consumption per unit of work, normalized by task type.

- **RU/MU/EU/VU per completed task** compared to peers doing similar work. An agent that produces the same validated output for 500 RU where peers use 2000 RU is more efficient.
- **Normalized by task type**: reasoning tasks naturally consume more RU; browser tasks consume more EU. Efficiency is computed within a task-type cohort, not across all tasks. The normalization baseline is the per-task-type median consumption, sourced from benchmark telemetry.
- **Offline efficiency** is scored separately: local inference has different RU characteristics (ADR-008 R6 — offline is not free, but rates differ). An agent that is efficient offline may not be efficient online.

#### 4. Composite Score

Weighted combination of the three dimensions.

- **Default weights**: Quality 40%, Reliability 30%, Efficiency 30%.
- **Configurable per workspace**: a workspace running safety-critical validation may weight Quality at 70%; a cost-sensitive workspace may weight Efficiency at 50%.
- **Used by the Capability Resolver** (ADR-002, Phase 7) as an additional scoring factor in provider/capability selection. When two providers can satisfy a capability, the one backed by a higher-reputation agent is preferred, all else equal.

#### Scoring Inputs

| Input | Source | Dimension(s) |
|-------|--------|---------------|
| Validator consensus results | Swarm Validator (ADR-007) | Quality |
| Heartbeat state transitions | ACP (ADR-001) | Reliability |
| Resource consumption reports | @agentos/resources (ADR-003) | Efficiency |
| Task completion/failure events | Blackboard + EventStore | All three |
| Offline mode flag (`producedOffline`) | Offline Runtime (ADR-008) | Mode separation (all three) |

All inputs are events in the EventStore. The Reputation Engine is a read-side projection: it consumes events and computes scores. It does not introduce new write paths.

### Agent Economy

A pricing and compensation system that makes resource spending cost-aware.

#### 1. Pricing per Capability

Each capability invocation has an expected cost in RU/MU/EU/VU.

- **Market rate discovery**: benchmark telemetry reveals actual per-capability consumption distributions. The price of a capability is the observed median (or configurable percentile) consumption from telemetry, not a guessed constant.
- **Dynamic pricing**: high-demand capabilities cost more during peak load. If `browser.navigate` is contended (all browser sessions in use), its effective price rises so that only tasks whose value justifies the cost claim it. This is congestion pricing, not speculation.
- **Offline discount**: local inference consumes RU at lower rates (ADR-008 R6). Capabilities served locally have a lower RU price than the same capability served by cloud. This creates an economic incentive to prefer offline when quality permits.

#### 2. Task Value Accounting

Each task has an expected value — the usefulness of its output — and a measured cost.

- **Value = f(quality, timeliness, cost)**: a high-quality result delivered on time is worth more; a low-quality or late result is worth less. The value function is calibrated from benchmark data (what output quality actually translates to useful work?).
- **Profitability = value − cost**: a task where cost exceeds value is loss-making.
- **Loss-making tasks are flagged for Chief review**: the Chief (ADR-007) sees which workstreams are spending more than they produce. Persistent loss-making may indicate the task was mis-scoped, the wrong agent was assigned, or the capability is too expensive for the value it delivers.

#### 3. Budget as Investment

Chiefs allocate budget to workstreams as investment, not as entitlement.

- **Expected return = probability of completion × task value**: a workstream with 80% completion probability and high task value merits more budget than one with 20% probability and low value.
- **Rebalancing**: move budget from underperforming workstreams (low completion, high cost, low value) to overperforming ones (high completion, low cost, high value). This is portfolio rebalancing applied to agent work.
- **Insolvency**: when a workstream exhausts its budget, its tasks are reassigned — this already exists in the Resource Model (budget exhausted = task reassigned). The Economy layer adds the *signal* for when rebalancing should happen before insolvency.

#### 4. Reputation-Weighted Allocation

Higher-reputation agents receive preferential allocation.

- **Priority in task claiming**: higher-reputation agents get earlier access to announced tasks. In the Blackboard's task-claim flow, reputation modulates claim ordering — a reputation-90 agent sees the task before a reputation-50 agent. This is not a hard lockout; it is a head start.
- **Larger resource budgets**: trusted agents are allocated more RU/MU/EU/VU. A reputation-85 agent may receive a 2× budget multiplier vs. baseline; a reputation-30 agent receives a reduced allocation. The exact multipliers are calibrated from telemetry.
- **More complex/expensive tasks**: quality-proven agents get harder work. The Swarm's Manager (ADR-007) uses composite reputation to decide which agent receives a high-complexity task vs. a routine one.

#### 5. Slashing

Penalties for misbehavior, applied to the reputation score.

| Violation | Effect | Source |
|-----------|--------|--------|
| Failed validation (false positive — agent claimed work was done, Validator disagreed) | Quality score reduction | Validator consensus |
| Resource waste (high consumption, low/no output) | Efficiency score reduction | Resource consumption reports |
| Security violation | Immediate reputation floor (e.g., 10) + Security Hypervisor action (ADR-005) | threat-model checks |
| Abandoned task (claimed, never completed, released silently) | Reliability score reduction | Task lifecycle events |

Slashing is automatic and event-driven: the Reputation Engine observes the violation event and applies the penalty. The Security Hypervisor (ADR-005) independently takes enforcement action (block, quarantine, audit) for security violations — reputation slashing is the economic consequence layered on top.

### Implementation Deferral

Full implementation is deferred until:

- **10+ benchmarks completed** with full telemetry (RU/MU/EU/VU per capability, per task type, per mode).
- **Actual cost ratios (RU:MU:EU:VU) measured** from real workloads, not estimated.
- **Actual failure modes observed** — which capabilities fail, how often, and why.
- **Actual validation accuracy rates established** — what Validator consensus thresholds produce reliable quality signals.
- **This ADR will be updated** with calibrated parameters (scoring weights, pricing rates, slashing magnitudes, reputation multipliers) after the initial benchmark run. The design framework above is the contract; the numbers are the calibration.

The deferred implementation will land as a new package, tentatively `@agentos/reputation`, following the same batched approach as ADR-008.

---

## Consequences

### Positive

- **Quality signal**: reputation separates good from bad agents, enabling better routing. The Capability Resolver gains a per-agent signal it currently lacks.
- **Cost awareness**: economics prevents wasteful spending on low-value tasks. Loss-making work is surfaced to the Chief rather than silently consuming budget.
- **Incentive alignment**: agents are incentivized to produce high-quality, efficient work. Good performance is rewarded with more budget and harder tasks; poor performance loses allocation.
- **Self-regulating**: poor performers lose budget allocation through reputation-weighted routing; good performers get more work. The system rebalances without manual intervention.
- **Mode-aware routing**: per-mode scoring (online vs. offline) gives the Offline Runtime a concrete routing signal — an agent excellent offline but poor online can be steered to offline-eligible work, improving overall swarm efficiency.

### Negative

- **Gaming risk**: agents may optimize for metrics rather than actual quality. An agent could maximize task completion count (reliability) while producing low-quality output if the quality signal is weak.
- **Calibration dependency**: without benchmark data, all scores and prices are theoretical. Implementing before calibration would produce a reputation system that does not reflect reality.
- **Complexity**: reputation + economics adds two more subsystems to maintain. The Reputation Engine is a read-side projection (lower risk), but the Economy layer touches budget allocation (higher risk — it changes where resources go).
- **Cold start**: new agents have no reputation history. A bootstrap mechanism is required; without it, new agents are either starved (no reputation = no tasks) or over-trusted (default high = untested agent gets expensive work).

### Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Gaming — agents optimize for metrics over quality | Medium | High | Cross-validate with Validator consensus: if reputation is gamed (pass-rate inflated, consumption hidden), Validators independently catch the bad work. Reputation and validation are independent signals; neither trusts the other. |
| Calibration — scores are theoretical without telemetry | High (pre-benchmark) | Medium | Defer implementation until benchmark telemetry available (10+ benchmarks). Design framework is fixed now; parameters are calibrated later. |
| Cold start — new agents cannot get work | Medium | Medium | Default reputation = 50 (neutral). New agents prove themselves through small, low-risk tasks first. Reputation rises with validated work; it does not start high or low. |
| Runaway costs — economy misallocates budget | Low | High | Budget enforcement (80/95/100% thresholds) already exists in the Resource Model (ADR-003). The Economy layer adds rebalancing signals; it does not remove the hard budget floor. Insolvency = task reassigned, already implemented. |
| Slashing false positives — legitimate work penalized | Medium | Medium | Slashing is tied to Validator consensus (quality) and event-sourced consumption (efficiency). A false positive in slashing is itself a quality failure of the Validator, which is itself reputation-scored. |
| Score divergence — per-capability scores disagree | Low | Low | This is expected, not a risk. An agent good at `browser.*` and bad at `desktop.*` is correctly scored differently per capability. The composite uses only the relevant capability scores for the task being routed. |

---

*Accepted 2026-06-23 as a design framework. Implementation deferred until Alpha Validation Batch 1 produces initial benchmark telemetry (target: 10 benchmarks completed). This ADR will be updated with calibrated parameters after that run.*