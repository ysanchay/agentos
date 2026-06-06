# AgentOS Blackboard Protocol Constitution v1.0

**Status**: Ratified  
**Date**: 2026-06-06  
**Supersedes**: None (initial version)

---

## Preamble

The Blackboard is the coordination layer that prevents thousands of agents from duplicating work. Without it, 100 agents would all try the same task while nobody does the hard ones. The Blackboard is the single source of truth for what work exists, who is doing what, and what has been completed.

This document is structured as formal articles. Each article uses RFC 2119 keywords: SHALL (mandatory), SHOULD (recommended), MAY (optional).

---

## Article I: Blackboard Architecture

### 1.1 Structure

The Blackboard is a structured shared memory space divided into sections:

```typescript
interface Blackboard {
  id: string;
  workspace_id: WorkspaceID;
  sections: {
    goals: GoalSection;
    tasks: TaskSection;
    claims: ClaimSection;
    results: ResultSection;
    context: ContextSection;
    consensus: ConsensusSection;
    errors: ErrorSection;
  };
  created_at: ISO8601;
  updated_at: ISO8601;
}
```

### 1.2 Section Definitions

| Section | Purpose | Write Access | Read Access |
|---------|---------|-------------|-------------|
| **goals** | High-level objectives from users/Chiefs | Chiefs, Managers, Users | All workspace agents |
| **tasks** | Decomposed work items | Chiefs, Managers | All workspace agents |
| **claims** | Who is doing what | Agents claiming tasks | All workspace agents |
| **results** | Completed work outputs | Workers, Validators | All workspace agents |
| **context** | Shared knowledge/context | Any agent | All workspace agents |
| **consensus** | Agreed-upon decisions | Any agent (vote) | All workspace agents |
| **errors** | Failures and blockers | Any agent | Managers, Chiefs |

### 1.3 Read/Write Semantics

- Reads are non-blocking and eventually consistent (within 1 second)
- Writes are atomic — a section update either fully succeeds or fully fails
- Concurrent writes to the same entry are serialized (last-write-wins with history)
- All writes are logged to the audit trail

---

## Article II: Task Ownership Model

### 2.1 Task States on Blackboard

```
States: [announced, claimed, in_progress, blocked, review, completed, failed, cancelled]
```

### 2.2 Complete Transition Table

| From | To | Condition | Guard |
|------|----|-----------|-------|
| announced | claimed | Agent sends task.claim | Task matches agent capabilities. Agent not at max_tasks. Resources available. |
| announced | cancelled | Goal cancelled or task no longer needed | Cancel permission held by requester. |
| claimed | in_progress | Agent starts work | Must happen within CLAIM_TIMEOUT (60s). |
| claimed | announced | Agent releases claim | Voluntary or timeout. partial_result saved if exists. |
| in_progress | blocked | Agent encounters blocker | Blocker description required. Notify Manager. |
| in_progress | review | Agent submits result for validation | Result payload required. |
| in_progress | completed | Result auto-approved or Validator approved | No validation needed (simple tasks) or Validator approves. |
| in_progress | failed | Agent reports unrecoverable failure | Error message required. Retry count incremented. |
| blocked | in_progress | Blocker resolved | Agent confirms resumption. |
| blocked | failed | Blocker cannot be resolved | Deadline exceeded or no resolution path. |
| blocked | announced | Agent gives up | Task returns to pool. previous_owners updated. |
| review | completed | Validator approves | Quality threshold met. |
| review | failed | Validator rejects | Reason required. Retry if count allows. |
| failed | announced | retry_count < max_retries | Retry approved. Delay: exponential backoff. |
| completed | (terminal) | — | Result immutable. |
| failed | (terminal) | max_retries exhausted | Error details preserved. |
| cancelled | (terminal) | — | No retry. |

### 2.3 BlackboardTask Interface

```typescript
interface BlackboardTask {
  id: TaskID;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  
  // Ownership
  owner?: AgentID;
  owner_since?: ISO8601;
  previous_owners: {
    agent_id: AgentID;
    claimed_at: ISO8601;
    released_at: ISO8601;
    reason: string;
    partial_result?: unknown;
  }[];
  
  // Dependencies
  depends_on: TaskID[];
  blocks: TaskID[];
  
  // Resources
  resources_required: ResourceBudget;
  resources_allocated?: ResourceAllocation;
  
  // Results
  result?: TaskResult;
  error?: TaskError;
  
  // Retry
  retry_count: number;
  max_retries: number;
  
  // Timing
  deadline?: ISO8601;
  created_at: ISO8601;
  updated_at: ISO8601;
  completed_at?: ISO8601;
  
  tags: string[];
}
```

---

## Article III: Task Claiming Protocol

### 3.1 Claiming Rules

