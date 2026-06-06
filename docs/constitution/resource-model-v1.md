# AgentOS Resource Model Constitution v1.0

**Status**: Ratified  
**Date**: 2026-06-06  
**Supersedes**: None (initial version)  
**Amendment Process**: Changes require 2/3 architect approval; amendments MUST preserve all existing invariants and conservation laws.

---

## 1. Preamble

This document is **normative law** for the AgentOS resource management system. It defines the four fundamental resource types, their allocation, scheduling, quotas, fairness guarantees, and enforcement mechanisms. Every scheduler, every budget, every throttle, every quota in AgentOS MUST trace its authority back to this constitution.

Resource management is not an afterthought — it is the economic foundation on which the entire operating system runs. Without clear resource accounting, agents will consume without bound, privileged agents will starve others, and the system will collapse under load. This constitution prevents that.

**Key terms**: MUST = mandatory, SHOULD = recommended, MAY = optional (RFC 2119).

---

## 2. The Four Fundamental Resource Types

### 2.1 Reasoning Units (RU)

**Definition**: 1 RU ≈ 1,000 output tokens from a standard LLM model (GPT-4-class), or ≈ 10,000 tokens of prompt processing.

**Rationale**: LLM inference is the dominant cost driver in agent systems. It cannot be reduced to CPU time or RAM — it is a fundamentally different resource with different scaling characteristics. RU accounting ensures agents cannot consume unlimited inference without budgetary consequences.

**Properties**:
- Consumed at point of inference request
- Non-transferable between agents
- Burstable within quota limits (see Section 7)
- Accounted per inference call, not per token (batching is encouraged)

**Calibration**: As models evolve, RU equivalences will drift. The Kernel maintains a calibration table mapping model versions to RU costs. Calibration updates require architect approval.

### 2.2 Memory Units (MU)

**Definition**: 1 MU ≈ 1 MB of persistent memory stored for 1 hour, OR ≈ 10 vector similarity searches against 1M-vector index, OR ≈ 100 graph traversal operations.

**Rationale**: Memory operations have a distinct cost profile — storage is ongoing, retrieval is bursty, and vector similarity is compute-intensive. Separate accounting prevents agents from hoarding memory or flooding vector indexes.

**Properties**:
- Dual accounting: storage (ongoing) and retrieval (per-operation)
- Storage MU accrues over time (1 MB × 1 hour = 1 MU)
- Retrieval MU is consumed per operation
- Tiered pricing: L0 > L1 > L2 > L3 (hot memory costs more)

### 2.3 Execution Units (EU)

**Definition**: 1 EU ≈ 1 standard tool call (file read, API request, database query), OR ≈ 10 seconds of sandboxed code execution, OR ≈ 1 browser automation action (click, type, scroll).

**Rationale**: Deterministic compute — tool calls, code execution, browser automation — is distinct from inference and memory. Separate accounting enables fair scheduling and prevents agents from monopolizing tool access.

**Properties**:
- Consumed at point of execution
- Tool calls are weighted: simple reads cost 1 EU, complex API calls cost 2-5 EU, code execution costs 1 EU per 10 seconds
- Browser actions cost 1 EU each (clicks, types, scrolls) or 5 EU per page navigation
- Batched operations get a 20% discount (3 calls batched = 2.4 EU instead of 3 EU)

### 2.4 Vision Units (VU)

**Definition**: 1 VU ≈ 1 image analysis (describe, OCR, detect objects), OR ≈ 10 seconds of video processing, OR ≈ 1 screen capture analysis.

**Rationale**: Multimodal perception is a distinct resource with its own cost profile. Image analysis requires GPU inference; video processing requires sustained compute. Separate accounting prevents agents from consuming unlimited vision resources.

**Properties**:
- Image analysis: 1 VU per image (regardless of resolution)
- Video processing: 1 VU per 10 seconds (regardless of resolution)
- Screen capture: 1 VU per capture
- Batched image analysis: 5 images = 4 VU (20% discount)

---

## 3. Resource Allocation Model

### 3.1 Resource Request

