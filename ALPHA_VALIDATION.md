# AgentOS Alpha Validation Program

**Status**: Active — supersedes platform construction as primary objective
**Date**: 2026-06-23
**Authority**: Chief Architect directive

---

## 1. Definition of AgentOS Alpha

AgentOS Alpha is NOT defined by the existence of packages or passing tests.
AgentOS Alpha is achieved when **a user can provide a meaningful objective,
walk away, and reliably receive a validated outcome** generated through:

- Browser capabilities (HTTP + Playwright)
- Desktop capabilities (Native + NutJS + UIAutomation + OCR)
- Memory retrieval (L1–L4 tiered)
- Agent coordination (Chief → Manager → Worker → Validator)
- Offline-aware execution (Mode Controller + Inference Router + Queue)
- Security-governed workflows (9 pre-invoke + 5 post-invoke checks)

While remaining fully **observable** (Mission Control real-time console) and
**auditable** (SHA-256 hash-chained EventStore).

**The single evaluation question for every architectural decision:**
> Does it improve AgentOS's ability to autonomously complete real-world work?

---

## 2. Alpha Program: 100 Benchmark Workflows

### 2.1 Benchmark Categories (10 categories × 10 workflows each)

| # | Category | Description | Stack Coverage |
|---|----------|-------------|----------------|
| 1 | Market Research | Industry analysis, trend identification, market sizing, competitor pricing | Browser, Memory, Swarm, LLM, Security, EventStore, Mission Control |
| 2 | Competitive Intelligence | Competitor feature comparison, pricing matrix, SWOT analysis, positioning | Browser, Memory, Swarm, LLM, Security, EventStore, Mission Control |
| 3 | Document Generation | Reports, proposals, specifications, summaries, formatted documents | Swarm, LLM, Memory, Capabilities (filesystem), EventStore, Mission Control |
| 4 | Browser Automation | Form filling, data scraping, login flows, multi-page navigation, screenshot capture | Browser, Swarm, LLM, Security, EventStore, Mission Control |
| 5 | Desktop Automation | Window management, file operations, application control, screen reading | Desktop, Swarm, LLM, Security, EventStore, Mission Control |
| 6 | File Management | Organize, rename, categorize, deduplicate, archive file collections | Capabilities (filesystem), Swarm, Memory, EventStore, Mission Control |
| 7 | Project Planning | Task decomposition, timeline generation, resource estimation, risk assessment | Swarm, LLM, Memory, Capabilities, EventStore, Mission Control |
| 8 | Reporting | Data aggregation, analysis, visualization, formatted output | Swarm, LLM, Memory, Capabilities, EventStore, Mission Control |
| 9 | Data Collection | Web scraping, API polling, structured extraction, database queries | Browser, Capabilities (HTTP), Swarm, Memory, EventStore, Mission Control |
| 10 | Multi-Step Business Processes | End-to-end workflows combining multiple capabilities (research → analyze → report → deliver) | Full stack + Offline |

### 2.2 Benchmark Execution Requirements

Every benchmark MUST exercise the complete stack:

1. **Chief Agent** receives the goal and decomposes into workstreams
2. **Manager Agents** decompose workstreams into tasks on the Blackboard
3. **Worker Agents** claim and execute tasks using capabilities
4. **Validator Agents** verify results via consensus (default: majority)
5. **ACP** carries all inter-agent messages (signed, routed, delivered)
6. **Blackboard** coordinates task claims, results, context, consensus
7. **Resource Scheduler** allocates RU/MU/EU/VU with budget enforcement
8. **Memory Engine** stores/retrieves context across L1–L4 tiers
9. **Capability Runtime** resolves and invokes provider-backed abilities
10. **Browser Runtime** or **Desktop Runtime** executes interface operations
11. **Security Hypervisor** runs 9 pre-invoke + 5 post-invoke checks per call
12. **EventStore** captures every state transition with SHA-256 hash chain
13. **Mission Control** provides real-time observability
14. **Offline Runtime** handles connectivity loss/recovery when applicable

### 2.3 Benchmark Metrics (7 required measurements per benchmark)

