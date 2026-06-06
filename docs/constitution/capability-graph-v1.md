# AgentOS Capability Graph Constitution v1.0

**Status**: Ratified  
**Date**: 2026-06-06  
**Supersedes**: None (initial version)

---

## Preamble

The Capability Graph replaces application-centric computing with capability-centric computing. Instead of "which app do I open?", the question becomes "which capability do I need?" An agent doesn't launch Photoshop — it invokes the `image.edit` capability, and the graph resolves the best provider for that capability given context, resources, and constraints.

This is the POSIX of intelligent workforces: a universal abstraction that makes every tool, service, model, and API addressable through a single naming and resolution system.

This document uses RFC 2119 keywords: SHALL (mandatory), SHOULD (recommended), MAY (optional).

---

## Article I: Capability Taxonomy

### 1.1 The 12 Root Capabilities

Every capability in AgentOS is a descendant of one of these 12 roots. No capability exists outside this taxonomy.

| Root | Namespace | Description | Example Children |
|------|-----------|-------------|-----------------|
| **Compute** | `compute.*` | Mathematical and logical processing | `compute.math`, `compute.simulate`, `compute.encrypt` |
| **Reason** | `reason.*` | Deduction, inference, planning, judgment | `reason.plan`, `reason.infer`, `reason.classify` |
| **Remember** | `remember.*` | Store, recall, search, forget information | `remember.store`, `remember.search`, `remember.consolidate` |
| **Communicate** | `communicate.*` | Exchange information between entities | `communicate.send`, `communicate.translate`, `communicate.negotiate` |
| **Perceive** | `perceive.*` | Sense and interpret the world (data, images, audio) | `perceive.vision`, `perceive.audio`, `perceive.text` |
| **Actuate** | `actuate.*` | Modify the external world (write, build, deploy) | `actuate.write`, `actuate.build`, `actuate.deploy` |
| **Navigate** | `navigate.*` | Move through spaces (codebases, filesystems, networks) | `navigate.filesystem`, `navigate.web`, `navigate.codebase` |
| **Create** | `create.*` | Generate novel artifacts (code, text, images, designs) | `create.code`, `create.text`, `create.image`, `create.design` |
| **Validate** | `validate.*` | Verify correctness, quality, compliance | `validate.test`, `validate.review`, `validate.audit` |
| **Coordinate** | `coordinate.*` | Orchestrate multiple agents or processes | `coordinate.schedule`, `coordinate.allocate`, `coordinate.delegate` |
| **Secure** | `secure.*` | Protect, authenticate, authorize, audit | `secure.authenticate`, `secure.authorize`, `secure.encrypt` |
| **Learn** | `learn.*` | Acquire and improve capabilities over time | `learn.train`, `learn.adapt`, `learn.feedback` |

### 1.2 Capability Path Syntax

```
capability_path := root "." segment ("." segment)*
segment := [a-z][a-z0-9-]*
max_depth := 6
max_path_length := 128 characters
```

Examples:
- `compute.math.basic` — Basic arithmetic
- `reason.plan.hierarchical` — Hierarchical task planning
- `create.code.typescript` — TypeScript code generation
- `perceive.vision.ocr` — Optical character recognition
- `secure.authenticate.mfa` — Multi-factor authentication

### 1.3 Capability Interface

```typescript
interface Capability {
  path: CapabilityPath;              // e.g., "create.code.typescript"
  version: string;                   // SemVer: "1.0.0"
  display_name: string;              // "TypeScript Code Generation"
  description: string;                // Human-readable description
  root: RootCapability;               // One of the 12 roots
  parent?: CapabilityPath;            // e.g., "create.code"
  children: CapabilityPath[];         // Sub-capabilities
  
  // Schema
  input_schema: JSONSchema;           // What this capability accepts
  output_schema: JSONSchema;          // What this capability produces
  
  // Metadata
  tags: string[];
  deprecated?: { since: string; replacement?: CapabilityPath };
  stability: 'stable' | 'beta' | 'alpha' | 'experimental';
  
  // Constraints
  resource_profile: ResourceProfile;  // Typical resource consumption
  timeout_ms: number;                  // Default timeout
  rate_limit?: RateLimit;              // Calls per minute/hour
  
  // Provenance
  created_at: ISO8601;
  updated_at: ISO8601;
}
```