```typescript
interface ResourceRequest {
  requester: AgentID;
  task_id?: TaskID;
  workspace_id: WorkspaceID;
  
  ru: number;           // Requested RUs (must be > 0)
  mu: number;           // Requested MUs (must be > 0)
  eu: number;            // Requested EUs (must be > 0)
  vu: number;            // Requested VUs (must be >= 0, default 0)
  
  priority: Priority;    // 0=SYSTEM through 5=IDLE
  duration_ms: number;  // Expected duration of usage
  deadline?: ISO8601;    // When resources must be available by
  preemptible: boolean; // Can this allocation be preempted?
  
  // Justification
  reason: string;       // Why the resources are needed
  idempotency_key?: string; // Deduplication key
}
```

### 3.2 Resource Allocation

```typescript
interface ResourceAllocation {
  id: AllocationID;
  agent_id: AgentID;
  task_id?: TaskID;
  workspace_id: WorkspaceID;
  state: AllocationState;
  
  // Allocated amounts
  ru_allocated: number;
  mu_allocated: number;
  eu_allocated: number;
  vu_allocated: number;
  
  // Consumption tracking
  ru_consumed: number;
  mu_consumed: number;
  eu_consumed: number;
  vu_consumed: number;
  
  // Priority and preemption
  priority: Priority;
  preemptible: boolean;
  
  // Timing
  granted_at?: ISO8601;
  expires_at?: ISO8601;
  released_at?: ISO8601;
  
  created_at: ISO8601;
  updated_at: ISO8601;
}

enum AllocationState {
  PENDING = 'pending',       // Awaiting available resources
  GRANTED = 'granted',       // Resources reserved, not yet active
  ACTIVE = 'active',          // Resources being consumed
  THROTTLED = 'throttled',    // Partially reduced due to contention
  PREEMPTED = 'preempted',    // Taken away for higher-priority
  RELEASED = 'released',      // Voluntarily released by agent
  EXPIRED = 'expired',        // Allocation time exceeded
  REVOKED = 'revoked',        // Forcefully revoked by kernel/admin
}
```

### 3.3 Allocation State Transitions

```
PENDING → GRANTED : Resources available, allocation approved
PENDING → REVOKED : Request denied (quota exceeded, no permission)
GRANTED → ACTIVE : Agent starts using resources (within GRACE_PERIOD)
GRANTED → EXPIRED : Agent didn't start within GRACE_PERIOD
ACTIVE → THROTTLED : Contention detected, capacity reduced
ACTIVE → PREEMPTED : Higher-priority allocation needs resources
ACTIVE → RELEASED : Agent voluntarily releases resources
ACTIVE → EXPIRED : Allocation time limit reached
ACTIVE → REVOKED : Kernel/admin forcefully revokes (security, budget)
THROTTLED → ACTIVE : Contention resolved, full capacity restored
THROTTLED → PREEMPTED : Contention persists + higher priority needs resources
THROTTLED → RELEASED : Agent gives up while throttled
PREEMPTED → PENDING : Resources rescheduled at same priority
RELEASED → (terminal) : Resources returned to pool
EXPIRED → (terminal) : Time limit reached
REVOKED → (terminal) : Forceful termination
```

### 3.4 Conservation Invariants

These invariants MUST hold at all times:

1. **RU Conservation**: `sum(ru_consumed across all allocations) <= total_ru_available`
2. **MU Conservation**: `sum(mu_consumed across all allocations) <= total_mu_available`
3. **EU Conservation**: `sum(eu_consumed across all allocations) <= total_eu_available`
4. **VU Conservation**: `sum(vu_consumed across all allocations) <= total_vu_available`
5. **Per-Agent Conservation**: `consumed <= allocated` for every resource type, for every agent
6. **Non-Negative**: All resource counts MUST be >= 0 at all times
7. **No Double-Counting**: A resource unit allocated to one agent CANNOT be simultaneously allocated to another

---

## 4. Priority-Based Scheduling

### 4.1 Priority Levels

