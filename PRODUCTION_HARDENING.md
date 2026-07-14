# AgentOS Production Hardening Roadmap

**Effective Date**: 2026-06-23
**Authority**: Alpha Validation Program — transition from platform engineering to production validation
**Status**: Active — drives all engineering effort during Alpha

---

## 1. Audit Summary

**Production-readiness audit completed**: 2026-06-23

| Metric | Value | Assessment |
|--------|-------|------------|
| Total packages | 15 | All architecture-complete |
| Total source files | 166 | All real implementations |
| Total test files | 123 | Good coverage overall |
| TODO/FIXME markers | 4 | Very low — codebase is clean |
| Packages with README | 0/15 | CRITICAL GAP — zero per-package docs |
| Hardcoded secrets | 0 | Clean |
| Error handling ratio | 184 try/catch / 48 .catch / 258 async | Healthy |
| Constitutional invariants | 10/10 passing | Verified across 3 modes |

## 2. Critical Gaps (P0 — must fix before external alpha)

### 2.1 Documentation — Zero per-package READMEs
- Every package needs a README.md documenting: purpose, API surface, configuration, usage examples
- Root README.md is a 1-line stub — needs full project overview
- No user-facing installation or deployment documentation exists
- No API reference documentation exists

### 2.2 Embedding Provider Stub
- `capabilities/local-model-provider.ts` — handleEmbed() returns empty vector
- Blocks embedding-based memory retrieval in production
- Must implement real embedding API call or integrate a local embedding model

### 2.3 Configuration Externalization
- 4 hardcoded values that must be env-var overridable (see ALPHA_FREEZE.md §7)
- No .env file support, no configuration loading mechanism
- Production deployment requires configurable endpoints

## 3. High Priority (P1 — fix during early Alpha)

### 3.1 Real-World Task Framework
- Replace synthetic benchmark scenarios with actual capabilities:
  - Real HTTP requests to public APIs (weather, stocks, search)
  - Real file system operations (create, read, organize, archive)
  - Real browser automation (navigate, extract, interact)
  - Real document generation (write actual files)
- Each task must produce a verifiable artifact (file, data, report)

### 3.2 Production Telemetry Collection
- TelemetryCollector class that persists operational data to disk
- Per-task telemetry: capability usage, resource consumption, latency, validation, failures
- Per-session telemetry: total tasks, completion rate, user interventions
- Exportable as JSON for analysis and Reputation Engine calibration

### 3.3 Error Recovery Hardening
- Audit all async functions for unhandled edge cases
- Add circuit breakers to external API calls (browser, desktop, LLM)
- Implement retry with exponential backoff for transient failures
- Add timeout enforcement for all I/O operations

### 3.4 Test Coverage Expansion
- benchmarks package: 1 test file → needs integration tests
- types package: 2 test files → needs validation tests for all schemas
- offline package: 8 test files → needs integration test with real mode transitions
- simulation package: 6 test files → needs chaos track integration test

## 4. Medium Priority (P2 — improve during Alpha)

### 4.1 Browser Runtime Hardening
- Per-host circuit breaker (failed host → skip for 60s)
- Navigation timeout enforcement
- Cookie jar isolation enforcement
- Download sandboxing (size limit, MIME type allowlist)
- Session health check (detect zombie sessions)

### 4.2 Desktop Runtime Hardening
- OCR confidence threshold enforcement
- Key injection rate limiting
- Clipboard access logging + isolation
- Window state checkpoint/restore

### 4.3 Packaging and Distribution
- Create installable package (npm global or standalone binary)
- Setup wizard for first-time users
- Configuration file support (.agentos.yaml or similar)
- Health check command (agentos status)
- Version command (agentos version)

### 4.4 Developer Experience
- TypeScript declaration files published with each package
- Consistent error codes across all packages (KER-xxxx, OFF-xxxx, etc.)
- Structured logging with configurable levels
- Debug mode that traces all capability invocations