---

## Article II: Capability Providers

### 2.1 Provider Architecture

A capability can have multiple providers. The graph resolves which provider to use based on context, cost, quality, and constraints.

```typescript
interface CapabilityProvider {
  id: ProviderID;
  capability_path: CapabilityPath;
  agent_id?: AgentID;               // Agent providing this capability (if agent-hosted)
  service_id?: ServiceID;           // External service (if API/tool)
  
  // Quality
  reliability_score: number;        // 0.0 - 1.0 (tracked from invocations)
  avg_latency_ms: number;          // Historical average
  success_rate: number;             // 0.0 - 1.0
  
  // Cost
  cost_model: CostModel;
  
  // Constraints
  max_concurrent: number;           // Max parallel invocations
  current_load: number;             // Current active invocations
  supported_versions: string[];     // Which capability versions supported
  
  // Status
  status: 'available' | 'busy' | 'degraded' | 'offline';
  last_health_check: ISO8601;
  
  // Registration
  registered_at: ISO8601;
}
```

### 2.2 Provider Types

| Type | Description | Example |
|------|-------------|---------|
| **Agent-hosted** | An agent implements this capability natively | Chief agent provides `reason.plan.hierarchical` |
| **Service-backed** | Wraps an external API or tool | OpenAI API provides `reason.infer.text` |
| **Kernel-provided** | Built into the AgentOS kernel | Kernel provides `coordinate.schedule` |
| **Composite** | Chains multiple capabilities together | `create.code.review` = `perceive.text.read` + `validate.review.code` |
| **User-delegated** | Requires human approval/interaction | `actuate.deploy.production` needs user confirmation |

### 2.3 Cost Models

```typescript
type CostModel =
  | { type: 'free' }
  | { type: 'per_call'; cost: ResourceBudget }
  | { type: 'per_unit'; cost: ResourceBudget; unit: string }  // e.g., per token, per second
  | { type: 'tiered'; tiers: { limit: number; cost: ResourceBudget }[] }
  | { type: 'subscription'; period: 'hourly' | 'daily' | 'monthly'; cost: ResourceBudget }
```

### 2.4 Provider Registration

```
1. Provider sends capability.register(provider_id, capability_path, metadata)
2. Graph validates:
   a. Capability path exists in taxonomy (or can be created under a root)
   b. Input/output schemas are valid JSON Schema
   c. Resource profile is within bounds
   d. No duplicate registration (same provider + same capability)
3. If new capability path:
   a. Must have a valid parent (existing capability or root)
   b. Added to taxonomy as child of parent
4. Provider is registered and becomes available for resolution
5. Health check schedule established (every 60s for agent, every 300s for service)
```

---

## Article III: Capability Resolution Algorithm

### 3.1 Resolution Request

```typescript
interface ResolutionRequest {
  capability_path: CapabilityPath;
  version?: string;                  // SemVer range or exact
  context: {
    workspace_id?: WorkspaceID;
    project_id?: ProjectID;
    agent_id?: AgentID;              // Requesting agent
    task_id?: TaskID;                // Requesting task
  };
  constraints: {
    max_latency_ms?: number;
    max_cost?: ResourceBudget;
    min_reliability?: number;        // 0.0 - 1.0
    require_local?: boolean;         // Must not leave the workspace
    require_agent?: boolean;         // Must be agent-hosted (not service)
    exclude_providers?: ProviderID[];
  };
  preferences: {
    optimize_for: 'latency' | 'cost' | 'reliability' | 'quality' | 'balanced';
  };
}
```

### 3.2 Resolution Steps (7 Phases)