| Level | Name | Numeric | Use Case | Preemption Rights |
|-------|------|---------|----------|-------------------|
| SYSTEM | 0 | Kernel operations, recovery, monitoring | Cannot be preempted |
| CRITICAL | 1 | Deadline-driven tasks, user interactions | Can preempt LOW and IDLE |
| HIGH | 2 | Important tasks, Chief/Manager operations | Can preempt IDLE |
| NORMAL | 3 | Default agent work | No preemption rights |
| LOW | 4 | Background analysis, preparation | No preemption rights |
| IDLE | 5 | Only runs when no other work exists | No preemption rights |

### 4.2 Scheduling Rules

1. Higher priority allocations are served before lower priority
2. Same-priority allocations are served FIFO (first-in, first-out)
3. SYSTEM priority allocations CANNOT be preempted under any circumstances
4. CRITICAL allocations can preempt LOW and IDLE allocations
5. HIGH allocations can preempt IDLE allocations only
6. NORMAL allocations cannot preempt any other allocation
7. An allocation that has been active for less than `MIN_RUNTIME_MS` (default: 30,000ms = 30s) CANNOT be preempted
8. An allocation that is performing a critical section (file write, database commit) CANNOT be preempted until the critical section completes

### 4.3 Preemption Protocol

```
1. Scheduler identifies lower-priority allocation to preempt
2. Send resource.preempt message to the agent
3. Agent has GRACE_PERIOD_MS (default: 10,000ms = 10s) to:
   a. Checkpoint current work
   b. Save partial results to memory
   c. Release non-critical resources
4. After GRACE_PERIOD_MS, if resources not released:
   a. Resources are force-revoked (state → REVOKED)
   b. Agent tasks are re-queued at same priority
   c. Preemption event logged
5. Preempted task is rescheduled at same priority level
6. Agent's preemption count is tracked:
   a. After 3 preemptions in 24 hours: scheduling penalty (priority reduced by 1 for 1 hour)
   b. After 5 preemptions in 24 hours: agent flagged for review
```

---

## 5. Throttling

When resources are oversubscribed but preemption is not appropriate, the Kernel applies throttling.

### 5.1 Throttle Triggers

| Trigger | Threshold | Action |
|---------|-----------|--------|
| Agent exceeds per-minute quota | 100% of minute allocation | Rate throttle |
| Workspace exceeds hourly quota | 90% of hour allocation | Budget throttle |
| System reaches 80% capacity | 80% of total available | Queue throttle |
| Agent exceeds burst allowance | 120% of steady-state rate | Rate throttle |

### 5.2 Throttle Levels

| Level | Rate Reduction | Duration | Recovery |
|-------|---------------|----------|----------|
| Mild | 50% reduction | 5 minutes | Automatic after duration |
| Moderate | 75% reduction | 15 minutes | Automatic after duration |
| Severe | 90% reduction | 1 hour | Automatic after duration |
| Critical | 95% reduction | Until admin review | Manual intervention |

### 5.3 Throttle Application Rules

1. **Rate Throttling**: Reduce the rate at which an agent can consume resources
   - Applied proportionally: all agents at same priority share available capacity equally
   - Example: Agent consuming 100 RU/s throttled to 50 RU/s

2. **Budget Throttling**: Reduce the remaining budget for an allocation
   - Applied to lowest-priority allocations first
   - Example: Agent has 1000 RU budget, reduced to 500 RU

3. **Queue Throttling**: Increase the wait time before new allocations are granted
   - Applied proportionally to priority level (lower priority waits longer)
   - Example: NORMAL priority allocation waits 5s instead of 0s

### 5.4 Circuit Breaker Exception

If an agent's throttle was triggered by infrastructure failure (not abuse), a circuit breaker pauses escalation:
- If the infrastructure component was down for >5 minutes, reset throttle levels
- If 3 consecutive legitimate failures trigger throttle, invoke circuit breaker
- Circuit breaker: throttle escalation is paused for 10 minutes
- After circuit breaker: resume normal throttle behavior

---

## 6. Quota System

### 6.1 Per-Agent Quotas