| Metric | Description | Measurement Method |
|--------|-------------|-------------------|
| **Completion Rate** | % of tasks that reach terminal `completed` state | TaskRegistry state count / total tasks |
| **Latency** | Wall-clock time from goal submission to validated result | Simulation clock or real timestamp delta |
| **Resource Consumption** | RU/MU/EU/VU consumed vs allocated | ResourceScheduler consumption report |
| **Validation Accuracy** | % of Validator approvals that are correct (no false positives) | SimulationVerifier cross-check against expected output |
| **Human Intervention Rate** | % of benchmarks requiring manual intervention | Approval gate trigger count / total benchmarks |
| **Recovery Success** | % of injected failures that the system recovered from without manual intervention | Failure injection + recovery detection |
| **Constitutional Compliance** | % of invariants that held throughout execution | InvariantChecker 10-invariant sweep + AuditChain verification |

### 2.4 Benchmark Specification Format

Each benchmark is defined as a TypeScript specification:

```typescript
interface BenchmarkSpec {
  id: string;                          // e.g., "MR-001"
  category: BenchmarkCategory;        // e.g., "market-research"
  title: string;                       // Human-readable name
  objective: string;                   // User-facing goal statement
  expectedOutput: BenchmarkOutputSpec; // Expected result shape
  capabilities: string[];               // Required capability paths
  stackComponents: StackComponent[];   // Which subsystems must be exercised
  injectFailures?: FailureInjection[];  // Optional failures to inject
  injectOffline?: OfflineScenario;     // Optional connectivity disruption
  budget: ResourceBudget;               // Resource budget for the benchmark
  timeout: number;                      // Max execution time (ms)
  validationCriteria: ValidationCriteria; // How to verify the result
  humanInterventionExpected: boolean;   // Whether approval gates are expected
}
```

### 2.5 Benchmark Execution Harness

The benchmark harness (`@agentos/benchmarks` — new package) provides:

1. **BenchmarkRunner** — orchestrates a single benchmark through the full stack
2. **BenchmarkSuite** — runs all 100 benchmarks, collects metrics, generates report
3. **FailureInjector** — injects agent crashes, network drops, resource exhaustion
4. **OfflineSimulator** — toggles connectivity during benchmark execution
5. **MetricsCollector** — gathers the 7 required metrics per benchmark
6. **BenchmarkReporter** — produces structured output (JSON + human-readable)
7. **BenchmarkVerifier** — validates results against expected outputs

### 2.6 Benchmark Categories in Detail

#### Category 1: Market Research (MR-001 through MR-010)
- Industry landscape analysis with competitor identification
- Market sizing with TAM/SAM/SOM estimation
- Trend analysis with timeline visualization data
- Customer segment analysis with demographic extraction
- Pricing model survey across competitors
- Regulatory environment scan
- Technology adoption curve analysis
- Market entry feasibility assessment
- Growth rate calculation with source verification
- Market opportunity ranking with scoring matrix

#### Category 2: Competitive Intelligence (CI-001 through CI-010)
- Feature comparison matrix across 5+ competitors
- Pricing tier analysis with discount detection
- SWOT analysis with evidence-backed claims
- Competitive positioning map (2-axis scoring)
- Product roadmap inference from public signals
- Customer sentiment analysis from review aggregation
- Partner ecosystem mapping
- Content strategy analysis (blog/SOC cadence)
- SEO/keyword competitive landscape
- Social media presence comparison with engagement metrics

#### Category 3: Document Generation (DG-001 through DG-010)
- Executive summary from research data
- Technical specification from requirements
- Business proposal from client brief
- Meeting notes from transcript input
- Policy document from regulatory text
- API documentation from code analysis
- User guide from feature list
- Status report from project data
- Risk assessment from scenario analysis
- Process documentation from workflow description

#### Category 4: Browser Automation (BA-001 through BA-010)
- Scrape product catalog from e-commerce site
- Fill registration form with structured data
- Navigate multi-page wizard and capture state
- Login flow with credential management
- Download files from authenticated portal
- Capture screenshots of responsive layouts
- Extract structured data from table-based report
- Monitor page for dynamic content changes
- Submit search query and parse results
- Handle cookie consent banner then proceed

#### Category 5: Desktop Automation (DA-001 through DA-010)
- Launch application and read window title
- File organization: create folders, move files by type
- Screenshot active window and extract text via OCR
- Open spreadsheet, read cell values, write summary
- Application switching with window state capture
- File search across directory tree with content filter
- Clipboard operation: copy from app A, paste into app B
- Dialog handling: dismiss modal, confirm action
- Desktop environment scan: list open windows, report state
- Automated form filling in desktop application