1. Tasks in `announced` state are available for claiming
2. An agent SHALL claim a task by sending `task.claim` via ACP
3. The claim is atomic: only one agent can successfully claim a task
4. Claims are processed in order of arrival (first-come, first-served)
5. Priority overrides: Chiefs and Managers can override a claim from a lower-priority agent

### 3.2 Claim Process (5 Steps)

```
Step 1: Agent reads blackboard, finds announced tasks matching its capabilities
Step 2: Agent sends task.claim(task_id, agent_id, capabilities, estimated_resources)
Step 3: Blackboard processes claim atomically:
  a. Verify task is in "announced" state
  b. Verify agent has required capabilities
  c. Verify resources are available
  d. If all checks pass: transition task to "claimed", set owner
  e. If any check fails: return claim.rejected with reason
Step 4: Agent receives claim.granted or claim.rejected
Step 5: If granted, agent MUST start work within CLAIM_TIMEOUT (60s)
  - If not started: claim auto-released, task returns to "announced"
```

### 3.3 Claim Conflicts

When two agents try to claim the same task simultaneously:
1. First claim to be processed wins (deterministic ordering by ACP message timestamp)
2. Second agent receives `claim.rejected` with reason "already_claimed"
3. Agent SHOULD then look for other available tasks
4. No automatic retry on claim rejection

### 3.4 Priority Override

- A Chief or Manager CAN override an existing claim from a lower-priority agent
- Override process: send `task.claim` with `override: true`
- Overridden agent receives `task.release` with reason "priority_override"
- Overridden agent's partial work is preserved in `previous_owners` for the new claimer

---

## Article IV: Task Locking

### 4.1 Lock Types

```typescript
type LockType = 
  | 'read'      // Shared lock: multiple readers allowed
  | 'write'     // Exclusive lock: only one writer, no readers
  | 'upgrade'   // Upgrade read lock to write lock
```

### 4.2 Lock Protocol

```
1. Agent sends lock.acquire(resource_id, lock_type, timeout_ms)
2. Blackboard grants lock if compatible with existing locks:
   - Read lock: granted if NO write locks exist on the resource
   - Write lock: granted if NO locks exist on the resource
   - Upgrade: granted if this agent holds the only read lock
3. If lock cannot be granted immediately:
   - Wait up to timeout_ms for lock to become available
   - If timeout expires: return lock.timeout error
4. Agent MUST release lock explicitly via lock.release
5. Locks auto-release after MAX_LOCK_DURATION (default: 5 minutes)
6. Deadlock detection runs every 30 seconds
```

### 4.3 Deadlock Detection

```
Algorithm:
1. Maintain a wait-for graph: { agent → resource → waiting_agent }
2. Detect cycles: if a cycle exists, there's a deadlock
3. Resolution: abort the lock held by the agent with:
   a. Lowest priority (IDLE > LOW > NORMAL > HIGH > CRITICAL)
   b. If same priority: youngest lock (most recently acquired)
4. Aborted agent receives lock.deadlock error
5. Prevention: agents MUST acquire locks in resource-ID order (ascending)
6. Lock ordering violation is logged as a warning
```

---

## Article V: Conflict Resolution

### 5.1 Strategies

```typescript
type ConflictStrategy = 
  | 'first-wins'      // First result submitted is accepted; second logged as alternative
  | 'vote'            // Multiple validators vote; majority wins (>50%)
  | 'chief-decides'   // Chief agent picks the best result
  | 'merge'           // Results are merged if possible (e.g., both found different bugs)
```

### 5.2 Resolution Process

```
1. Task has multiple results submitted for same work
2. If task type allows merge: merge results, done
3. If not mergeable: apply resolution strategy (defined at task creation)
4. Losing agent(s) are notified with explanation
5. Resolution is logged in consensus section
6. Both results are preserved in audit trail (never deleted)
```

---

## Article VI: Result Publishing

### 6.1 TaskResult Interface

```typescript
interface TaskResult {
  task_id: TaskID;
  agent_id: AgentID;
  output: unknown;
  confidence: number;          // 0.0 - 1.0
  resources_consumed: ResourceConsumption;
  artifacts: ArtifactRef[];
  duration_ms: number;
  completed_at: ISO8601;
}

interface ArtifactRef {
  type: 'memory' | 'file' | 'database' | 'api';
  uri: string;
  checksum: string;           // SHA-256 for integrity
}
```

### 6.2 Validation Pipeline

```
1. Worker submits result to results section
2. If task requires validation (validation_required: true):
   a. Assign to available Validator agent
   b. Validator reviews: approve, reject (with reason), or request revision
   c. Approved → task transitions to "completed"
   d. Rejected → task transitions to "failed" (with retry option)
   e. Revision requested → Worker gets chance to improve and resubmit
3. If task doesn't require validation:
   a. Auto-approve if confidence > 0.7
   b. Otherwise, assign Validator for review
```

