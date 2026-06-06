# AgentOS Kernel API Constitution v1.0

**Status**: Ratified  
**Date**: 2026-06-06  
**Supersedes**: None (initial version)  
**Amendment Process**: Changes require 2/3 architect approval and must preserve all existing invariants

---

## 1. Preamble

This document is the **immutable constitution** of the AgentOS Kernel. It defines every core object, every lifecycle, every API endpoint, and every invariant that the system MUST enforce. No implementation may violate any specification in this document. Where this document says MUST, the behavior is mandatory. Where it says SHOULD, the behavior is recommended unless a documented exception exists.

The Kernel is the **root of trust** in AgentOS. It manages agent lifecycles, schedules tasks, enforces permissions, allocates resources, and publishes events. The Kernel contains **no AI logic** — it is a deterministic coordinator that ensures safety, fairness, and correctness.

---

## 2. Primitive Types

### 2.1 Identifiers

```typescript
type UUID = string;              // UUID v7 (time-ordered, sortable)
type AgentID = UUID;
type TaskID = UUID;
type WorkspaceID = UUID;
type ProjectID = UUID;
type CapabilityID = UUID;
type PermissionID = UUID;
type MemoryID = UUID;
type AllocationID = UUID;
type EventID = UUID;
type ApprovalID = UUID;
type UserID = UUID;
type OrgID = UUID;
```

### 2.2 Temporal Types

```typescript
type ISO8601 = string;           // ISO 8601 datetime with timezone
type Duration = number;          // Milliseconds
type TTL = number;               // Seconds until expiration
```

### 2.3 Resource Types

```typescript
enum ResourceUnit {
  RU = 'ru',   // Reasoning Units — LLM inference compute
  MU = 'mu',   // Memory Units — Storage and retrieval operations
  EU = 'eu',   // Execution Units — Code execution and tool calls
  VU = 'vu',   // Vision Units — Image/video processing
}

interface ResourceBudget {
  ru: number;
  mu: number;
  eu: number;
  vu: number;
}

interface ResourceConsumption {
  ru: number;
  mu: number;
  eu: number;
  vu: number;
}
```

### 2.4 Common Types

```typescript
type Priority = 0 | 1 | 2 | 3 | 4 | 5;
// 0=SYSTEM, 1=CRITICAL, 2=HIGH, 3=NORMAL, 4=LOW, 5=IDLE

type Tags = string[];
type Metadata = Record<string, string>;

interface Provenance {
  source_type: 'user' | 'agent' | 'external' | 'system' | 'memory';
  source_id: string;
  confidence: number;           // 0.0 - 1.0
  timestamp: ISO8601;
}

interface Result<T> {
  ok: true;
  data: T;
}

interface Error {
  ok: false;
  error_code: string;           // KER-xxxx format
  error_message: string;
  retryable: boolean;
  retry_after?: Duration;
  details?: unknown;
}

type Outcome<T> = Result<T> | Error;

interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}
```

### 2.5 Error Envelope

Every Kernel API error MUST use the KER-xxxx namespace:

| Code | Category | Description |
|------|----------|-------------|
| KER-0001 | Not Found | Resource does not exist |
| KER-0002 | Already Exists | Duplicate resource creation |
| KER-0003 | Permission Denied | Insufficient permissions |
| KER-0004 | Invalid Input | Schema validation failed |
| KER-0005 | Conflict | State transition not allowed |
| KER-0006 | Timeout | Operation timed out |
| KER-0007 | Rate Limited | Too many requests |
| KER-0008 | Quota Exceeded | Resource quota exhausted |
| KER-0009 | Budget Exceeded | Resource budget consumed |
| KER-0010 | Unavailable | Dependency not available |
| KER-0011 | Unauthorized | Authentication failed |
| KER-0012 | Precondition Failed | Required precondition not met |
| KER-0013 | Workspace Locked | Workspace is in locked state |
| KER-0014 | Agent Unresponsive | Agent heartbeat timeout |
| KER-0015 | Dependency Failed | Upstream dependency failed |
| KER-0100 | Internal | Unknown internal error |

---

## 3. Core Object Definitions

### 3.1 Agent

The fundamental unit of intelligence in AgentOS.

```typescript
enum AgentType {
  CHIEF = 'chief',         // Goal decomposition, workforce allocation
  MANAGER = 'manager',     // Task assignment, progress tracking
  WORKER = 'worker',       // Task execution, result reporting
  VALIDATOR = 'validator', // Output verification, quality gates
  SPECIALIST = 'specialist', // Domain expert (e.g., security, finance)
  DAEMON = 'daemon',       // Background service (monitoring, maintenance)
  PROXY = 'proxy',        // External system interface
}

enum AgentState {
  SPAWNING = 'spawning',
  INITIALIZING = 'initializing',
  READY = 'ready',
  RUNNING = 'running',
  PAUSED = 'paused',
  SUSPENDED = 'suspended',
  ERRORED = 'errored',
  RECOVERING = 'recovering',
  TERMINATING = 'terminating',
  TERMINATED = 'terminated',
}

interface Agent {
  id: AgentID;
  name: string;
  type: AgentType;
  state: AgentState;
  workspace_id: WorkspaceID;
  project_id: ProjectID;
  
  // Capabilities this agent can perform
  capabilities: CapabilityID[];
  
  // Permissions granted to this agent
  permissions: PermissionID[];
  
  // Resource allocation and consumption
  resources_allocated: ResourceBudget;
  resources_consumed: ResourceConsumption;
  resource_limits: ResourceBudget;
  
  // Hierarchy
  parent_agent_id?: AgentID;
  child_agent_ids: AgentID[];
  
  // Task tracking
  active_task_ids: TaskID[];
  completed_task_count: number;
  failed_task_count: number;
  
  // Identity
  owner_user_id: UserID;
  public_key: string;             // Ed25519 public key for ACP signing
  
  // Metadata
  metadata: Metadata;
  tags: Tags;
  created_at: ISO8601;
  updated_at: ISO8601;
  terminated_at?: ISO8601;
}
```