```typescript
interface AgentQuota {
  agent_id: AgentID;
  
  // Per-hour consumption limits
  ru_per_hour: number;         // Max RU consumption per hour
  mu_max: number;              // Max MU storage at any time
  eu_per_hour: number;         // Max EU consumption per hour
  vu_per_hour: number;         // Max VU consumption per hour
  
  // Lifetime budgets
  total_ru_budget: number;    // Total RU for agent's lifetime (-1 = unlimited)
  total_eu_budget: number;    // Total EU for agent's lifetime (-1 = unlimited)
  
  // Rate limits
  max_rpm: number;             // Max requests (messages) per minute
  max_concurrent_tasks: number; // Max simultaneous tasks
  
  // Burst allowance
  burst_ru_per_minute: number; // Max RU in any 1-minute window
  burst_eu_per_minute: number; // Max EU in any 1-minute window
}
```

### 6.2 Per-Workspace Quotas

```typescript
interface WorkspaceQuota {
  workspace_id: WorkspaceID;
  
  // Capacity limits
  max_agents: number;          // Max concurrent agents
  max_tasks: number;           // Max total tasks (active + pending)
  max_memory_entries: number;  // Max memory entries
  
  // Per-hour consumption limits
  total_ru_per_hour: number;  // Max total RU per hour across all agents
  total_mu: number;            // Max total MU storage
  total_eu_per_hour: number;  // Max total EU per hour across all agents
  total_vu_per_hour: number;  // Max total VU per hour across all agents
  
  // Priority ceiling
  max_priority: Priority;      // Highest priority agents can use (default: HIGH)
  
  // Budgets
  monthly_ru_budget: number;   // Total RU per month (-1 = unlimited)
  monthly_eu_budget: number;  // Total EU per month (-1 = unlimited)
}
```

### 6.3 Per-User Quotas

```typescript
interface UserQuota {
  user_id: UserID;
  
  // Workspace limits
  total_workspaces: number;    // Max workspaces user can create
  
  // Agent limits
  total_agents_all_workspaces: number; // Max agents across all workspaces
  
  // Daily consumption limits
  total_ru_per_day: number;   // Total RU across all workspaces per day
  total_eu_per_day: number;    // Total EU across all workspaces per day
  
  // Billing
  billing_limit: number;       // Monthly billing cap in credits (-1 = unlimited)
  billing_alert_threshold: number; // Alert when this % of budget consumed (default: 80)
}
```

### 6.4 Enterprise Quotas

```typescript
interface EnterpriseQuota {
  org_id: OrgID;
  
  // Scale limits
  total_users: number;
  total_workspaces: number;
  
  // Monthly consumption limits
  total_ru_per_month: number;
  total_mu: number;             // Total persistent memory
  total_eu_per_month: number;
  total_vu_per_month: number;
  
  // SLA tier
  sla_tier: 'standard' | 'premium' | 'enterprise';
  
  // Dedicated resources
  dedicated_resources: boolean; // True = guaranteed capacity, not shared
  
  // Support
  max_priority: Priority;       // Highest priority level available
  support_response_sla: number;  // Hours for support response
}
```

### 6.5 Quota Enforcement Rules

1. Allocation requests that would exceed any quota MUST be rejected with `KER-0008` or `KER-0009`
2. Quotas are checked in order: Agent → Workspace → User → Enterprise
3. If a request passes Agent quota but fails Workspace quota, the request is denied
4. Quota consumption is tracked in real-time (not batch-updated)
5. Quota resets: per-hour quotas reset at the top of the hour; per-day quotas reset at midnight UTC; per-month quotas reset on the 1st of the month

---

## 7. Fairness Guarantees

### 7.1 No Starvation

Every pending allocation with priority NORMAL or higher will eventually be served:
- **Maximum wait time by priority**:
  - CRITICAL: 10 seconds
  - HIGH: 1 minute
  - NORMAL: 5 minutes
- If wait time is exceeded, allocation priority is auto-upgraded by one level
- After upgrade, the new maximum wait time applies
- An allocation can be upgraded at most twice (NORMAL → HIGH → CRITICAL)

### 7.2 Fair Share

