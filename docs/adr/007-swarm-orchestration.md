# ADR-007: Swarm Orchestration

**Status**: Accepted

**Date**: 2026-06-11

**Deciders**: Chief Architect, AI Architect, Backend Architect

**Constitution Reference**: blackboard-protocol-v1.md (Articles I-XVIII), capability-graph-v1.md (Articles I-XV), threat-model-v1.md (Articles I, VII, XII)

---

## Context

AgentOS must coordinate hundreds to thousands of autonomous agents working on complex goals. Without explicit orchestration, agents duplicate work, leave tasks orphaned, exhaust resources, and produce conflicting results. The blackboard protocol constitution defines the shared coordination layer, but it does not specify how agents organize themselves into effective teams, how goals decompose into executable work, or how the system recovers from failures.

The fundamental challenge: given a high-level user goal ("Build a REST API for user management with tests"), how does AgentOS decompose it into tasks, assign those tasks to workers, verify the results, and report completion -- all while handling agent failures, resource contention, conflicting results, and deadlocks?

Three approaches were considered:

1. **Flat coordination**: All agents are equal. Any agent can claim any task. No hierarchy. This maximizes parallelism but produces chaos: no agent has authority to resolve conflicts, prioritize work, or reassign failed tasks.

2. **Centralized controller**: A single orchestrator assigns all tasks, monitors all agents, and makes all decisions. This provides consistency but creates a bottleneck. The controller cannot scale to thousands of agents and becomes a single point of failure.

3. **Hierarchical swarm**: Agents organize into a 4-tier hierarchy where each level has clear responsibilities and decision authority. Chiefs decompose goals. Managers own workstreams. Workers execute tasks. Validators verify results. The Blackboard provides the shared coordination layer, and MissionControl provides observability.

The blackboard protocol constitution already implies a hierarchy (Article XII: work decomposition from Chief to Manager to Worker; Article VI: validation pipeline). This ADR formalizes that hierarchy and specifies the orchestration patterns that make it work at scale.

---

## Decision

Implement a 4-tier hierarchical swarm architecture with Blackboard-based coordination, consensus-based validation, heartbeat-driven failure recovery, and MissionControl observability.

### Tier 1: ChiefAgent (Goal Decomposition)

The ChiefAgent is the orchestrator-in-chief. It does not execute tasks directly.

**Responsibilities**:
1. Accept user goals and decompose them into workstreams
2. Allocate budget across workstreams
3. Create and assign ManagerAgents to workstreams
4. Monitor overall goal progress
5. Declare goal completion or failure

**Decomposition algorithm**:
- Goal budget determines workstream count: total RU+MU > 10,000 yields 5 workstreams; > 5,000 yields 3; > 1,000 yields 2; else 1
- Budget is divided evenly across workstreams with remainder going to the first workstream
- Each workstream gets the same priority as the parent goal
- Decomposition strategy: `sequential`, `parallel`, or `mixed` (default: `mixed`)

**Budget**: 2,000 RU, 1,000 MU, 500 EU, 200 VU
**Capabilities**: `decompose`, `assign`, `review`, `approve`, `manage`, `coordinate`, `reason.infer.text`, `reason.decide`, `coordinate.plan`
**Max concurrent tasks**: 5

**Progress monitoring**: Chief tracks workstream states. When all workstreams for a goal reach `completed` or `failed`, the goal is resolved. If any workstream fails, the goal is marked `failed`. Goal progress is computed as: `{ total, completed, failed, inProgress, pending }`.

### Tier 2: ManagerAgent (Workstream Management)

ManagerAgents own workstreams. They create tasks on the Blackboard and assign workers.

**Responsibilities**:
1. Receive workstream assignment from Chief
2. Decompose workstream into tasks on the Blackboard
3. Monitor task progress and handle blocked tasks
4. Report workstream progress to Chief
5. Handle resource allocation within workstream budget

**Workstream progress**: Managers compute per-workstream task progress (`{ completed, total }`) by counting task states in their assigned workstream.

### Tier 3: WorkerAgent (Task Execution)

WorkerAgents claim tasks from the Blackboard and execute them using a 3-tier execution model.

**3-Tier Execution Priority**:

| Priority | Mode | Description | Trigger |
|----------|------|-------------|---------|
| 1 (highest) | CapabilityExecutor | Real execution via the resolved capability provider | Task has `cap:` tag or `metadata.capability_path` |
| 2 | LLMClient | Direct LLM call via `@agentos/llm` | `llmMode = 'live'` and no capability path |
| 3 (lowest) | Simulated | Deterministic simulation | Default (no LLM client, no capability executor) |