#### Agent Lifecycle State Machine

```
States: [spawning, initializing, ready, running, paused, suspended, errored, recovering, terminating, terminated]

Transitions:
  spawning → initializing
    Condition: Kernel creates agent process and assigns workspace
    Side effect: Publish event agent.created
    Failure: If process creation fails → errored

  initializing → ready
    Condition: Agent reports capabilities loaded, sends agent.capability.advertise
    Side effect: Register capabilities, publish event agent.ready
    Timeout: 30 seconds. If exceeded → errored

  initializing → errored
    Condition: Agent fails to initialize (crash, timeout, capability load failure)
    Side effect: Publish event agent.error, increment failure count
    Recovery: If failure_count < 3 and budget allows → recovering

  ready → running
    Condition: Task assigned AND resources allocated
    Side effect: Publish event agent.task_started
    Failure: If no resources available → remain ready, publish event resource.unavailable

  ready → terminating
    Condition: Shutdown signal received (user, admin, or parent agent)
    Side effect: Publish event agent.terminating

  running → paused
    Condition: Pause signal received OR resource preemption
    Side effect: Suspend task timers, publish event agent.paused

  running → errored
    Condition: Unrecoverable error during execution
    Side effect: Release resources, reassign tasks, publish event agent.error
    Recovery: If failure_count < 3 → recovering

  running → ready
    Condition: Task completed, no pending tasks in queue
    Side effect: Release task resources (keep base allocation), publish event agent.idle

  paused → running
    Condition: Resume signal AND resources available
    Side effect: Resume task timers, publish event agent.resumed

  paused → terminating
    Condition: Kill signal received while paused
    Side effect: Force-release all tasks and resources

  suspended → ready
    Condition: Suspension lifted (admin action or quota restored)
    Side effect: Publish event agent.reactivated

  errored → recovering
    Condition: failure_count < MAX_RETRIES (3) AND budget allows retry
    Side effect: Reset initialization, publish event agent.recovering

  errored → terminating
    Condition: failure_count >= MAX_RETRIES OR budget exhausted
    Side effect: Publish event agent.terminating

  recovering → initializing
    Condition: Recovery initiated, agent re-enters initialization
    Side effect: Publish event agent.reinitializing

  terminating → terminated
    Condition: Cleanup complete (tasks released, resources freed, children notified)
    Side effect: Publish event agent.terminated, deregister from workspace
    Timeout: 60 seconds. If exceeded → force terminate

  ANY → suspended
    Condition: Admin action (quota exceeded, security incident, manual)
    Side effect: Freeze all tasks, preserve state, publish event agent.suspended
```

#### Agent Invariants

1. Agent can only be assigned tasks when state is `[ready, running]`
2. Agent CANNOT transition from `terminated` to any other state (terminal)
3. Agent in `errored` state MUST NOT hold any resources
4. All agent transitions MUST be logged as events
5. Resource deallocation MUST complete before `terminated` state
6. Child agents MUST be terminated before parent terminates
7. An agent's `resources_consumed` MUST NEVER exceed `resources_allocated`
8. Agent `public_key` MUST NOT change after registration (use key rotation protocol)

---

### 3.2 Task

A unit of work assigned to agents.

```typescript
enum TaskType {
  GOAL = 'goal',           // High-level objective (assigned to Chief)
  OBJECTIVE = 'objective', // Decomposed goal (assigned to Manager)
  STEP = 'step',           // Single step (assigned to Worker)
  ACTION = 'action',       // Atomic action (tool call, API request)
  VERIFICATION = 'verification', // Validation of prior work
  MAINTENANCE = 'maintenance',  // System upkeep (health checks, cleanup)
}

enum TaskPriority {
  CRITICAL = 1,
  HIGH = 2,
  NORMAL = 3,
  LOW = 4,
  BACKGROUND = 5,
}

enum TaskState {
  DRAFT = 'draft',
  ANNOUNCED = 'announced',
  CLAIMED = 'claimed',
  IN_PROGRESS = 'in_progress',
  BLOCKED = 'blocked',
  REVIEW = 'review',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

interface Task {
  id: TaskID;
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  state: TaskState;
  
  // Assignment
  workspace_id: WorkspaceID;
  project_id: ProjectID;
  assignee_id?: AgentID;
  claimed_by?: AgentID;
  claimed_at?: ISO8601;
  
  // Hierarchy
  parent_task_id?: TaskID;
  child_task_ids: TaskID[];
  
  // Dependencies
  depends_on: TaskID[];      // Tasks that must complete first
  blocks: TaskID[];          // Tasks blocked by this one
  
  // Resource requirements
  resources_required: ResourceBudget;
  resources_allocated?: ResourceBudget;
  
  // Results
  result?: unknown;
  error?: string;
  
  // Scheduling
  deadline?: ISO8601;
  retry_count: number;
  max_retries: number;
  
  // History
  previous_assignees: AgentID[];
  
  // Metadata
  tags: Tags;
  metadata: Metadata;
  created_at: ISO8601;
  updated_at: ISO8601;
  completed_at?: ISO8601;
  failed_at?: ISO8601;
}
```