When multiple agents at the same priority level compete for the same resource:
- Available capacity is divided equally among agents at that priority level
- An agent consuming more than its fair share is throttled down
- An agent consuming less than its fair share is given more capacity
- Fair share is recalculated every 30 seconds

### 7.3 Burst Allowance

Agents can temporarily exceed their per-hour quota:
- **Burst budget**: 20% of hourly quota can be consumed in any 1-minute window
- **Burst tracking**: Token-bucket algorithm with 1-minute refill rate
- **After burst is consumed**: Agent is throttled to steady-state rate
- **Burst does not apply to**: SYSTEM priority agents, critical sections, or budget-exhausted agents

### 7.4 Priority Inversion Prevention

When a LOW-priority agent holds resources needed by a CRITICAL agent:
1. LOW-priority agent is temporarily promoted to CRITICAL for up to 30 seconds
2. During promotion, the agent MUST complete its critical section and release resources
3. If the agent does not release within 30 seconds, resources are force-revoked
4. Temporary promotion is logged for audit purposes
5. An agent can be temporarily promoted at most 3 times per hour

---

## 8. Budget Enforcement

### 8.1 Hard Budget (Lifetime Budgets)

When a lifetime budget (total_ru_budget or total_eu_budget) is exhausted:

| Threshold | Action |
|-----------|--------|
| 80% consumed | Send `resource.warning` notification |
| 95% consumed | Send critical notification, suggest task completion |
| 100% consumed | Graceful termination: agent gets 10s to checkpoint |
| 100% + 30s | Force termination: resources revoked, tasks reassigned |

### 8.2 Soft Budget (Hourly Quotas)

When an hourly quota is exceeded:

| Offense | Action | Duration |
|---------|--------|----------|
| First | Throttle to 50% rate | 5 minutes |
| Second | Throttle to 25% rate | 15 minutes |
| Third | Throttle to 10% rate | 1 hour |
| Persistent (5+) | Suspend agent until admin review | Until admin |

### 8.3 Budget Top-Up

- Users/admins can increase budgets at any time via Kernel API
- Top-up takes effect immediately (no delay)
- Top-up does NOT reset throttle timers (throttle must run its course)
- Top-up is logged in the audit trail

---

## 9. Resource Monitoring

### 9.1 Real-Time Metrics

The Kernel MUST expose real-time resource metrics:

| Metric | Scope | Granularity |
|--------|-------|------------|
| RU consumed | Per agent, per workspace | 1-second |
| MU stored | Per agent, per workspace | 1-second |
| EU consumed | Per agent, per workspace | 1-second |
| VU consumed | Per agent, per workspace | 1-second |
| Allocation queue depth | Per priority level | 1-second |
| Throttle events | Per agent | 1-second |
| Preemption events | Per agent | Real-time |

### 9.2 Predictive Alerts

| Alert | Condition | Threshold | Notification |
|-------|-----------|-----------|-------------|
| Budget warning | Projected exhaustion | 80% consumed | `resource.warning` message |
| Budget critical | Near-exhaustion | 95% consumed | `resource.warning` + escalation |
| Quota exceedance | Per-hour quota >90% | 90% consumed | `resource.warning` + throttle prep |
| Anomaly | Sudden 5x spike in consumption | 5x baseline | Security review + `security.alert` |

### 9.3 Efficiency Scoring

```typescript
interface EfficiencyScore {
  agent_id: AgentID;
  period: '1h' | '24h' | '7d';
  
  ru_per_task_completed: number;    // RU efficiency
  eu_per_tool_call: number;          // EU efficiency
  task_completion_rate: number;       // 0-1, tasks completed / tasks started
  resource_utilization: number;       // 0-1, consumed / allocated
  overall_score: number;              // Weighted average of above
}
```

### 9.4 Anomaly Detection

- Sudden spike (>5x baseline) in any resource type triggers security review
- Sustained high utilization (>90% for 1 hour) triggers optimization suggestion
- Repeated preemptions (>3 in 24 hours) triggers agent review
- Budget exhaustion rate >2x projected triggers forecasting alert

### 9.5 Cost Attribution