**Capability execution flow**:
1. Resolve capability path from task tags (`cap:actuate.shell.exec` -> `actuate.shell.exec`) or task metadata (`metadata.capability_path`)
2. Create `ResolutionRequest` with agent, workspace, and task context
3. Infer task input from task metadata or capability-path-specific defaults
4. Invoke via `CapabilityExecutor.invoke(request, input, caller, options)`
5. Track resource consumption and duration
6. Submit result to Blackboard

**Simulated execution**:
- Duration: 100-800ms (random within range, deterministic via seeded RNG)
- Confidence: 0.7-1.0 (random)
- Resource consumption: proportional to duration and budget
- Failure simulation: configurable `failureRate` (default: 5%)

**Budget**: 500 RU, 200 MU, 100 EU, 50 VU
**Capabilities**: `execute`, `implement`, `test`, `review`, `create.code`, `create.code.typescript`, `create.code.python`, `reason.infer.text`
**Max concurrent tasks**: 3

**Task claiming**: Workers scan the Blackboard for `announced` tasks matching their capabilities. Claiming is atomic (first-come-first-served per blackboard protocol Article III). If a claim is rejected (`already_claimed`), the worker moves to the next available task.

### Tier 4: ValidatorAgent (Result Verification)

ValidatorAgents independently review task outputs and vote on approval.

**Validation pipeline** (per blackboard protocol Article VI):
1. Worker submits result to Blackboard results section
2. If `validation_required: true`, assign to available ValidatorAgent(s)
3. If `validation_required: false`: auto-approve if confidence > 0.7; otherwise assign Validator(s)

**Validation criteria** (configurable):

| Check | Default | Description |
|-------|---------|-------------|
| Output exists | Required | Task output must not be null/undefined |
| Min confidence | 0.7 | Confidence threshold for auto-approval |
| Max issues | 3 | Maximum number of issues before rejection |
| Resource usage check | Enabled | Verify resource consumption was recorded |
| Completeness check | Enabled | Output must include completion marker |
| Duration reasonableness | Enabled | Flag tasks completing in <10ms (suspicious) |
| Custom checks | Optional | Array of `(output) => { pass, issue? }` functions |

**Budget**: 200 RU, 100 MU, 50 EU, 25 VU
**Capabilities**: `validate`, `review`, `approve`, `reason.infer.text`, `validate.review`, `validate.approve`
**Max concurrent tasks**: 5

### Consensus Strategies

When multiple Validators review a result, consensus determines the final decision:

| Strategy | Threshold | Use Case |
|----------|-----------|----------|
| Unanimous | 100% approval | Critical tasks (deployments, security changes) |
| Majority | >50% approval | Standard tasks (code generation, data processing) |
| Supermajority | >67% approval | Important tasks (API design, architecture decisions) |
| Chief-decides | Chief breaks ties | Deadlocked or ambiguous decisions |

**Default validators per result**: 3 (configurable via `SwarmConfig.validatorsPerResult`)

### Task State Machine

Per blackboard protocol Article II, tasks follow a 9-state lifecycle:

```
announced -> claimed -> in_progress -> completed (terminal)
                    |                |-> failed (terminal, retryable)
                    |                |-> blocked -> in_progress (resolved)
                    |                |                |-> failed (unresolvable)
                    |                |-> review -> completed (approved)
                    |                |           |-> failed (rejected)
                    |-> announced (claim released/timeout)
cancelled (terminal)
```

**Claim timeout**: 60 seconds. If a claimed task is not moved to `in_progress` within 60 seconds, the claim is auto-released and the task returns to `announced`.

**Retry policy** (per blackboard protocol Article IX):
- `max_retries`: 3 (default)
- `backoff`: exponential (default)
- `initial_delay_ms`: 1,000
- `max_delay_ms`: 30,000
- `jitter`: enabled (prevents thundering herd on mass retries)
- Failed tasks with `retry_count < max_retries` return to `announced` with delay

### Failure Recovery

**Heartbeat protocol** (per blackboard protocol Article XIII):

| Missed Heartbeats | Time Elapsed | Status | Action |
|-------------------|-------------|--------|--------|
| 0 | 0-30s | HEALTHY | Normal operation |
| 1 | 30-60s | SUSPECT | Log warning |
| 2 | 60-90s | DEGRADED | Prepare for task reassignment |
| 3+ | 90s+ | TERMINATED | Reassign all tasks, mark agent TERMINATED |