#### Task Lifecycle State Machine

```
States: [draft, announced, claimed, in_progress, blocked, review, completed, failed, cancelled]

Transitions:
  draft → announced
    Condition: Task fully defined, dependencies valid, creator has permission
    Side effect: Publish to blackboard, emit event task.announced
    Failure: If dependencies form a cycle → KER-0004

  announced → claimed
    Condition: Agent sends task.claim and claim is accepted (first-come or assigned)
    Side effect: Set claimed_by, emit event task.claimed
    Timeout: If not claimed within deadline → escalate to Chief

  announced → cancelled
    Condition: Goal cancelled, parent task cancelled, or no longer needed
    Side effect: Emit event task.cancelled, notify waiting agents

  claimed → in_progress
    Condition: Agent starts work within CLAIM_TIMEOUT (60s default)
    Side effect: Allocate resources, emit event task.started
    Timeout: If not started within CLAIM_TIMEOUT → revert to announced

  claimed → announced
    Condition: Agent releases claim (voluntary or timeout)
    Side effect: Clear claimed_by, emit event task.unclaimed

  in_progress → blocked
    Condition: Agent encounters blocker (missing dependency, resource unavailable, external block)
    Side effect: Pause resource consumption, emit event task.blocked
    Recovery: Notify Manager/Chief, attempt to resolve blocker

  in_progress → review
    Condition: Agent submits result for validation
    Side effect: Emit event task.review, assign Validator if available

  in_progress → completed
    Condition: Result accepted (auto-approved or Validator approved)
    Side effect: Release resources, emit event task.completed
    Failure: If result rejected → failed (with retry option)

  in_progress → failed
    Condition: Agent reports unrecoverable failure
    Side effect: Release resources, emit event task.failed
    Recovery: If retry_count < max_retries → announced (retry)

  blocked → in_progress
    Condition: Blocker resolved
    Side effect: Resume resource consumption, emit event task.unblocked

  blocked → failed
    Condition: Blocker cannot be resolved within deadline
    Side effect: Release resources, emit event task.failed

  blocked → announced
    Condition: Agent gives up, task returns to pool
    Side effect: Clear assignee, emit event task.unassigned

  review → completed
    Condition: Validator approves result
    Side effect: Record result, release resources, emit event task.completed

  review → failed
    Condition: Validator rejects result
    Side effect: If retry_count < max_retries → announced (retry)
    Otherwise → terminal failed state

  failed → announced
    Condition: retry_count < max_retries AND retry approved
    Side effect: Increment retry_count, clear assignee, emit event task.retried

  completed → (terminal)
  failed → (terminal, if max_retries exhausted)
  cancelled → (terminal)
```

#### Task Invariants

1. Task dependencies MUST form a DAG (no cycles)
2. `resources_allocated` MUST equal `resources_required` when task is `in_progress`
3. A task in `completed`/`failed`/`cancelled` state MUST NOT hold any resources
4. `claimed_by` is only set in `claimed` and `in_progress` states
5. A task MUST NOT transition from a terminal state
6. `retry_count` MUST increment on every `failed → announced` transition
7. `depends_on` tasks MUST all be `completed` before this task can be `claimed`

---

### 3.3 Workspace

Isolated execution context for a set of agents and tasks.

```typescript
enum WorkspaceState {
  CREATING = 'creating',
  ACTIVE = 'active',
  PAUSED = 'paused',
  LOCKED = 'locked',
  ARCHIVING = 'archiving',
  ARCHIVED = 'archived',
  DELETING = 'deleting',
  DELETED = 'deleted',
}

interface Workspace {
  id: WorkspaceID;
  name: string;
  description: string;
  state: WorkspaceState;
  project_id: ProjectID;
  owner_id: UserID;
  
  // Contained resources
  agent_ids: AgentID[];
  task_ids: TaskID[];
  
  // Resource limits
  resource_quota: ResourceBudget;
  resource_consumed: ResourceConsumption;
  max_agents: number;
  
  // Memory scope
  memory_scope: 'workspace' | 'project' | 'shared';
  
  // Configuration
  default_priority: TaskPriority;
  auto_pause_on_budget_exhaustion: boolean;
  
  // Metadata
  metadata: Metadata;
  tags: Tags;
  created_at: ISO8601;
  updated_at: ISO8601;
  archived_at?: ISO8601;
  deleted_at?: ISO8601;
}
```

#### Workspace Lifecycle

```
creating → active : All initial agents spawned, resources allocated
creating → deleting : Initialization failed
active → paused : Budget exhausted, admin action, or auto-pause
active → locked : Security incident detected
active → archiving : User/admin requests archive
paused → active : Budget restored, admin unpauses
locked → active : Security incident resolved
locked → deleting : Irrecoverable security incident
archiving → archived : All agents terminated, memory preserved
archived → active : Admin restores workspace
deleted → (terminal)
```

#### Workspace Invariants

1. Workspace isolation: agents in one workspace CANNOT access another workspace's memory
2. Total workspace resource consumption MUST NOT exceed workspace quota
3. A workspace in `locked` state MUST suspend all agent activity
4. Workspace archive MUST preserve all memory entries and audit logs

---

### 3.4 Project

Top-level container for related work spanning multiple workspaces.