```
Phase 1: EXACT MATCH
  - Find providers for exact capability_path
  - Filter by version constraints
  - If found: continue to Phase 5

Phase 2: PARENT FALLBACK
  - Walk up the taxonomy tree (e.g., create.code.typescript → create.code → create)
  - At each level, find providers
  - If found: continue to Phase 5

Phase 3: SEMANTIC MATCH
  - Search for capabilities with similar tags/descriptions
  - Use vector similarity on capability embeddings
  - Threshold: similarity > 0.8
  - If found: continue to Phase 5

Phase 4: COMPOSITE RESOLUTION
  - Check if this capability can be decomposed into available sub-capabilities
  - Find composite providers that chain children
  - If found: continue to Phase 5

Phase 5: CONSTRAINT FILTERING
  - Filter providers by:
    a. Status (must be 'available' or 'degraded')
    b. Constraints (latency, cost, reliability, locality)
    c. Load (current_load < max_concurrent)
  - If zero providers after filtering: return resolution.failed

Phase 6: SCORING AND RANKING
  - Score each remaining provider:
    score = w_latency * (1 / latency) + w_cost * (1 / cost) + w_reliability * reliability + w_quality * quality
  - Weights determined by preferences.optimize_for:
    - latency:   w_latency=0.5, w_cost=0.1, w_reliability=0.2, w_quality=0.2
    - cost:      w_latency=0.1, w_cost=0.5, w_reliability=0.2, w_quality=0.2
    - reliability: w_latency=0.1, w_cost=0.1, w_reliability=0.5, w_quality=0.3
    - quality:   w_latency=0.1, w_cost=0.1, w_reliability=0.2, w_quality=0.6
    - balanced:  w_latency=0.25, w_cost=0.25, w_reliability=0.25, w_quality=0.25

Phase 7: SELECTION
  - Return top-ranked provider
  - If tie: prefer agent-hosted > kernel > service-backed > composite
  - Return ResolutionResult
```

### 3.3 ResolutionResult

```typescript
interface ResolutionResult {
  request: ResolutionRequest;
  provider: CapabilityProvider;
  capability: Capability;
  match_type: 'exact' | 'parent_fallback' | 'semantic' | 'composite';
  confidence: number;                // 1.0 for exact, decreasing for fallbacks
  estimated_latency_ms: number;
  estimated_cost: ResourceBudget;
  alternatives: {                    // Top 3 alternatives
    provider: CapabilityProvider;
    score: number;
  }[];
  resolved_at: ISO8601;
}
```

---

## Article IV: Capability Invocation

### 4.1 Invocation Protocol

```typescript
interface CapabilityInvocation {
  id: InvocationID;
  capability_path: CapabilityPath;
  provider_id: ProviderID;
  caller: {
    agent_id: AgentID;
    task_id?: TaskID;
    workspace_id: WorkspaceID;
  };
  input: unknown;                    // Must validate against capability.input_schema
  options: {
    timeout_ms: number;              // Default from capability, override allowed
    priority: TaskPriority;
    retry_on_failure: boolean;
    fallback_provider?: ProviderID;  // Try this provider if primary fails
  };
  status: InvocationStatus;
  result?: InvocationResult;
  error?: InvocationError;
  created_at: ISO8601;
  completed_at?: ISO8601;
}

type InvocationStatus = 
  | 'pending'       // Waiting for provider to accept
  | 'accepted'      // Provider accepted, executing
  | 'completed'     // Successfully completed
  | 'failed'        // Provider reported failure
  | 'timeout'       // Execution exceeded timeout
  | 'cancelled'     // Caller cancelled
```

### 4.2 Invocation Lifecycle

```
1. Agent calls capability.invoke(path, input, options)
2. Graph resolves provider (Section III)
3. If resolution fails: return invocation.failed with no provider found
4. If resolution succeeds:
   a. Check caller permissions (does agent have capability_path in permissions?)
   b. Check resource budget (does workspace have RU/MU/EU/VU available?)
   c. Reserve resources for execution
   d. Send invocation to provider via ACP
   e. Provider accepts: status → 'accepted'
   f. Provider executes capability
   g. Provider returns result: status → 'completed'
   h. Release reserved resources
   i. Update provider metrics (latency, success_rate)
5. If provider fails:
   a. Release reserved resources
   b. Update provider metrics (failure)
   c. If retry_on_failure and fallback_provider: try fallback
   d. Otherwise: status → 'failed'
6. If timeout:
   a. Cancel execution
   b. Release resources
   c. status → 'timeout'
```

### 4.3 Streaming Invocations

For long-running capabilities (e.g., `create.text.longform`, `compute.simulate`):