**Reassignment flow**:
1. Kernel detects heartbeat timeout for agent
2. All tasks owned by failed agent identified (status: `claimed` or `in_progress`)
3. Tasks transition back to `announced`
4. Partial results saved to Blackboard context section for the next agent
5. `previous_owners` array tracks full claim/release history for debugging
6. Persistent agent failures (repeated TERMINATED events) trigger agent review by Chief

### MissionControl Observability

MissionControl provides real-time visibility into swarm state via periodic snapshots.

**Snapshot structure**:

| Section | Data | Purpose |
|---------|------|---------|
| Agents | Total, by type, by state, idle/active/errored/terminated counts | Workforce health |
| Tasks | Total, by state, completion rate, average latency, duplicate claims | Work progress |
| Resources | RU/MU/EU/VU allocated vs consumed, utilization percent | Resource pressure |
| Messages | Total, per-second throughput, by type breakdown, recent events | Coordination load |
| Workflows | Goal -> workstream -> task progress tree | Goal tracking |
| Deadlocks | Detected and resolved counts | Contention monitoring |
| Validation | Requests, approvals, rejections, accuracy | Quality tracking |

**SwarmMetrics** tracks 7 metric categories across the swarm lifecycle:

1. **Task metrics**: total, completed, failed, cancelled, pending, completion rate
2. **Agent metrics**: total, active, idle, errored
3. **Workstream metrics**: total, completed, failed
4. **Resource metrics**: RU/MU/EU/VU allocated and consumed, utilization
5. **Coordination metrics**: task duplication, average latency, deadlock count, recovery success rate
6. **Validation metrics**: requests, approvals, rejections, accuracy
7. **Message metrics**: total sent, per-second throughput

**Rendering modes**:
- `render()`: Full dashboard with sections for agents, tasks, resources, validation, coordination, goals, and recent events
- `renderCompact()`: Single-line status for log monitoring: `Agents:X/Y | Tasks:C/T | Rate:N% | RU:N% | Msgs:N`

### Swarm Configuration

```typescript
interface SwarmConfig {
  id: string;
  totalBudget: ResourceBudget;        // Default: 500,000 RU, 200,000 MU, 50,000 EU, 10,000 VU
  maxWorkersPerManager: number;       // Default: 20
  maxTasksPerWorker: number;          // Default: 3
  maxRetries: number;                 // Default: 3
  validationThreshold: number;        // Default: 0.7
  validatorsPerResult: number;        // Default: 3
  llmMode: 'none' | 'live';          // Default: 'none' (simulation only)
  llmBaseURL?: string;                // Required when llmMode = 'live'
  persistEvents: boolean;             // Default: true
  clockSpeed: number;                 // Default: 10 (10x real-time in simulation)
}
```

### Security Considerations

Per threat model constitution:

- **Agent impersonation (S1)**: Workers cannot claim tasks in another agent's name. Blackboard claims include the claiming agent's signed identity.
- **Task tampering (T2)**: Workers can only submit results for tasks they own. The Blackboard enforces `owner_id` checks before accepting result submissions.
- **Resource exhaustion (D1)**: Per-worker budget limits (500 RU default) prevent any single worker from consuming disproportionate resources. The swarm total budget (500,000 RU default) caps aggregate consumption.
- **Botnet coordination (CA2)**: MissionControl's cross-agent correlation monitors for synchronized anomalous behavior. Coordinated resource consumption spikes trigger P0/P1 alerts.

---

## Consequences

### Positive

- **Clear authority hierarchy**: Every decision has a clear owner. Chiefs own goal completion. Managers own workstream delivery. Workers own task execution. Validators own quality assurance. No ambiguous ownership means no orphaned work.
- **Scalable decomposition**: Goals decompose into 1-5 workstreams based on budget. Managers further decompose workstreams into tasks. This two-level decomposition means a Chief with 5 Managers, each with 20 Workers, can coordinate 100 agents on a single goal without the Chief becoming a bottleneck.
- **Graceful degradation**: The 3-tier execution model means WorkerAgents can operate in simulation mode (no LLM, no capabilities), LLM mode (direct calls), or full capability mode (resolved providers). This allows testing and development without external dependencies while supporting production execution with real tools.
- **Automatic failure recovery**: Heartbeat-driven failure detection and task reassignment means the system self-heals when agents crash. Partial results are preserved for the next worker, reducing wasted work.
- **Observable system**: MissionControl provides a real-time snapshot of every dimension of swarm health. Operators can identify bottlenecks (low completion rate), resource pressure (high utilization), coordination issues (high task duplication), and quality problems (low validation accuracy) from a single dashboard.
- **Consensus quality gates**: Validation with configurable consensus strategies means critical work gets thorough review (unanimous), while routine work gets efficient review (majority). The chief-decides strategy prevents deadlocks when validators disagree.