```typescript
enum ProjectState {
  PLANNING = 'planning',
  ACTIVE = 'active',
  ON_HOLD = 'on_hold',
  COMPLETED = 'completed',
  ARCHIVED = 'archived',
}

interface Project {
  id: ProjectID;
  name: string;
  description: string;
  state: ProjectState;
  owner_id: UserID;
  organization_id?: OrgID;
  
  // Structure
  workspace_ids: WorkspaceID[];
  goal_ids: TaskID[];            // Top-level goals
  
  // Timeline
  deadline?: ISO8601;
  
  // Budget
  total_budget: ResourceBudget;
  budget_consumed: ResourceConsumption;
  
  // Metadata
  metadata: Metadata;
  tags: Tags;
  created_at: ISO8601;
  updated_at: ISO8601;
  completed_at?: ISO8601;
}
```

#### Project Invariants

1. Project budget consumed MUST NOT exceed total_budget
2. A project MUST have at least one workspace
3. Project state `completed` requires all goals to be `completed` or `cancelled`

---

### 3.5 Capability

A universal ability that can be invoked by agents.

```typescript
enum CapabilityState {
  REGISTERED = 'registered',
  ACTIVE = 'active',
  DEPRECATED = 'deprecated',
  DISABLED = 'disabled',
  REMOVED = 'removed',
}

interface Capability {
  id: CapabilityID;
  name: string;                // e.g., "core.search.web"
  namespace: string;           // e.g., "core", "mcp", "app", "custom"
  version: string;             // SemVer e.g., "1.0.0"
  parent_id?: CapabilityID;
  child_ids: CapabilityID[];
  state: CapabilityState;
  
  // Interface contract
  input_schema: object;        // JSON Schema
  output_schema: object;       // JSON Schema
  error_schema: object;        // JSON Schema
  
  // Requirements
  permissions_required: PermissionID[];
  resources_consumed: ResourceBudget;
  
  // Providers
  provider_count: number;
  
  // Metadata
  description: string;
  tags: Tags;
  deprecated: boolean;
  deprecation_message?: string;
  replacement_id?: CapabilityID;
  created_at: ISO8601;
  updated_at: ISO8601;
}
```

#### Capability Invariants

1. A capability with zero providers MUST be marked `disabled`
2. Capability version changes MUST follow SemVer
3. Deprecated capabilities MUST specify a `replacement_id`
4. Agents can only invoke capabilities they have permission for

---

### 3.6 Permission

Access control primitive governing what agents can do.

```typescript
enum PermissionScope {
  GLOBAL = 'global',
  ORGANIZATION = 'organization',
  PROJECT = 'project',
  WORKSPACE = 'workspace',
  TASK = 'task',
}

interface Permission {
  id: PermissionID;
  name: string;                // e.g., "capability.invoke", "workspace.admin"
  scope: PermissionScope;
  grantee_id: string;          // AgentID, UserID, or RoleID
  grantee_type: 'agent' | 'user' | 'role';
  resource_type: string;       // What resource this applies to
  resource_id?: string;        // Specific resource (null = all in scope)
  actions: string[];           // e.g., ["read", "write", "execute"]
  conditions?: {
    time_restriction?: { start: string; end: string };
    ip_restriction?: string[];
    approval_required?: boolean;
    max_uses?: number;
  };
  granted_by: string;          // Who granted this permission
  expires_at?: ISO8601;
  created_at: ISO8601;
  revocable: boolean;
}
```

#### Permission Resolution Algorithm

When checking if an agent has permission for action X on resource Y:

1. Collect all permissions where `grantee_id` matches the agent, its roles, or its parent agents
2. Filter by `resource_type` and `resource_id` (null matches all)
3. Filter by scope: workspace permissions override project, project overrides org, org overrides global
4. For conflicting permissions (grant vs deny): **most restrictive wins**
5. Check `conditions`: time restrictions, IP restrictions, approval requirements
6. Check `expires_at`: expired permissions are invalid
7. Return the effective permission set

#### Permission Invariants

1. An agent CANNOT grant permissions it does not possess (no delegation by default)
2. Permission denial takes precedence over grant (most restrictive wins)
3. Expired permissions MUST be treated as non-existent
4. Permission checks MUST be logged in the audit trail

---

### 3.7 MemoryEntry

A piece of information stored in the memory graph.

```typescript
enum MemoryTier {
  L0 = 'l0_hot',        // In-process, sub-millisecond access
  L1 = 'l1_working',    // Redis-backed, millisecond access, session-scoped
  L2 = 'l2_persistent', // PostgreSQL+pgvector, persistent, searchable
  L3 = 'l3_archival',   // Compressed, rarely accessed, retrieval on demand
}

enum MemoryType {
  FACT = 'fact',
  CONTEXT = 'context',
  DECISION = 'decision',
  OBSERVATION = 'observation',
  INSTRUCTION = 'instruction',
  RELATIONSHIP = 'relationship',
  RESULT = 'result',
  FEEDBACK = 'feedback',
}

interface MemoryEntry {
  id: MemoryID;
  type: MemoryType;
  tier: MemoryTier;
  content: unknown;              // The actual memory content
  summary?: string;             // Condensed version for search
  workspace_id: WorkspaceID;
  
  // Provenance
  source_agent_id: AgentID;
  source_type: 'user' | 'agent' | 'external' | 'system';
  confidence: number;            // 0.0 - 1.0
  
  // Search
  tags: Tags;
  embeddings?: number[];         // Vector embedding for semantic search
  
  // Graph relationships
  relations: MemoryRelation[];
  
  // Lifecycle
  access_count: number;
  last_accessed_at: ISO8601;
  expires_at?: ISO8601;
  
  // Versioning
  version: number;
  previous_version_id?: MemoryID;
  
  created_at: ISO8601;
  updated_at: ISO8601;
}

interface MemoryRelation {
  target_id: MemoryID;
  relation_type: 'causes' | 'relates_to' | 'contradicts' | 'depends_on' | 'extends' | 'supersedes';
  confidence: number;
}
```