#### Category 6: File Management (FM-001 through FM-010)
- Organize 100+ files into category folders by extension
- Deduplicate files by content hash (SHA-256)
- Rename files by pattern (date-title convention)
- Archive old files (>90 days) into compressed bundle
- Scan directory tree and generate file inventory report
- Detect and report orphaned files (no references)
- Categorize documents by content type (invoice, contract, report)
- Merge duplicate directory structures
- Generate file permission audit report
- Create file manifest with checksums for integrity verification

#### Category 7: Project Planning (PP-001 through PP-010)
- Decompose software project into task hierarchy
- Generate Gantt chart data from milestone list
- Resource estimation for development team
- Risk assessment matrix with probability/impact scoring
- Sprint planning with capacity-based allocation
- Dependency chain analysis with critical path identification
- Effort estimation using story points from requirements
- Release roadmap with feature prioritization
- Team workload balancing across parallel workstreams
- Project recovery plan from status report

#### Category 8: Reporting (RP-001 through RP-010)
- Daily metrics dashboard from raw data
- Weekly summary with trend analysis
- Monthly performance report with KPIs
- Quarterly business review with recommendations
- Incident postmortem from event log
- Compliance audit report from checklist
- Financial summary from transaction data
- Operational health report from system metrics
- Customer satisfaction report from survey data
- Executive briefing from departmental inputs

#### Category 9: Data Collection (DC-001 through DC-010)
- Scrape company directory: name, address, phone, website
- Poll public API for updated records (paginated)
- Extract pricing data from multiple vendor sites
- Collect social media metrics across platforms
- Aggregate news articles by keyword with metadata
- Scrape job postings with structured extraction
- Collect product reviews with rating/sentiment
- Monitor RSS feeds for new entries
- Extract financial filings data (revenue, expenses, growth)
- Gather conference/session data from event site

#### Category 10: Multi-Step Business Processes (MS-001 through MS-010)
- Research competitor → analyze gaps → generate recommendation report
- Collect market data → size market → identify opportunities → create strategy doc
- Scrape product reviews → analyze sentiment → identify issues → recommend fixes
- Monitor competitor pricing → compare with internal → generate pricing recommendation
- Gather regulatory updates → assess impact → create compliance checklist
- Research industry trends → identify relevant technologies → create adoption roadmap
- Collect customer feedback → categorize issues → prioritize by severity → generate action plan
- Analyze website SEO → identify improvements → generate optimization plan → track changes
- Research acquisition target → analyze financials → assess fit → create due diligence report
- Monitor brand mentions → categorize sentiment → identify PR risks → generate response plan

---

## 3. Offline Runtime Completion (Batches 3–6)

### 3.1 Batch 3: Offline Execution Queue

**Package**: `@agentos/offline`
**Status**: Not yet implemented (types defined in `types.ts`)