---

## Article VII: Shared Context Section

### 7.1 Context Model

```typescript
interface SharedContext {
  key: string;                // e.g., "api.auth_token", "project.deadline"
  value: unknown;
  source_agent: AgentID;
  confidence: number;         // 0.0 - 1.0
  scope: 'task' | 'workspace' | 'project';
  expires_at?: ISO8601;
  tags: string[];
  updated_at: ISO8601;
  version: number;
}
```

### 7.2 Scoping Rules

- **task**: Only visible to agents working on that specific task
- **workspace**: Visible to all agents in the workspace
- **project**: Visible to all agents across all workspaces in the project

### 7.3 Write Semantics

- Any agent can write to the context section
- Same key overwrites: last-write-wins, but previous values retained in history
- Context has TTL: stale context (past expires_at) is automatically removed
- Context writes are logged to audit trail

---

## Article VIII: Consensus Records

### 8.1 Consensus Interface

```typescript
interface ConsensusRecord {
  id: string;
  topic: string;
  proposer: AgentID;
  options: { label: string; description: string }[];
  votes: { agent_id: AgentID; option: string; timestamp: ISO8601 }[];
  strategy: ConsensusStrategy;
  status: 'voting' | 'resolved' | 'expired';
  result?: string;            // Winning option label
  deadline: ISO8601;
  created_at: ISO8601;
}

type ConsensusStrategy = 
  | 'unanimous'      // All must agree (100%)
  | 'majority'       // >50% wins
  | 'supermajority'  // >67% wins
  | 'chief-decides'  // Chief has final say after discussion
  | 'weighted'       // Votes weighted by agent reputation score
```

### 8.2 Voting Protocol

```
1. Chief or Manager creates consensus record with topic and options
2. Relevant agents are notified via ACP event
3. Agents vote by writing to the consensus section
4. Voting closes at deadline OR when all eligible agents have voted
5. Result is determined by strategy
6. All agents notified of result via ACP event
7. Dissenting agents MUST abide by consensus (within the system)
8. Consensus records are immutable after resolution
```

---

## Article IX: Retry and Failure Recovery

### 9.1 Retry Policy

```typescript
interface RetryPolicy {
  max_retries: number;        // Default: 3
  backoff: 'fixed' | 'linear' | 'exponential';
  initial_delay_ms: number;   // Default: 1000
  max_delay_ms: number;       // Default: 30000
  jitter: boolean;            // Add random jitter to prevent thundering herd
  retry_on: string[];         // Which error types trigger retry
}
```

### 9.2 Failure Scenarios and Recovery

| # | Scenario | Detection | Recovery Action |
|---|----------|-----------|-----------------|
| 1 | Agent crashes while claiming | Claim timeout (60s) | Task auto-released to pool |
| 2 | Agent crashes during execution | Heartbeat timeout (90s) | Task returns to "announced". Partial results saved in context section. |
| 3 | Agent submits wrong result | Validator rejection | Task → "failed". Retry if count allows. Different agent assigned. |
| 4 | Agent exceeds resource budget | Kernel enforcement | Agent force-terminated. Task returns to "announced". |
| 5 | Task dependencies fail | Dependency state change | Dependent tasks marked "blocked". Chief notified. May cancel or re-route. |
| 6 | All agents reject a task | No claims for DEADLINE | Task escalated to Chief for re-scoping or cancellation. |
| 7 | Blackboard partition (network split) | Connection loss | Each partition operates independently. Merge on reconnect. |
| 8 | Result conflicts after partition merge | Multiple results for same task | Both preserved. Validator or Chief resolves. |

### 9.3 Task Re-assignment on Agent Failure

```
1. Agent heartbeat timeout detected by Kernel
2. All tasks owned by failed agent identified
3. Tasks in "claimed" or "in_progress" transition back to "announced"
4. Partial results saved to context section for next agent
5. Next agent picks up task and sees partial work
6. previous_owners array tracks full history for debugging
7. Agent failure count incremented; persistent failures trigger agent review
```

---

## Article X: Resource Coordination

### 10.1 Resource Budget at Task Level

- Each task declares `resources_required` at creation
- Blackboard verifies resources are available before allowing claim
- If resources insufficient, task stays "announced" until resources free up
- Resource allocation is tied to task lifecycle: allocated on claim, released on completion/failure

### 10.2 Contention Handling

When multiple tasks compete for limited resources:
1. Priority-based: higher-priority tasks get resources first
2. Fair share: same-priority tasks share equally
3. Deadlock: tasks that block each other's resources are detected and resolved

---

## Article XI: Dependency Graph Management