## 5. Low Priority (P3 — post-Alpha)

### 5.1 Performance Optimization
- Profile hot paths in kernel and event store
- Optimize event store query performance
- Add connection pooling for browser sessions
- LRU cache for frequently accessed memory entries

### 5.2 Security Hardening
- CSP reporting in browser runtime
- Screen capture access control in desktop runtime
- Sandboxed execution environments for untrusted capabilities
- Rate limiting at the security hypervisor level

### 5.3 Deployment Automation
- Docker container with all dependencies
- CI/CD pipeline for automated testing and release
- Health check endpoints
- Graceful shutdown handling

## 6. Alpha User Program

### 6.1 Target Users
- 5-10 trusted users for first external alpha
- Mix of technical and semi-technical users
- Each user performs real work in these categories:
  - Market research (real websites, real data)
  - Document generation (actual reports/specs)
  - File organization (their own file system)
  - Browser automation (real business processes)
  - Reporting (from their actual data)
  - Multi-step workflows (their real business tasks)

### 6.2 Success Metrics per User Session
- Task completion rate (target: ≥80%)
- User intervention rate (target: ≤20% for alpha, ≤10% for beta)
- Average task latency (no target — establish baseline)
- Security approval rate (target: 100% of requests checked)
- Offline transition count (establish baseline)
- Telemetry completeness (target: 100% of tasks have full telemetry)

### 6.3 Feedback Collection
- Per-task feedback form (simple: success/fail/partial + comment)
- Session-end survey (what worked, what didn't, what was confusing)
- Bug report channel (structured: steps, expected, actual, logs)
- Feature request channel (for post-Alpha prioritization)

## 7. Telemetry Schema for Reputation Engine Calibration

Each task execution must collect:

```typescript
interface TaskTelemetry {
  taskId: string;
  workspaceId: string;
  goalId: string;
  category: string;              // market-research, document-generation, etc.
  submittedAt: ISO8601;
  completedAt: ISO8601 | null;
  latencyMs: number;
  status: 'completed' | 'failed' | 'partial' | 'timeout';
  
  // Capability usage
  capabilitiesUsed: Array<{
    path: string;
    provider: string;
    latencyMs: number;
    success: boolean;
    resourceConsumption: { ru: number; mu: number; eu: number; vu: number };
  }>;
  
  // Agent coordination
  agentsInvolved: number;
  agentsByType: { chief: number; manager: number; worker: number; validator: number };
  
  // Validation
  validationResult: 'approved' | 'rejected' | 'partial';
  validationAccuracy: number;
  validationConfidence: number;
  
  // Failure and recovery
  failuresInjected: number;
  failuresRecovered: number;
  recoveryTimeMs: number;
  
  // Security
  securityChecksRun: number;
  securityChecksPassed: number;
  securityDenials: number;
  approvalGatesTriggered: number;
  
  // Offline
  modeTransitions: number;
  queueDepth: number;
  syncEvents: number;
  
  // User interaction
  userInterventions: number;
  interventionType: string | null;
  
  // Constitutional
  invariantViolations: number;
  constitutionalCompliance: number;
}
```

## 8. Priority Execution Order

| Phase | Duration | Focus | Deliverable |
|-------|----------|-------|-------------|
| Phase 1 | Week 1 | P0 fixes: docs, config externalization, embedding stub | Production-ready build |
| Phase 2 | Week 2 | Real-world task framework + telemetry collector | Working alpha tasks |
| Phase 3 | Week 3 | Internal dogfooding — team uses AgentOS for real work | Internal alpha report |
| Phase 4 | Week 4 | External alpha with 5-10 trusted users | User feedback + telemetry |
| Phase 5 | Week 5-6 | Reliability fixes from alpha feedback | Stable alpha release |
| Phase 6 | Week 7-8 | Reputation Engine ADR-009 design from telemetry | Reputation Engine spec |

## 9. Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-06-23 | Initial production hardening roadmap |