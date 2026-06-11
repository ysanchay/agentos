# ADR-002: Capability Graph

**Status**: Accepted

**Date**: 2026-06-11

**Constitution Reference**: `docs/constitution/capability-graph-v1.md` (ratified 2026-06-06)

## Context

In agent systems, functionality must be invoked as discrete, addressable abilities,
not through "opening" applications. Without a unified capability system, agents
hard-code tool integrations (brittle provider dependencies), cannot discover what
the system can do (tight coupling), and cannot compose capabilities (custom glue
code for every pipeline).

Existing frameworks use flat tool lists: LangChain "tools," AutoGen "function
calling," MCP "resources and prompts." These lack hierarchy, resolution,
permissions, and composability. They work for single-agent demos but not for an
operating system with hundreds of capabilities.

The Capability Graph constitution establishes capability-centric computing:
"Instead of 'which app do I open?', the question becomes 'which capability do I
need?'"

## Decision

We adopt the Capability Graph as defined in `capability-graph-v1.md` as the
universal abstraction for addressing, resolving, and invoking every ability.
Key decisions:

### The 12 Root Capabilities

Every capability descends from one of 12 roots: Compute, Reason, Remember,
Communicate, Perceive, Actuate, Navigate, Create, Validate, Coordinate, Secure,
Learn. No capability exists outside this taxonomy. Path syntax is dot-separated,
max depth 6, max 128 chars (e.g., `create.code.typescript`).

### Five Provider Types

1. **Agent-hosted**: Agent implements natively (e.g., Chief provides
   `reason.plan.hierarchical`). Flexible but slower.
2. **Service-backed**: External API wrapper (e.g., OpenAI provides
   `reason.infer.text`). Fast but external dependency.
3. **Kernel-provided**: Built into Kernel (e.g., `coordinate.schedule`).
   Deterministic and always available.
4. **Composite**: Chains sub-capabilities (e.g., `create.code.review` =
   `perceive.text.read` + `validate.review.code`). Powerful but fragile.
5. **User-delegated**: Requires human approval (e.g.,
   `actuate.deploy.production`). Quality depends on human judgment.

### Seven-Phase Resolution Algorithm

1. **Exact Match**: Find providers for exact path. If found, skip to Phase 5.
2. **Parent Fallback**: Walk up taxonomy tree (`create.code.typescript` ->
   `create.code` -> `create`).
3. **Semantic Match**: Vector similarity on tags/descriptions (threshold > 0.8).
4. **Composite Resolution**: Decompose into available sub-capabilities.
5. **Constraint Filtering**: Filter by status, latency, cost, reliability, load.
6. **Scoring/Ranking**: `score = w_l*(1/latency) + w_c*(1/cost) + w_r*reliability
   + w_q*quality`. Five profiles: latency, cost, reliability, quality, balanced.
7. **Selection**: Top-ranked provider. Tiebreak: agent-hosted > kernel >
   service-backed > composite.

### Permission Inheritance

Grant on parent cascades to children. Explicit deny on child overrides inherited
grant. Three scopes: `invoke` (use), `provide` (register as provider), `admin`
(manage subtree).

### Streaming Invocations

Long-running capabilities stream chunks via ACP `capability.stream` messages.
Heartbeat chunks every 30s prevent timeout. Error chunks terminate early.

### Capability Caching

Deterministic capabilities cached with SHA-256 key (path + version + input).
Default TTL 300s. Non-deterministic capabilities never cached. `side_effects:
true` disables caching. Providers can send `capability.cache_invalidate`.

### Health Monitoring

Agent-hosted providers: health check every 60s. Service-backed: every 300s.
Transitions: healthy -> degraded (2 slow responses) -> unhealthy (success_rate
< 0.5) -> offline (no response). Unavailable capabilities alert active agents
and Chief agents.

## Consequences

### Positive

- **Decoupled agents and tools**: Agents request by path, not provider. Resolution
  handles selection. External API down? Fall back to agent-hosted or composite.
- **Discoverable by default**: 12-root taxonomy and search interface let agents find
  capabilities at runtime. Need OCR? Request `perceive.vision.ocr`.
- **Composable capabilities**: Composite providers chain sub-capabilities without
  custom glue. Each step independently improvable.
- **Permission granularity**: Inheritance allows broad grants (`create.*`) with
  narrow denies (`create.code.exec`).
- **Transparent quality**: Provider metrics feed resolution scoring. Reliable
  providers get more work -- natural reputation system.

### Negative

- **Resolution complexity**: Phase 3 (semantic match) requires vector embeddings
  and pgvector infrastructure. Overkill for simple deployments.
- **Taxonomy maintenance**: 12 roots are fixed; the tree beneath grows via runtime
  registration. Without curation, overlapping capabilities and orphaned paths
  accumulate. Governance process needed.
- **Composite fragility**: Pipeline is only as reliable as its weakest step.
  `fail_fast` aborts everything; `skip_and_continue` degrades results.
- **Cache coherence**: Deterministic/non-deterministic boundary is not always clear.
  A capability reading from a database is deterministic until the database changes.
  300s TTL is a heuristic.

### Risks and Mitigations

- **Resolution latency**: Cache resolution results for frequent paths. InMemory
  store can cache provider lookups.
- **Provider monopolization**: Resolution returns top 3 alternatives. Scoring can
  penalize high-load providers.
- **Taxonomy drift**: Registration validates path conflicts and requires valid
  parent. `admin` scope permission gates registration.