```typescript
interface StreamingInvocation extends CapabilityInvocation {
  stream: AsyncIterable<StreamChunk>;
}

interface StreamChunk {
  sequence: number;
  type: 'data' | 'progress' | 'heartbeat' | 'error' | 'complete';
  payload: unknown;
  timestamp: ISO8601;
}
```

- Provider sends chunks via ACP `capability.stream` messages
- Consumer reads via async iterator
- Heartbeat chunks every 30s to prevent timeout
- Error chunk can terminate stream early
- Complete chunk signals end of stream

---

## Article V: Capability Composition

### 5.1 Composite Capabilities

A composite capability chains multiple capabilities into a pipeline:

```typescript
interface CompositeCapability extends Capability {
  type: 'composite';
  pipeline: CompositeStep[];
  error_handling: 'fail_fast' | 'skip_and_continue' | 'retry_step';
}

interface CompositeStep {
  step: number;
  capability_path: CapabilityPath;
  input_mapping: {                  // How to map previous output to this step's input
    source: 'previous_output' | 'original_input' | 'context';
    path?: string;                   // JSON path within source
  };
  timeout_ms: number;
  required: boolean;                 // If false and step fails, continue pipeline
}
```

### 5.2 Pipeline Execution

```
1. Composite capability invoked with input
2. For each step in pipeline (ordered by step number):
   a. Resolve provider for step.capability_path
   b. Map input using input_mapping
   c. Invoke capability with mapped input
   d. Wait for result (up to timeout_ms)
   e. If success: store result, pass to next step
   f. If failure:
      - fail_fast: abort pipeline, return error
      - skip_and_continue: skip, pass original/empty to next step
      - retry_step: retry up to 3 times with exponential backoff
3. Final step result = composite result
4. All intermediate results stored in invocation context
```

---

## Article VI: Capability Discovery

### 6.1 Search Interface

```typescript
interface CapabilitySearch {
  query: string;                      // Natural language or path fragment
  filters?: {
    root?: RootCapability;            // Limit to one root
    min_stability?: CapabilityStability;
    tags?: string[];
    has_providers?: boolean;          // Only capabilities with available providers
    max_depth?: number;               // Limit taxonomy depth
  };
  limit?: number;                     // Max results (default: 20)
}
```

### 6.2 Search Algorithm

```
1. Exact path match: if query looks like a path (e.g., "create.code"), find it
2. Tag match: find capabilities with tags matching query
3. Semantic search: embed query, find capabilities with similar embeddings
4. Combine and rank by relevance
5. Filter by user-provided filters
6. Return top N results
```

### 6.3 Browse Interface

```
1. List roots: returns the 12 root capabilities
2. List children(path): returns direct children of a capability
3. Get capability(path): returns full capability details
4. Get providers(path): returns all registered providers for a capability
```

---

## Article VII: Capability Permissions

### 7.1 Permission Model

Agents are granted capability permissions, not tool permissions:

```typescript
interface CapabilityPermission {
  agent_id: AgentID;
  capability_path: CapabilityPath;
  scope: 'invoke' | 'provide' | 'admin';
  constraints?: {
    max_invocations_per_hour?: number;
    max_cost_per_day?: ResourceBudget;
    require_approval?: boolean;        // Human approval needed for this capability
    input_restrictions?: JSONSchema;   // Additional input validation
  };
  granted_by: AgentID;
  granted_at: ISO8601;
  expires_at?: ISO8601;
}
```

### 7.2 Inheritance Rules

- Permission on a parent capability grants permission on all children
- Permission can be overridden at child level (e.g., grant `create.*` but deny `create.code.exec`)
- `admin` scope can grant/revoke permissions for that capability subtree
- `provide` scope allows the agent to register as a provider
- `invoke` scope allows the agent to use the capability

### 7.3 Approval Flow

```
1. Agent invokes capability with require_approval: true
2. Invocation enters 'pending_approval' state
3. Approval request sent to designated approver (human or Chief agent)
4. Approver reviews: input, capability, cost estimate, requesting agent
5. Approver approves or rejects
6. If approved: invocation proceeds normally
7. If rejected: invocation cancelled, agent notified with reason
8. Approval timeout: 5 minutes (configurable); default = reject
```

---

## Article VIII: Capability Versioning