### Negative

- **Hierarchy latency**: Goal decomposition flows through two levels (Chief -> Manager -> Worker). Each level adds communication overhead. For a simple goal that one agent could complete independently, the hierarchy adds latency with no benefit. Mitigation: Chiefs can assign small-budget goals as single workstreams with a single task, reducing overhead to near-zero.
- **Chief single point of failure**: If the ChiefAgent crashes, no new goals can be accepted and no workstream reassignments occur. Existing workers continue executing claimed tasks, but no new work is distributed. Mitigation: heartbeat-based failure detection (90 seconds) triggers Chief restart. The Blackboard preserves goal and workstream state, so a restarted Chief can resume without data loss.
- **Workstream budget fragmentation**: Budget is divided evenly across workstreams. If one workstream is more expensive than expected, it cannot borrow from another workstream's budget. This causes premature budget exhaustion in the expensive workstream while the cheaper workstream has unused budget. Mitigation: Chiefs can monitor workstream resource consumption via MissionControl and manually rebalance budgets by creating new workstreams with adjusted allocations.
- **Claim contention**: In a large swarm, many workers compete for the same `announced` tasks. The first-come-first-served protocol means only one worker succeeds per task; others waste time on rejected claims. High contention increases task duplication metrics and wastes agent cycles. Mitigation: the Blackboard's per-agent claim rate limit (10 claims/minute per blackboard protocol Article V) prevents spam claiming. Priority overrides allow Chiefs and Managers to direct high-value tasks to specific workers.
- **Validation bottleneck**: Every task result that falls below the 0.7 confidence threshold requires Validator review. With 3 validators per result and a default of 3 max concurrent tasks per validator, the system can validate approximately 5 results per second. If workers complete tasks faster than this, the validation queue grows. Mitigation: increase `validatorsPerResult` for lower-stakes work (or set to 1 for routine tasks). The auto-approve threshold (0.7) bypasses validation entirely for high-confidence results.
- **Simulation vs. production divergence**: Simulated execution produces deterministic but synthetic results. Agents tested in simulation may behave differently in production when using real LLM calls or capability providers. The 5% simulated failure rate does not match real-world failure patterns. Mitigation: the `llmMode = 'live'` option allows running the same swarm with real LLM calls for integration testing before production deployment.
- **Deadlock detection gap**: MissionControl reports deadlock counts, but the current implementation relies on the Blackboard's deadlock detection algorithm (per blackboard protocol Article IV: wait-for graph cycle detection every 30 seconds). If the Blackboard implementation does not expose deadlock events to MissionControl, the deadlock metric reads zero regardless of actual deadlocks. Mitigation: ensure Blackboard deadlock detection events are emitted as `MissionControlEvent` type `deadlock.detected` and `deadlock.resolved`.

### Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-------------|
| Chief crash during goal decomposition | Medium | High (goal stuck in `decomposing` state) | Blackboard timeout: goals in `decomposing` for >5 minutes auto-reset to `pending` for retry |
| Worker claim spam during high-contention periods | High | Medium (wasted agent cycles, high duplication metric) | Per-agent claim rate limit (10/min). Workers back off after N rejected claims. |
| Validation queue overflow | Medium | High (results stuck in `review` indefinitely) | Validation timeout (5 minutes): auto-approve if no validator responds. Add more ValidatorAgents dynamically. |
| Budget exhaustion before goal completion | Medium | High (work stops mid-goal) | MissionControl resource utilization alerts at >80%. Chiefs can allocate additional budget to workstreams. |
| Manager crash leaves workstream orphaned | Low | Medium (no task creation or monitoring) | Heartbeat detection (90s) promotes a Worker to Manager or assigns workstream to another Manager |
| Consensus deadlock (validators split evenly) | Low | Medium (task stuck in `review`) | Chief-decides strategy as fallback. Validation timeout auto-approves. |
| Simulated test passes but production fails | High | High (false confidence in system correctness) | Run live-mode integration tests before deployment. Test with real LLM calls. Monitor validation accuracy in production. |