#### Memory Invariants

1. Memory writes are scoped to workspace (agents cannot write to other workspaces' memory)
2. Memory reads are scoped by permission (agents can only read permitted scopes)
3. `confidence` MUST decay over time unless reinforced by subsequent access
4. Memory entries MUST NOT be hard-deleted (soft delete with version history)
5. Every memory write MUST record provenance

---

### 3.8 ResourceAllocation

Resource assignment to an agent or task.

```typescript
enum AllocationState {
  PENDING = 'pending',
  GRANTED = 'granted',
  ACTIVE = 'active',
  THROTTLED = 'throttled',
  PREEMPTED = 'preempted',
  RELEASED = 'released',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

interface ResourceAllocation {
  id: AllocationID;
  agent_id: AgentID;
  task_id?: TaskID;
  workspace_id: WorkspaceID;
  state: AllocationState;
  
  // Allocated amounts
  allocated: ResourceBudget;
  consumed: ResourceConsumption;
  
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
```

#### Resource Invariants

1. `consumed` MUST NEVER exceed `allocated` for any resource type
2. Total allocations MUST NOT exceed total available resources
3. Non-preemptible allocations CANNOT be preempted
4. Released allocations MUST be available for immediate reallocation

---

### 3.9 Event

Something that happened in the system.

```typescript
enum EventDomain {
  AGENT = 'agent',
  TASK = 'task',
  WORKSPACE = 'workspace',
  PROJECT = 'project',
  CAPABILITY = 'capability',
  PERMISSION = 'permission',
  MEMORY = 'memory',
  RESOURCE = 'resource',
  APPROVAL = 'approval',
  SYSTEM = 'system',
  SECURITY = 'security',
}

interface Event {
  id: EventID;
  domain: EventDomain;
  type: string;                 // e.g., "agent.created", "task.completed"
  source: string;               // What emitted this event
  target?: string;              // Intended recipient (null = broadcast)
  data: unknown;                 // Event-specific payload
  timestamp: ISO8601;
  correlation_id?: string;      // Links related events
  causation_id?: string;       // What caused this event
  workspace_id?: WorkspaceID;
}
```

#### Event Invariants

1. Events are immutable — they MUST NOT be modified after creation
2. Events from the same source MUST be ordered by timestamp
3. Every state transition in every object MUST emit an event
4. Events MUST be persisted to the audit log before any side effects

---

### 3.10 Approval

A request for authorization to perform an action.

```typescript
enum ApprovalType {
  CAPABILITY_INVOKE = 'capability_invoke',
  RESOURCE_ALLOCATE = 'resource_allocate',
  PERMISSION_GRANT = 'permission_grant',
  WORKSPACE_CREATE = 'workspace_create',
  AGENT_SPAWN = 'agent_spawn',
  DATA_EXPORT = 'data_export',
  CUSTOM = 'custom',
}

enum ApprovalState {
  PENDING = 'pending',
  APPROVED = 'approved',
  DENIED = 'denied',
  EXPIRED = 'expired',
  CANCELLED = 'cancelled',
}

interface Approval {
  id: ApprovalID;
  type: ApprovalType;
  state: ApprovalState;
  
  requester_id: AgentID | UserID;
  approver_id?: AgentID | UserID;
  
  // What is being approved
  resource_type: string;
  resource_id?: string;
  action: string;
  action_params?: unknown;
  
  // Reasoning
  reason?: string;
  denial_reason?: string;
  
  // Timing
  expires_at: ISO8601;           // When this request auto-expires
  created_at: ISO8601;
  resolved_at?: ISO8601;
}
```

#### Approval Invariants

1. Pending approvals MUST expire after their TTL (default denial on expiry)
2. Approved approvals MUST be idempotent (same request_id returns same result)
3. Denied approvals MUST include a denial_reason
4. Approval state transitions are one-way: pending → approved/denied/expired/cancelled

---

## 4. Kernel API Endpoints

Every endpoint follows this contract format:

### 4.1 Agent Namespace

#### `agent.register(request) → Outcome<Agent>`

| Field | Type | Description |
|-------|------|-------------|
| **Input** | `{ name, type, workspace_id, capabilities, public_key, metadata? }` | Agent registration request |
| **Output** | `Agent` | Fully initialized agent in `spawning` state |
| **Preconditions** | Workspace exists and is `active`. Requester has `agent.spawn` permission. | |
| **Postconditions** | Agent created in `spawning` state. Agent registered to workspace. Event `agent.created` published. | |
| **Errors** | KER-0002 (name exists), KER-0003 (no permission), KER-0010 (workspace unavailable) | |
| **Side Effects** | Workspace `agent_ids` updated. Default permissions assigned. | |

#### `agent.deregister(agent_id) → Outcome<void>`

| Field | Type | Description |
|-------|------|-------------|
| **Input** | `{ agent_id }` | Agent to deregister |
| **Output** | void | |
| **Preconditions** | Agent exists. Requester is agent itself, its parent, or has `agent.terminate` permission. | |
| **Postconditions** | Agent transitions to `terminating`. All tasks released. All child agents notified. | |
| **Errors** | KER-0001 (not found), KER-0003 (no permission), KER-0005 (already terminated) | |
| **Side Effects** | Event `agent.terminating` published. Tasks return to blackboard. | |

#### `agent.inspect(agent_id) → Outcome<Agent>`

| Field | Description |
|-------|-------------|
| **Input** | `{ agent_id }` |
| **Preconditions** | Agent exists. Requester has `agent.read` permission. |
| **Output** | Full `Agent` object |
| **Errors** | KER-0001 (not found), KER-0003 (no permission) |

#### `agent.list(filter?) → Outcome<PaginatedResult<Agent>>`

| Field | Description |
|-------|-------------|
| **Input** | `{ workspace_id?, type?, state?, limit?, offset? }` |
| **Preconditions** | Requester has `agent.list` permission for the given scope. |
| **Output** | Paginated list of agents matching filter |

#### `agent.signal(agent_id, signal) → Outcome<void>`

| Field | Description |
|-------|-------------|
| **Input** | `{ agent_id, signal: 'pause' \| 'resume' \| 'kill' \| 'suspend' }` |
| **Preconditions** | Agent exists. Requester has permission. Signal is valid for current state. |
| **Postconditions** | Agent state transitions per lifecycle. |
| **Errors** | KER-0005 (invalid transition for current state) |

---

### 4.2 Task Namespace

#### `task.create(request) → Outcome<Task>`

| Field | Description |
|-------|-------------|
| **Input** | `{ title, description, type, priority, workspace_id, project_id?, parent_task_id?, depends_on?, resources_required?, deadline?, max_retries?, tags?, metadata? }` |
| **Preconditions** | Workspace active. Dependencies are valid (no cycles). Requester has `task.create` permission. |
| **Postconditions** | Task created in `draft` state, then transitions to `announced`. Event `task.announced` published to blackboard. |
| **Errors** | KER-0002 (duplicate), KER-0004 (cycle in dependencies), KER-0003 (no permission) |

#### `task.cancel(task_id, reason?) → Outcome<void>`

| Field | Description |
|-------|-------------|
| **Preconditions** | Task exists in non-terminal state. Requester has `task.cancel` permission. |
| **Postconditions** | Task transitions to `cancelled`. Resources released. Dependent tasks notified. |
| **Side Effects** | All blocked tasks are notified. Event `task.cancelled` published. |

#### `task.assign(task_id, agent_id) → Outcome<Task>`

| Field | Description |
|-------|-------------|
| **Preconditions** | Task is `announced`. Agent is `ready` or `running`. Agent has required capabilities. Requester has `task.assign` permission (Chief/Manager). |
| **Postconditions** | Task transitions to `claimed`. Agent added to `previous_assignees`. |

#### `task.claim(task_id) → Outcome<Task>`

| Field | Description |
|-------|-------------|
| **Preconditions** | Task is `announced`. Agent is `ready` and has required capabilities. First-come-first-served. |
| **Postconditions** | Task transitions to `claimed`. Agent is `claimed_by`. |

#### `task.complete(task_id, result) → Outcome<Task>`

| Field | Description |
|-------|-------------|
| **Preconditions** | Task is `in_progress`. Claiming agent submits result. |
| **Postconditions** | If auto-approved → `completed`. If validation required → `review`. Resources released. Event `task.completed` or `task.review`. |

#### `task.fail(task_id, error) → Outcome<Task>`

| Field | Description |
|-------|-------------|
| **Preconditions** | Task is `in_progress` or `blocked`. Agent reports failure. |
| **Postconditions** | If retry_count < max_retries → `announced` (retry). Otherwise → `failed`. Resources released. |

---

### 4.3 Workspace Namespace

#### `workspace.create(request) → Outcome<Workspace>`

| Field | Description |
|-------|-------------|
| **Input** | `{ name, description, project_id, resource_quota?, max_agents?, memory_scope?, metadata? }` |
| **Preconditions** | Project exists. Requester has `workspace.create` permission. |
| **Postconditions** | Workspace created in `creating` → `active`. Default channels created. |

#### `workspace.destroy(workspace_id) → Outcome<void>`

| Field | Description |
|-------|-------------|
| **Preconditions** | All agents terminated. All tasks completed/cancelled. Requester has `workspace.destroy` permission. |
| **Postconditions** | Workspace → `deleting` → `deleted`. Memory preserved for audit. |

#### `workspace.enter(workspace_id, agent_id) → Outcome<void>`

| Field | Description |
|-------|-------------|
| **Preconditions** | Workspace is `active`. Agent has `workspace.enter` permission. Workspace not at max_agents. |

#### `workspace.leave(workspace_id, agent_id) → Outcome<void>`

| Field | Description |
|-------|-------------|
| **Preconditions** | Agent has no active tasks in workspace. Agent not workspace owner. |

#### `workspace.inspect(workspace_id) → Outcome<Workspace>`

Standard read with permission check.

---

### 4.4 Project Namespace

#### `project.create(request) → Outcome<Project>`
#### `project.archive(project_id) → Outcome<void>`
#### `project.inspect(project_id) → Outcome<Project>`

Standard CRUD with permission checks and state transitions.

---

### 4.5 Capability Namespace

#### `capability.register(request) → Outcome<Capability>`

| Field | Description |
|-------|-------------|
| **Input** | `{ name, namespace, version, parent_id?, input_schema, output_schema, error_schema, permissions_required, resources_consumed, description, tags }` |
| **Preconditions** | Namespace exists. Version doesn't conflict. Requester has `capability.register` permission. |

#### `capability.invoke(capability_id, input, options?) → Outcome<unknown>`

| Field | Description |
|-------|-------------|
| **Input** | `{ capability_id, version?, input, approval_required? }` |
| **Preconditions** | Capability is `active`. Agent has required permissions. Provider available. Resources available. |
| **Postconditions** | Resources consumed. Result delivered. Audit entry created. |
| **Errors** | KER-0003 (no permission), KER-0008 (quota exceeded), KER-0010 (no provider) |

#### `capability.inspect(capability_id) → Outcome<Capability>`
#### `capability.list(filter?) → Outcome<PaginatedResult<Capability>>`

---

### 4.6 Permission Namespace

#### `permission.grant(request) → Outcome<Permission>`

| Field | Description |
|-------|-------------|
| **Input** | `{ name, scope, grantee_id, grantee_type, resource_type, resource_id?, actions, conditions?, expires_at? }` |
| **Preconditions** | Granter possesses the permission being granted. No conflicting deny exists. |

#### `permission.revoke(permission_id) → Outcome<void>`

| Field | Description |
|-------|-------------|
| **Preconditions** | Permission exists. Revoker has `permission.revoke` or is the original granter. |
| **Postconditions** | Permission removed. Affected agents re-evaluated. Audit entry. |

#### `permission.check(agent_id, action, resource_type, resource_id?) → Outcome<boolean>`

| Field | Description |
|-------|-------------|
| **Output** | `true` if agent has permission, `false` with denial reason if not. |

#### `permission.resolve(agent_id) → Outcome<Permission[]>`

| Field | Description |
|-------|-------------|
| **Output** | Complete effective permission set for the agent, after resolution. |

---

### 4.7 Memory Namespace

#### `memory.store(request) → Outcome<MemoryEntry>`

| Field | Description |
|-------|-------------|
| **Input** | `{ type, content, summary?, workspace_id, source_type, confidence, tags?, expires_at?, relations? }` |
| **Preconditions** | Agent has `memory.write` permission for workspace. Content passes schema validation. |

#### `memory.retrieve(memory_id) → Outcome<MemoryEntry>`
#### `memory.search(query) → Outcome<PaginatedResult<MemoryEntry>>`

| Field | Description |
|-------|-------------|
| **Input** | `{ workspace_id, query_text?, tags?, type?, semantic?, limit?, offset? }` |
| **Preconditions** | Agent has `memory.read` permission for workspace. |

#### `memory.forget(memory_id) → Outcome<void>`

| Field | Description |
|-------|-------------|
| **Postconditions** | Memory soft-deleted (versioned). Not hard-deleted. Audit trail preserved. |

---

### 4.8 Resource Namespace

#### `resource.allocate(request) → Outcome<ResourceAllocation>`

| Field | Description |
|-------|-------------|
| **Input** | `{ agent_id, task_id?, ru, mu, eu, vu, priority, duration?, deadline?, preemptible? }` |
| **Preconditions** | Resources available within quota. Agent exists. Priority valid. |

#### `resource.release(allocation_id) → Outcome<void>`
#### `resource.inspect(allocation_id) → Outcome<ResourceAllocation>`
#### `resource.rebalance(workspace_id) → Outcome<ResourceAllocation[]>`

| Field | Description |
|-------|-------------|
| **Postconditions** | Resources redistributed according to priority and fairness rules. |

---

### 4.9 Event Namespace

#### `event.publish(event) → Outcome<EventID>`

| Field | Description |
|-------|-------------|
| **Input** | `{ domain, type, source, target?, data, correlation_id?, causation_id? }` |
| **Preconditions** | Agent has `event.publish` permission. |

#### `event.subscribe(filter) → Outcome<SubscriptionID>`
#### `event.unsubscribe(subscription_id) → Outcome<void>`
#### `event.replay(filter, from_timestamp?) → Outcome<Event[]>`

---

### 4.10 Approval Namespace

#### `approval.request(request) → Outcome<Approval>`

| Field | Description |
|-------|-------------|
| **Input** | `{ type, resource_type, resource_id?, action, action_params?, reason?, expires_at? }` |

#### `approval.approve(approval_id) → Outcome<void>`
#### `approval.reject(approval_id, reason) → Outcome<void>`
#### `approval.expire(approval_id) → Outcome<void>`

---

## 5. Cross-Cutting Concerns

### 5.1 Event Sourcing

All state changes MUST be captured as events. The event log is the source of truth. Any object's current state MUST be reconstructable by replaying its events from creation.

### 5.2 Distributed Tracing

Every operation MUST carry a `correlation_id` linking it to the originating request. Causal chains MUST use `causation_id` to track which event triggered which subsequent action.

### 5.3 Resource Accounting

Every operation that consumes resources MUST record the consumption against the appropriate allocation. No resource consumption is "free" — even system operations are tracked.

### 5.4 Permission Resolution

Permission checks use the most-restrictive-wins algorithm with explicit override chain. See Section 3.6 for the complete algorithm.

### 5.5 Memory Scoping

Memory access is governed by workspace membership and explicit permissions. Cross-workspace memory access requires `memory.read` permission on the target workspace.

---

## 6. Kernel Invariants

1. **Conservation of Resources**: Total allocated resources MUST NOT exceed total available resources at any moment
2. **Agent Isolation**: An agent cannot access another agent's private state
3. **Terminal Finality**: Objects in terminal states (terminated, deleted, completed) MUST NOT transition to non-terminal states
4. **Audit Completeness**: Every state transition MUST have a corresponding audit log entry
5. **Permission Enforcement**: No operation MAY proceed without verified permission
6. **Dependency Acyclicity**: Task dependencies MUST form a DAG; cycle detection MUST reject circular dependencies
7. **Workspace Isolation**: Workspace-scoped data MUST NOT leak to other workspaces
8. **Budget Hard Limit**: Resource consumption MUST NOT exceed allocation; hard budget exhaustion causes termination
9. **Event Ordering**: Events from the same source MUST be totally ordered by timestamp
10. **Idempotency**: Write operations with the same idempotency key MUST return the same result

---

## 7. Error Code Registry

| Code | Category | Message Template | Retryable |
|------|----------|----------------|-----------|
| KER-0001 | Not Found | `{resource_type} "{id}" not found` | No |
| KER-0002 | Already Exists | `{resource_type} "{name}" already exists` | No |
| KER-0003 | Permission Denied | `Agent "{agent_id}" lacks permission "{permission}" on {resource_type} "{resource_id}"` | No |
| KER-0004 | Invalid Input | `Validation failed: {details}` | No |
| KER-0005 | Conflict | `Cannot transition {object_type} from {from_state} to {to_state}` | No |
| KER-0006 | Timeout | `Operation "{operation}" timed out after {duration}ms` | Yes |
| KER-0007 | Rate Limited | `Rate limit exceeded: {limit} requests per {window}` | Yes |
| KER-0008 | Quota Exceeded | `{resource_type} quota exceeded: {consumed}/{limit}` | No |
| KER-0009 | Budget Exceeded | `{resource_unit} budget exhausted: {consumed}/{budget}` | No |
| KER-0010 | Unavailable | `{dependency} is unavailable: {reason}` | Yes |
| KER-0011 | Unauthorized | `Authentication failed: {reason}` | No |
| KER-0012 | Precondition | `Precondition failed: {condition}` | No |
| KER-0013 | Workspace Locked | `Workspace "{id}" is locked: {reason}` | No |
| KER-0014 | Unresponsive | `Agent "{id}" heartbeat timeout after {missed} misses` | Yes |
| KER-0015 | Dependency | `Dependency "{id}" failed: {error}` | Yes |
| KER-0100 | Internal | `Internal error: {details}` | No |

---

## 8. Event Type Registry

| Domain | Type | Description |
|--------|------|-------------|
| agent | agent.created | Agent spawned |
| agent | agent.ready | Agent initialized |
| agent | agent.task_started | Agent began executing task |
| agent | agent.idle | Agent has no tasks |
| agent | agent.paused | Agent paused |
| agent | agent.resumed | Agent resumed |
| agent | agent.error | Agent encountered error |
| agent | agent.recovering | Agent entering recovery |
| agent | agent.terminating | Agent shutting down |
| agent | agent.terminated | Agent fully terminated |
| agent | agent.suspended | Agent suspended by admin |
| agent | agent.reactivated | Agent unsuspended |
| task | task.announced | Task published to blackboard |
| task | task.claimed | Agent claimed task |
| task | task.unclaimed | Claim released |
| task | task.started | Work began |
| task | task.blocked | Task blocked |
| task | task.unblocked | Blocker resolved |
| task | task.review | Task in review |
| task | task.completed | Task done |
| task | task.failed | Task failed |
| task | task.retried | Task retrying |
| task | task.cancelled | Task cancelled |
| workspace | workspace.created | Workspace created |
| workspace | workspace.activated | Workspace active |
| workspace | workspace.paused | Workspace paused |
| workspace | workspace.locked | Security lock |
| workspace | workspace.archived | Workspace archived |
| resource | resource.allocated | Resources granted |
| resource | resource.released | Resources freed |
| resource | resource.preempted | Resources preempted |
| resource | resource.exhausted | Budget depleted |
| security | security.alert | Security event detected |
| security | security.quarantine | Agent quarantined |
| security | security.incident | Security incident |

---

## 9. Conformance

### MUST Implement (All implementations)
- Agent lifecycle management (all 10 states, all transitions)
- Task lifecycle management (all 9 states, all transitions)
- Workspace creation, activation, pausing
- Permission grant/revoke/check/resolve
- Event publish/subscribe
- Resource allocation/release with quota enforcement
- Audit logging on every state transition
- Error code compatibility (all KER-xxxx codes)

### SHOULD Implement (Recommended)
- Project management
- Capability registration and invocation
- Memory store/retrieve/search
- Approval workflow
- Event replay
- Resource rebalancing
- Workspace archiving

### MAY Implement (Optional)
- Workspace locking
- Agent suspension
- Advanced resource throttling
- Custom event subscriptions

### Conformance Testing

A conformant implementation MUST pass:
1. All lifecycle state transition tests (every valid and invalid transition)
2. Permission resolution tests (grant, deny, override, expiry)
3. Resource conservation tests (no over-allocation)
4. Audit completeness tests (every transition logged)
5. Error code tests (correct codes for all failure modes)
6. Dependency acyclicity tests (cycle detection)
7. Workspace isolation tests (no cross-workspace data leak)

---

*This constitution is the immutable foundation of AgentOS. Every line of code, every design decision, every future feature MUST trace back to these specifications. If these foundations are correct, everything built on top will be sound. If they are wrong, everything becomes technical debt.*

**Ratified**: 2026-06-06  
**Signatories**: Chief Architect, AI Architect, Backend Architect, Security Architect