**Deliverables**:
- `ExecutionQueue` class — durable, ordered, bounded queue
- Idempotency key tracking (kernel invariant #10)
- Correlation/causation ID preservation
- Backpressure mechanism (`OFF-0002` when queue full)
- Oldest-non-critical eviction policy
- Disk persistence (append-only log)
- Event emission: `system.queue.enqueued`, `system.queue.dequeued`, `system.queue.dropped`
- Integration with `InferenceRouter` (router enqueues when mode=OFFLINE and capability is online-only)

**Invariants enforced**:
- IQ-1: Every enqueued operation has a unique idempotency key
- IQ-2: Replay is exactly-once in effect (idempotent consumers)
- IQ-3: Queue has a bounded size (configurable, default 10,000)
- IQ-4: Enqueue/dequeue emits audit events to EventStore
- IQ-5: Backpressure prevents unbounded growth (reject with OFF-0002)

**Tests required**:
- Enqueue/dequeue ordering
- Idempotency key deduplication
- Backpressure (queue full → OFF-0002)
- Eviction of oldest non-critical when at capacity
- Disk persistence + recovery
- Event emission verification
- Integration with InferenceRouter (mode=OFFLINE → enqueue)

### 3.2 Batch 4: Artifact Cache + Memory Cache

**Package**: `@agentos/offline`
**Status**: Not yet implemented

**Deliverables**:
- `ArtifactCache` — content-addressed (SHA-256 key) store for capability outputs
  - `store(content): Promise<{ hash, size, path }>`
  - `retrieve(hash): Promise<Buffer | null>`
  - `exists(hash): Promise<boolean>`
  - `evictLRU(maxSize)`: evict least-recently-used artifacts over size limit
  - Offline-durable: persists to disk
  - `system.cache.artifact.stored`, `system.cache.artifact.evicted` events
- `MemoryCache` — offline-durable mirror of L1/L2 reads + write buffer
  - Read-through: intercepts L1/L2 reads, serves from cache when offline
  - Write buffer: queues `memory.store` calls for replay on reconnect
  - `get(key)`, `set(key, value)`, `flush()` (replay buffered writes to Memory Engine)
  - Offline detection: queries ModeController for current mode
  - `system.cache.memory.read`, `system.cache.memory.buffered`, `system.cache.memory.flushed` events

**Tests required**:
- Content-addressed store/retrieve (SHA-256 correctness)
- LRU eviction under size pressure
- Disk persistence + recovery
- Memory read-through when offline
- Memory write buffer + flush on reconnect
- Event emission verification
- Checksum verification (OFF-0005 on mismatch)

### 3.3 Batch 5: Sync Engine

**Package**: `@agentos/offline`
**Status**: Not yet implemented

**Deliverables**:
- `SyncEngine` — reconciles offline state with canonical EventStore
  - `reconcile()`: drain execution queue + replay buffered events + reconcile memory
  - Per-object-class conflict resolution (per ADR-008 R1):
    - Events: causal-order re-sequencing, never overwrite
    - Memory: merge by confidence × recency, `supersedes` relation
    - Task results: re-queue to `review` for Validator re-adjudication
    - Resource ledgers: additive merge by summation
  - `sync.applied`, `sync.skipped_duplicate`, `sync.conflict` events
  - Re-validation of queued external operations by Security Hypervisor (R7)
  - Blocks transition to ONLINE until queue is empty + reconciliation complete (invariant #5)

**Tests required**:
- Event replay in causal order
- Idempotent re-application (no duplicates)
- Memory merge by confidence × recency
- Task result re-queue to review
- Resource ledger summation merge
- Conflict detection + `sync.conflict` event emission
- Security re-validation of queued ops at drain time
- ONLINE transition blocked while queue non-empty (invariant #5)

### 3.4 Batch 6: Full Subsystem Integration + Simulation Chaos Track

**Package**: `@agentos/offline` + `@agentos/simulation`
**Status**: Not yet implemented

**Deliverables**:
- Wire Swarm to query ModeController before routing work
- Wire Memory Engine to use MemoryCache when offline
- Wire Capability Executor to check offline eligibility before invoking
- Wire LLM client to route through InferenceRouter
- Wire Security Hypervisor to enforce R7 (re-validate at drain)
- Add connectivity-chaos track to Simulation:
  - `ConnectivityChaosTrack` — injects connectivity drops/restores during simulation
  - Verifies mode transitions are correct
  - Verifies offline work completes and reconciles
  - Verifies no invariant violations across mode transitions
  - Measures offline swarm sizing (R5) and backpressure

**Tests required**:
- Full stack integration: Swarm + Memory + Capabilities + LLM + Offline
- Connectivity chaos: 100-agent simulation with random connectivity drops
- Mode transition correctness under chaos
- Reconciliation after reconnect
- No invariant violations across mode transitions
- Offline swarm sizing enforcement (R5)

---

## 4. Reputation Engine and Agent Economy (Design Only)

**Status**: Architecture design (ADR-009), implementation deferred until benchmark telemetry is available.

### 4.1 Design Scope

- **Reputation Engine**: scores agents on quality, reliability, efficiency, and recovery
  - Per-mode scoring (online vs offline performance separated)
  - Per-capability scoring (agent may excel at browser, fail at desktop)
  - Confidence-weighted (more data = higher confidence in score)
  - Decay over time (recent performance weighted higher)
  - Derived from benchmark telemetry: completion rate, validation accuracy, resource efficiency

- **Agent Economy**: pricing and compensation for agent work
  - RU/MU/EU/VU as the internal currency (already defined in resource model)
  - Pricing per capability invocation (market-rate discovery from benchmarks)
  - Budget allocation as investment (Chiefs allocate budget to workstreams)
  - Value accounting (task value vs resource cost = profitability)
  - Insolvency handling (budget exhausted = task reassigned)

### 4.2 Deferal Rationale

The Reputation Engine and Agent Economy need real benchmark telemetry to calibrate:
- What capabilities are actually expensive vs cheap?
- What failure modes actually occur in practice?
- What quality thresholds produce useful validation?
- What resource ratios (RU:MU:EU:VU) reflect real workloads?

These questions are answered by the 100-benchmark program. Designing the
Reputation Engine before having this data would produce theoretical scoring
that doesn't match reality. The ADR will be written after Batch 1 of benchmarks
produces initial telemetry (target: 10 benchmarks completed).

---

## 5. Browser and Desktop Runtime Hardening

**Status**: Shift from feature expansion to hardening mode.

### 5.1 Browser Runtime Hardening

| Area | Current State | Hardening Target |
|------|---------------|-------------------|
| Reliability | Playwright lazy-init, graceful HTTP fallback | Add retry with exponential backoff, circuit breaker per host, timeout enforcement |
| Observability | Session pool status | Per-session health, per-request timing, error classification, recovery tracking |
| Recovery | Session eviction on failure | Auto-restart crashed browser, state preservation before eviction, session checkpoint/restore |
| Production Security | Security Hypervisor pre/post checks | CSP reporting, navigation whitelist enforcement, cookie isolation per workspace, download sandboxing |

**Specific work items**:
1. `BrowserSession.healthCheck()` — detect zombie sessions (process alive but unresponsive)
2. `BrowserPool.restartSession(workspaceId)` — crash recovery with state restoration
3. `BrowserSession.checkpoint()` / `BrowserSession.restore()` — save/restore cookies + localStorage
4. Per-host circuit breaker (failed host → skip for 60s, not retry forever)
5. Navigation timeout enforcement (configurable per-capability)
6. Cookie jar isolation enforcement (strict one-session-per-workspace)
7. Download sandboxing (scanned directory, size limit, MIME type allowlist)
8. Request-level observability hook (emit `browser.request.start` / `browser.request.end` events)

### 5.2 Desktop Runtime Hardening

| Area | Current State | Hardening Target |
|------|---------------|-------------------|
| Reliability | 4 strategies with fallback | Strategy health monitoring, auto-failover, stale detection |
| Observability | Session pool status | Per-action timing, OCR confidence reporting, window state snapshots |
| Recovery | Session eviction | Window state capture before eviction, application restart, focus restoration |
| Production Security | Security Hypervisor checks | Screen capture access control, clipboard isolation, key injection rate limit |

**Specific work items**:
1. `DesktopSession.healthCheck()` — detect stale sessions
2. `DesktopPool.restartSession(workspaceId)` — crash recovery
3. OCR confidence threshold enforcement (reject low-confidence extractions)
4. Window state checkpoint/restore (capture Z-order, focus, geometry)
5. Key injection rate limiting (max 100 keystrokes/sec, configurable)
6. Clipboard access logging + isolation (clear between workspace switches)
7. Screen capture access control (Security Hypervisor integration)
8. Action-level observability hook (emit `desktop.action.start` / `desktop.action.end` events)

---

## 6. Mission Control Evolution

**Status**: Evolve from periodic snapshot to real-time operational console.

### 6.1 Current State

`MissionControl` provides periodic `snapshot()` and `renderCompact()` — a polling-based
dashboard with sections for agents, tasks, resources, messages, workflows, deadlocks, and
validation. This is a status report, not an operational console.

### 6.2 Target State

Mission Control becomes a real-time event-driven console with:

1. **EventStream** — subscribes to EventBus, pushes events to console in real-time
   - Agent state transitions (color-coded: green=active, yellow=idle, red=errored)
   - Task state transitions (progress bar per workstream)
   - Resource allocation changes (gauge: allocated vs consumed per type)
   - ACP message traffic (per-second throughput, by type)
   - Capability execution events (latency, success/failure)
   - Security events (approval requests, anomalies, denials)
   - Mode transitions (ONLINE → HYBRID → OFFLINE with timestamp)
   - Workflow state tree (live update as tasks complete)

2. **AlertSystem** — threshold-based alerts with severity levels
   - P0: Resource exhaustion >100%, security breach detected
   - P1: Agent failure rate >20%, validation rejection >30%
   - P2: Resource utilization >80%, task backlog growing
   - P3: Minor anomalies, informational

3. **WorkflowVisualizer** — tree view of Goal → Workstream → Task hierarchy
   - Live state per node
   - Progress percentage
   - Resource consumption per node
   - Click-through to event history

4. **ACP TrafficMonitor** — real-time message flow visualization
   - Per-agent message rate
   - Per-channel throughput
   - Circuit breaker status
   - DLQ depth + alert if growing

5. **ResourceDashboard** — live resource allocation/consumption
   - RU/MU/EU/VU gauges (allocated vs consumed)
   - Per-workspace breakdown
   - Budget threshold warnings (80/95/100%)
   - Historical trend (last N ticks)

6. **SecurityConsole** — real-time security event stream
   - Pre-invoke denials (by check: policy, permission, rate, approval, input, concurrent, budget, sandbox)
   - Post-invoke anomalies (by type: output_size, duration, consumption, schema, audit)
   - Approval queue (pending approvals with age)
   - Incident severity classification

7. **OfflineConsole** — offline runtime status
   - Current ExecutionMode (large indicator: ONLINE/HYBRID/OFFLINE)
   - Queue depth (pending operations)
   - Sync status (reconciling / idle)
   - Local model registry status (available models, readiness, inference slots used/total)
   - Artifact cache stats (size, hit rate, eviction count)
   - Memory cache stats (buffered writes, read cache hit rate)

8. **ReplayMode** — replay any completed workflow from EventStore
   - Scrub through events chronologically
   - Inspect any agent/task/resource state at any point
   - Export replay as audit evidence

### 6.3 Implementation Plan

Mission Control evolution will be implemented as a new `@agentos/console` package
that builds on the existing `@agentos/swarm` MissionControl class:

- `EventStreamSubscriber` — subscribes to EventBus, filters, forwards to renderers
- `AlertEngine` — evaluates thresholds, emits alerts
- `WorkflowTreeBuilder` — builds live tree from task events
- `ACP TrafficMonitor` — subscribes to ACP message events
- `ResourceDashboardRenderer` — renders resource gauges from allocation events
- `SecurityEventRenderer` — renders security events from hypervisor audit log
- `OfflineStatusRenderer` — renders offline runtime status from mode/queue/sync events
- `ReplayController` — replays EventStore events with scrub/inspect

---

## 7. Execution Priorities

| Priority | Workstream | Rationale |
|----------|-----------|-----------|
| P0 | Benchmark harness + 10 initial benchmarks | Validates the platform can do real work |
| P0 | Offline Batch 3 (Execution Queue) | Required for offline-first differentiator |
| P1 | Offline Batch 4 (Caches) | Enables offline artifact/memory access |
| P1 | Browser/Desktop hardening | Required for reliable real-world execution |
| P1 | Mission Control real-time console | Required for observability requirement |
| P2 | Offline Batch 5 (Sync Engine) | Completes offline loop |
| P2 | Remaining 90 benchmarks | Full validation coverage |
| P2 | Offline Batch 6 (Integration) | Wires offline into all subsystems |
| P3 | Reputation Engine ADR-009 | Design after initial benchmark telemetry |
| P3 | Agent Economy design | Design after Reputation Engine scope |

---

## 8. Success Criteria

AgentOS Alpha is achieved when ALL of the following are true:

1. **100 benchmarks** are defined, executable, and produce structured metrics
2. **≥80% completion rate** across benchmarks (≥80/100 reach validated completion)
3. **Zero constitutional violations** across benchmark execution (InvariantChecker)
4. **Offline runtime** completes Batches 3–6 and benchmarks run in OFFLINE mode
5. **Mission Control** provides real-time visibility during benchmark execution
6. **Browser Runtime** completes browser benchmarks with ≥90% success rate
7. **Desktop Runtime** completes desktop benchmarks with ≥85% success rate
8. **Recovery success ≥90%** for injected failures during benchmarks
9. **Human intervention rate ≤10%** (≤10/100 benchmarks require manual approval)
10. **Full audit trail** verifiable via SHA-256 hash chain for every benchmark

---

## 9. Governance

This document supersedes the CHANGELOG "Pending" section as the authoritative roadmap.
All subsequent ADRs must reference this document's priorities.
The CHANGELOG continues to track released changes.

### Amendment Process

Changes to this document require:
1. Architect proposal
2. 1 architect + 1 maintainer approval
3. Update with version history entry

### Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-06-23 | Initial document — Alpha Validation Program definition |