### 8.1 Version Rules

- Capabilities use Semantic Versioning (SemVer)
- Breaking changes to input_schema or output_schema require a MAJOR version bump
- New optional fields in schemas are MINOR bumps
- Bug fixes and metadata changes are PATCH bumps
- Multiple versions CAN coexist; providers declare supported versions
- Resolution respects version constraints in the request

### 8.2 Deprecation

```typescript
interface CapabilityDeprecation {
  capability_path: CapabilityPath;
  deprecated_since: string;           // Version that deprecated it
  replacement?: CapabilityPath;       // What to use instead
  sunset_date: ISO8601;              // When this capability will be removed
  migration_guide?: string;           // URL or inline guide
}
```

- Deprecated capabilities still work but log warnings
- After sunset_date, capability is removed from the graph
- Providers for deprecated capabilities are notified 30 days before sunset
- Resolution algorithm warns when returning a deprecated capability

---

## Article IX: Dynamic Capability Registration

### 9.1 Runtime Registration

Agents can register new capabilities at runtime:

```
1. Agent discovers it can do something not in the graph
2. Agent sends capability.register with:
   a. Proposed capability path (under a root)
   b. Input/output schemas
   c. Self as provider
3. Graph validates path doesn't conflict with existing capabilities
4. If path is new:
   a. Must have a valid parent (or be directly under a root)
   b. Added to taxonomy
5. Provider registration completed
6. Capability immediately available for resolution
```

### 9.2 Capability Marketplace (Future)

- Agents can advertise capabilities to other workspaces
- Capability quality is measured by success_rate, reliability, reviews
- Reputation system: agents that provide reliable capabilities get more work
- Economic model: capability providers earn RU/MU based on usage

---

## Article X: Capability Health Monitoring

### 10.1 Health Checks

```typescript
interface CapabilityHealth {
  capability_path: CapabilityPath;
  providers: {
    provider_id: ProviderID;
    status: 'healthy' | 'degraded' | 'unhealthy' | 'offline';
    last_check: ISO8601;
    latency_ms: number;
    success_rate: number;           // Rolling 1-hour window
    error_rate: number;
  }[];
  overall_status: 'available' | 'degraded' | 'unavailable';
  last_updated: ISO8601;
}
```

### 10.2 Health Check Protocol

```
1. Every 60s (agent providers) or 300s (service providers):
   a. Send capability.health_check via ACP
   b. Provider responds with status
   c. If no response in 10s: mark provider 'offline'
2. Provider status transitions:
   - healthy → degraded: 2 consecutive slow responses (>2x avg latency)
   - degraded → unhealthy: success_rate drops below 0.5 in last 1 hour
   - unhealthy → offline: no response to health check
   - offline → healthy: responds to health check after recovery
3. Overall capability status:
   - available: at least 1 healthy provider
   - degraded: only degraded providers available
   - unavailable: no providers available
4. When capability becomes 'unavailable':
   a. Alert all agents with active invocations
   b. Alert Chief agents in affected workspaces
   c. Log to audit trail
```

---

## Article XI: Capability Caching

### 11.1 Caching Rules

- **Deterministic capabilities** (same input → same output): cache results
- **Non-deterministic capabilities** (e.g., `create.text`): no caching
- Cache key: SHA-256(capability_path + version + canonical_input)
- Cache TTL: defined per capability (default: 300 seconds)
- Cache invalidation: provider can send `capability.cache_invalidate`
- Cache size: bounded per workspace (default: 100MB)

### 11.2 Cache Bypass

- Caller can set `cache_bypass: true` in invocation options
- Required for capabilities with side effects (e.g., `actuate.deploy`)
- Graph validates: if capability has `side_effects: true`, caching is disabled

---

## Article XII: Resource Accounting

### 12.1 Per-Capability Resource Tracking

Every invocation consumes resources. The graph tracks:

```typescript
interface CapabilityResourceAccounting {
  capability_path: CapabilityPath;
  period: 'hourly' | 'daily';
  total_invocations: number;
  total_ru_consumed: number;
  total_mu_consumed: number;
  total_eu_consumed: number;
  total_vu_consumed: number;
  avg_latency_ms: number;
  p99_latency_ms: number;
  error_count: number;
  cost_by_provider: { provider_id: ProviderID; cost: ResourceBudget }[];
}
```