### 11.1 Rules

1. Task dependencies MUST form a DAG (no cycles)
2. A task cannot be claimed until all `depends_on` tasks are `completed`
3. When a task completes, all tasks in its `blocks` list are checked for unblocking
4. Circular dependencies are rejected at task creation time (topological sort validation)
5. If a dependency fails, all dependent tasks are notified and marked "blocked"

---

## Article XII: Work Decomposition

### 12.1 Decomposition Protocol

```
1. Chief receives goal (from user or parent task)
2. Chief decomposes goal into 3-7 objectives
3. Each objective becomes a task with parent_task_id = goal.id
4. Objectives assigned to Managers or Specialists
5. Managers further decompose into steps
6. Steps become tasks with parent_task_id = objective.id
7. Workers claim and execute steps
8. Results roll up: step → objective → goal
```

### 12.2 Rollup

- When all child tasks complete, parent task auto-transitions to "review"
- Parent result = aggregation of child results (strategy defined at creation)
- If any child fails, parent is marked "blocked" (not auto-failed)

---

## Article XIII: Agent Heartbeat and Liveness

- Agents MUST send heartbeat every 30 seconds via ACP
- Blackboard tracks last heartbeat per agent
- 1 missed heartbeat (30-60s): SUSPECT — log warning
- 2 missed heartbeats (60-90s): DEGRADED — prepare for reassignment
- 3 missed heartbeats (90s+): FAILED — reassign tasks, attempt recovery
- Recovery: if agent resumes within 5 minutes, tasks are restored
- If no recovery in 5 minutes: agent force-terminated, tasks permanently reassigned

---

## Article XIV: Partition Tolerance

### 14.1 During Network Split

1. Each partition operates its own blackboard independently
2. Tasks in one partition are not visible to agents in another
3. Claims are local to each partition
4. Consensus decisions are local to each partition

### 14.2 Merge Protocol (5 Steps)

```
1. Connection restored between partitions
2. Synchronize timestamps: identify all changes since split
3. Merge tasks: last-write-wins for state, but ALL results preserved
4. Merge claims: if both partitions claimed same task, first-timestamp wins
5. Merge consensus: if both made decisions, both recorded; Chief resolves
6. Notify all agents of merge results
7. Full audit log of merge decisions
```

---

## Article XV: Access Control

- Section-level read: all workspace members can read goals, tasks, claims, results
- Section-level write: governed by agent role and permission
- Error section: only Managers and Chiefs can read (sensitive failure data)
- Audit section: only Admin agents can read
- Context writes: any agent can write; scoped writes enforced

---

## Article XVI: Event Notification

- Agents subscribe to event types via `event.subscribe`
- Delivery guarantee: at-least-once (duplicates possible, agents MUST be idempotent)
- Backpressure: if subscriber's queue is full, oldest events are dropped (with notification)
- Events are ordered per-source by timestamp

---

## Article XVII: Audit Trail

- Every blackboard write creates an audit entry
- Audit entries are append-only and immutable
- Each entry includes: timestamp, agent_id, action, target, previous_value, new_value
- Entries form a hash chain: each entry includes SHA-256 of previous entry
- Audit trail is preserved permanently (no deletion, even for archived workspaces)

---

## Article XVIII: Performance Constraints

| Metric | Target | Maximum |
|--------|--------|---------|
| Claim latency | <100ms | 500ms |
| Read latency | <50ms | 200ms |
| Write latency | <100ms | 500ms |
| Events per second | 10,000 | 50,000 |
| Concurrent agents | 1,000 | 10,000 |
| Active tasks | 10,000 | 100,000 |
| Context entries | 100,000 | 1,000,000 |

---

## Appendix A: Error Codes

| Code | Description |
|------|-------------|
| BB-E001 | Task not found |
| BB-E002 | Task not in claimable state |
| BB-E003 | Agent lacks required capabilities |
| BB-E004 | Resources unavailable |
| BB-E005 | Claim conflict (already claimed) |
| BB-E006 | Lock unavailable |
| BB-E007 | Lock timeout |
| BB-E008 | Deadlock detected |
| BB-E009 | Dependency not satisfied |
| BB-E010 | Circular dependency |
| BB-E011 | Permission denied |
| BB-E012 | Validation failed |
| BB-E013 | Max retries exceeded |
| BB-E014 | Partition detected |
| BB-E015 | Merge conflict |

---

*This constitution defines how thousands of agents coordinate without duplication. The Blackboard is the shared consciousness of the workforce — if it is wrong, agents duplicate work or leave tasks orphaned. Every claim, every lock, every consensus decision traces back to these specifications.*

**Ratified**: 2026-06-06  
**Signatories**: Chief Architect, AI Architect, Backend Architect