Every resource unit is attributed through the chain:
```
RU → Agent → Task → Workspace → Project → User → Organization
```
This enables per-task, per-workspace, per-project, per-user, and per-organization cost reporting.

---

## 10. Compute Tiers

| Tier | RU/hr | MU Max | EU/hr | VU/hr | Max Agents | Max Tasks | Use Case |
|------|-------|--------|-------|-------|------------|-----------|----------|
| **Nano** | 100 | 50 MB | 200 | 10 | 3 | 10 | Single agent, simple tasks |
| **Micro** | 1,000 | 500 MB | 2,000 | 100 | 10 | 50 | Small team, standard work |
| **Standard** | 10,000 | 5 GB | 20,000 | 1,000 | 50 | 200 | Full workspace, complex work |
| **Pro** | 100,000 | 50 GB | 200,000 | 10,000 | 200 | 1,000 | Multi-workspace, heavy compute |
| **Enterprise** | 1,000,000 | 500 GB | 2,000,000 | 100,000 | Unlimited | Unlimited | Organization-wide |

---

## 11. Normative Statements

### MUST (Mandatory)
1. Every resource allocation MUST be tracked in real-time
2. Every resource allocation MUST be attributable (agent → task → workspace → project → user → org)
3. Hard budgets MUST be enforced (no agent can exceed lifetime budget)
4. Starvation prevention MUST be implemented (maximum wait times per priority)
5. Preemption protocol MUST include a grace period (minimum 10 seconds)
6. Quota enforcement MUST check all four levels (agent → workspace → user → enterprise)
7. Audit trail MUST record every allocation, throttle, preemption, and budget event

### SHOULD (Recommended)
1. Fair-share scheduling SHOULD be implemented for same-priority agents
2. Burst allowance SHOULD be implemented via token-bucket algorithm
3. Priority inversion prevention SHOULD be implemented with temporary promotion
4. Predictive alerts SHOULD be sent when consumption exceeds 80% of budget
5. Efficiency scoring SHOULD be calculated hourly and daily

### MAY (Optional)
1. Dedicated resource pools MAY be provisioned for enterprise customers
2. Spot pricing MAY be implemented for idle resources
3. Cross-workspace resource sharing MAY be enabled with explicit permission

---

## 12. Appendix

### A. TypeScript Type Reference

All TypeScript interfaces defined in this document are normative. Implementations MUST use these interfaces exactly as specified, including all fields and all types. Optional fields (marked with `?`) MAY be omitted; all other fields MUST be present.

### B. Glossary

| Term | Definition |
|------|-----------|
| RU | Reasoning Unit — LLM inference compute |
| MU | Memory Unit — Storage and retrieval operations |
| EU | Execution Unit — Code execution and tool calls |
| VU | Vision Unit — Image and video processing |
| Quota | Maximum resource consumption allowed per time period |
| Budget | Total lifetime resource allocation |
| Throttle | Reduction in resource consumption rate |
| Preemption | Forced resource release for higher-priority work |
| Fair share | Equal distribution of resources among same-priority agents |
| Burst | Temporary exceeding of steady-state rate |
| Allocation | Resource units assigned to an agent |
| Conservation | Principle that resources are neither created nor destroyed |

### C. Calibration Notes

The RU equivalences defined in Section 2 (1 RU ≈ 1,000 output tokens) are normative reference points, not hard constants. As models evolve:

1. The Kernel maintains a calibration table: `{ model_version: ru_per_1k_output_tokens }`
2. Calibration updates require 2/3 architect approval
3. Calibration changes MUST NOT reduce existing agent budgets retroactively
4. Agents MUST use the calibration table in effect at the time of their allocation request
5. Calibration changes are logged in the audit trail with justification

---

*This constitution defines the economic foundation of AgentOS. If resource accounting is wrong, the system fails under load. If fairness is wrong, agents starve. If budgets are wrong, costs spiral. Every scheduler, every quota, every throttle traces back to these specifications.*

**Ratified**: 2026-06-06  
**Signatories**: Chief Architect, Resource Architect, SRE