### 12.2 Budget Enforcement

- Before invocation: check workspace budget against estimated cost
- If estimated cost exceeds remaining budget: return `invovation.budget_exceeded`
- After invocation: deduct actual cost from workspace budget
- If actual cost exceeds estimate by >20%: flag for review (possible abuse)

---

## Article XIII: Inter-Workspace Capability Sharing

### 13.1 Sharing Model

- By default, capabilities are local to a workspace
- Capabilities can be published to project scope (all workspaces in a project)
- Capabilities can be published to enterprise scope (all projects)
- Publishing requires `admin` scope permission on the capability
- Consumer workspaces see published capabilities but must still have invoke permission

### 13.2 Cross-Workspace Invocation

```
1. Agent in Workspace A invokes capability hosted in Workspace B
2. Graph resolves provider (which is in Workspace B)
3. Check: does Workspace A have permission to invoke capabilities from Workspace B?
4. Check: does the requesting agent have capability_path permission?
5. If both checks pass: invoke via ACP inter-workspace channel
6. Results flow back through the same channel
7. Resource cost charged to Workspace A (requestor pays)
```

---

## Article XIV: Capability Events

### 14.1 Event Types

| Event | Trigger | Consumers |
|-------|---------|-----------|
| `capability.registered` | New capability/provider registered | Discovery services |
| `capability.unregistered` | Provider goes offline permanently | Active invocations |
| `capability.deprecated` | Capability marked deprecated | All agents using it |
| `capability.health_changed` | Provider health status change | Schedulers, dashboards |
| `capability.invoked` | Capability invocation started | Accounting, audit |
| `capability.completed` | Capability invocation completed | Accounting, callers |
| `capability.failed` | Capability invocation failed | Retry logic, alerts |
| `capability.cache_invalidated` | Cache entry invalidated | Cache layer |

### 14.2 Event Subscription

- Agents subscribe via `capability.subscribe(event_types, capability_path_filter)`
- Wildcard filter: `create.code.*` matches all children
- Events delivered via ACP with at-least-once guarantee
- Backpressure: slow consumers get a 1000-event buffer, then oldest events dropped

---

## Article XV: Graph Persistence

### 15.1 Storage

- Capability definitions: PostgreSQL (capability table with path, schema, metadata)
- Provider registrations: PostgreSQL (provider table with status, metrics)
- Invocation history: PostgreSQL (partitioned by month, retained 90 days)
- Capability embeddings (for semantic search): pgvector
- Cache: Redis (TTL-based eviction)

### 15.2 Indexes

```
- capability_path (unique, B-tree) — fast exact lookup
- capability_root (B-tree) — filter by root
- capability_tags (GIN) — tag-based search
- provider_capability_path (B-tree) — find providers for a capability
- provider_status (B-tree) — filter available providers
- invocation_capability_path_created (composite) — invocation history queries
```

---

## Article XVI: Conformance Requirements

### 16.1 Mandatory (Level 1)

A conforming AgentOS implementation MUST implement:
1. The 12 root capabilities in the taxonomy
2. Capability registration and unregistration
3. The resolution algorithm (exact match + parent fallback)
4. Capability invocation with permission checks
5. Provider health monitoring
6. Capability events

### 16.2 Recommended (Level 2)

A conforming implementation SHOULD implement:
1. Semantic search (Phase 3 of resolution)
2. Composite capabilities
3. Capability caching for deterministic capabilities
4. Capability versioning with deprecation
5. Resource accounting per capability

### 16.3 Optional (Level 3)

A conforming implementation MAY implement:
1. Cross-workspace capability sharing
2. Dynamic runtime capability registration
3. Capability marketplace
4. Streaming invocations
5. Approval flows

---

## Appendix A: Standard Capability Registry

These capabilities are pre-registered in every AgentOS deployment:

