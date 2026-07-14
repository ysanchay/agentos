# AgentOS Alpha Architecture Freeze

**Effective Date**: 2026-06-23
**Authority**: Chief Architect directive — transition from platform engineering to Alpha validation
**Status**: ACTIVE — no major architectural changes permitted

---

## 1. Freeze Scope

Effective immediately, the following packages are under architecture freeze:

| Package | Status | Freeze Rationale |
|---------|--------|------------------|
| @agentos/types | FROZEN | Shared type system — all packages depend on this |
| @agentos/kernel | FROZEN | Deterministic runtime — 10 constitutional invariants verified |
| @agentos/eventstore | FROZEN | SHA-256 hash-chained EventStore — audit trail integrity |
| @agentos/blackboard | FROZEN | Task coordination — 7 sections, atomic claiming |
| @agentos/resources | FROZEN | Resource scheduler — RU/MU/EU/VU budget enforcement |
| @agentos/protocol | FROZEN | ACP messaging — signed, routed, delivered |
| @agentos/memory | FROZEN | L1-L4 tiered memory engine |
| @agentos/swarm | FROZEN | Swarm runtime — Chief/Manager/Worker/Validator |
| @agentos/capabilities | FROZEN | Capability runtime — 7-phase resolution, 5 provider types |
| @agentos/security | FROZEN | Security hypervisor — 9 pre-invoke + 5 post-invoke checks |
| @agentos/browser | FROZEN | Browser runtime — Playwright + HTTP fallback |
| @agentos/desktop | FROZEN | Desktop runtime — 4 strategies with fallback |
| @agentos/llm | FROZEN | LLM client + capability router |
| @agentos/offline | FROZEN | Offline runtime — Batches 1-6 complete |
| @agentos/simulation | FROZEN | Simulation environment |
| @agentos/benchmarks | FROZEN | 100-benchmark suite — 3-mode validation complete |

## 2. Allowed Changes

The following categories of changes are PERMITTED during Alpha:

### 2.1 Bug Fixes
- Any fix that resolves incorrect behavior, crashes, data loss, or invariant violations
- Must include a regression test
- Must not change the public API surface

### 2.2 Performance Improvements
- Internal optimization that does not change behavior or API
- Must be verified by benchmark suite (no regression in completion rate, latency, or compliance)
- Must include before/after telemetry

### 2.3 Observability Enhancements
- Additional metrics, logging, tracing, or dashboard improvements
- Must not change execution behavior
- Must not impact performance by more than 5%

### 2.4 Documentation
- README files, API docs, user guides, deployment guides
- Code comments and inline documentation
- Architecture decision records (ADRs) for observed patterns

### 2.5 Test Coverage Expansion
- New test files or additional test cases
- Integration tests for real-world scenarios
- Property-based tests for edge cases

### 2.6 Configuration Externalization
- Moving hardcoded values to configuration
- Adding environment variable support
- Must not change default behavior (only makes defaults overridable)

### 2.7 Dependency Updates
- Security patches (mandatory)
- Minor/patch version updates (with full test suite verification)
- Major version updates (require architect approval + migration plan)

## 3. Prohibited Changes

The following are PROHIBITED during Alpha:

1. New packages or sub-packages
2. New constitutional invariants
3. Changes to the Kernel API surface (public methods on Kernel class)
4. Changes to the EventStore interface (IEventStore)
5. Changes to the ACP message format
6. Changes to the Resource model (RU/MU/EU/VU)
7. New agent types beyond Chief/Manager/Worker/Validator
8. Changes to the Security Hypervisor check pipeline (9 pre + 5 post)
9. Changes to the Mode Controller transition logic
10. Changes to the Blackboard section model (7 sections)
11. Changes to the Capability resolution pipeline (7 phases)
12. Changes to the Memory tier model (L1-L4)

## 4. Exemption Process

Critical exemptions require:
1. Architect proposal with rationale
2. Impact analysis (which packages/tests are affected)
3. Migration plan (backward compatibility strategy)
4. 1 architect + 1 maintainer approval

## 5. Branch Strategy

- `main` — Alpha release branch, stability-prioritized
- `alpha-fix/*` — Bug fix branches merged to main
- `alpha-obs/*` — Observability improvement branches
- `alpha-docs/*` — Documentation branches
- `alpha-perf/*` — Performance optimization branches
- No feature branches targeting new capabilities

## 6. Known Stubs to Address During Alpha

These are existing stubs that should be completed during Alpha (not new features):

| Stub | Location | Priority | Impact |
|------|----------|----------|--------|
| Embedding API placeholder | capabilities/local-model-provider.ts | P1 | Blocks embedding-based memory retrieval |
| OCR strategy fallback | desktop/ocr-strategy.ts | P2 | Desktop text extraction limited |
| HTTP strategy screenshot placeholder | browser/http-strategy.ts | P3 | HTTP-only mode can't screenshot (by design) |
| Browser workspace tracking TODO | browser/browser-pool.ts | P2 | Session workspace isolation gap |

## 7. Configuration Externalization Targets

| Value | Location | Target |
|-------|----------|--------|
| httpbin.org health check URL | capabilities/http-provider.ts | AGENTOS_HEALTH_CHECK_URL env var |
| localhost:8080 LLM base URL | llm/types.ts | AGENTOS_LLM_BASE_URL env var |
| Benchmark timeout values | benchmarks/benchmark-specs.ts | Configurable per-spec in benchmark config |
| Swarm default config | swarm/swarm-coordinator.ts | AGENTOS_SWARM_* env vars |

## 8. Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-06-23 | Initial architecture freeze declaration |