| Path | Type | Description |
|------|------|-------------|
| `compute.math.basic` | Kernel | Arithmetic (+, -, *, /, mod) |
| `compute.math.advanced` | Service | Trigonometry, calculus, linear algebra |
| `compute.encrypt.hash` | Kernel | SHA-256, SHA-512, blake3 |
| `compute.encrypt.sym` | Kernel | AES-256-GCM encryption/decryption |
| `compute.encrypt.asym` | Kernel | Ed25519 sign/verify |
| `reason.plan.hierarchical` | Agent | Decompose goals into task hierarchies |
| `reason.plan.sequential` | Agent | Order tasks by dependencies |
| `reason.infer.text` | Service | Text-based reasoning (LLM) |
| `reason.classify.category` | Agent | Classify items into categories |
| `reason.classify.sentiment` | Agent | Sentiment analysis |
| `remember.store.short` | Kernel | L1 working memory (in-process) |
| `remember.store.session` | Kernel | L2 session memory (Redis) |
| `remember.store.permanent` | Kernel | L3 persistent memory (PostgreSQL) |
| `remember.search.semantic` | Kernel | Vector similarity search |
| `remember.search.keyword` | Kernel | Full-text keyword search |
| `communicate.send.direct` | Kernel | ACP direct message |
| `communicate.send.broadcast` | Kernel | ACP broadcast message |
| `communicate.translate.text` | Service | Language translation |
| `perceive.vision.ocr` | Service | Image to text |
| `perceive.vision.classify` | Service | Image classification |
| `perceive.audio.transcribe` | Service | Speech to text |
| `perceive.text.read` | Kernel | Read and parse text/documents |
| `actuate.write.file` | Kernel | Write to filesystem |
| `actuate.write.database` | Kernel | Write to database |
| `actuate.build.compile` | Service | Compile source code |
| `actuate.deploy.container` | Service | Deploy Docker container |
| `navigate.filesystem.read` | Kernel | Read directory/file listings |
| `navigate.web.fetch` | Kernel | HTTP GET/POST |
| `navigate.codebase.search` | Agent | Code search (ripgrep, AST) |
| `create.code.typescript` | Agent | Generate TypeScript code |
| `create.code.python` | Agent | Generate Python code |
| `create.text.summary` | Agent | Summarize text |
| `create.text.translate` | Service | Translate text between languages |
| `create.image.generate` | Service | Generate images from prompts |
| `validate.test.unit` | Agent | Run unit tests |
| `validate.test.integration` | Agent | Run integration tests |
| `validate.review.code` | Agent | Code review |
| `validate.audit.security` | Agent | Security audit |
| `coordinate.schedule.task` | Kernel | Schedule task execution |
| `coordinate.allocate.resource` | Kernel | Allocate resources to agents |
| `coordinate.delegate.work` | Agent | Delegate tasks to workers |
| `secure.authenticate.token` | Kernel | JWT token auth |
| `secure.authenticate.oauth` | Kernel | OAuth2 PKCE flow |
| `secure.authorize.rbac` | Kernel | RBAC permission check |
| `secure.audit.log` | Kernel | Append to audit trail |
| `learn.feedback.record` | Kernel | Record feedback for learning |
| `learn.adapt.strategy` | Agent | Adapt strategy based on outcomes |

---

## Appendix B: Error Codes

| Code | Description |
|------|-------------|
| CG-E001 | Capability not found |
| CG-E002 | No provider available |
| CG-E003 | Provider offline |
| CG-E004 | Permission denied (no invoke permission) |
| CG-E005 | Input validation failed (schema mismatch) |
| CG-E006 | Output validation failed (schema mismatch) |
| CG-E007 | Invocation timeout |
| CG-E008 | Budget exceeded |
| CG-E009 | Rate limit exceeded |
| CG-E010 | Capability deprecated |
| CG-E011 | Version not supported |
| CG-E012 | Approval required |
| CG-E013 | Composite pipeline step failed |
| CG-E014 | Registration conflict (path already taken) |
| CG-E015 | Invalid capability path syntax |
| CG-E016 | Health check failed |
| CG-E017 | Cache miss (informational, not an error) |

---

*The Capability Graph is how AgentOS escapes the application trap. No more "which tool do I use?" — the graph knows. Every tool, every model, every API, every skill is a capability with a path, a schema, a provider, and a resolution algorithm. This is the POSIX of intelligent workforces.*

**Ratified**: 2026-06-06  
**Signatories**: Chief Architect, AI Architect, Systems Architect