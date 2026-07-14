# AgentOS Roadmap

This roadmap is transparent and honest. Dates are approximate. The architecture is frozen — no new subsystems will be added until Beta criteria are met.

## Current Status: v0.1.0-alpha (Developer Preview)

The core runtime is implemented and under active dogfooding. APIs, package structure, and internal behavior may change before Beta.

### What Works Today

- Deterministic kernel with 10 constitutional invariants
- ACP messaging (Ed25519 signed, 5 routing modes, 3 delivery guarantees)
- Event-sourced audit trail (SHA-256 hash chain)
- Blackboard coordination (7 sections, atomic task claiming)
- Resource scheduler (RU/MU/EU/VU, budget enforcement, fair-share)
- 4-tier memory engine (L1 Working, L2 Workspace, L3 Long-Term, L4 Knowledge Graph)
- Swarm runtime (Chief → Manager → Worker → Validator, 4 consensus strategies)
- Capability runtime (7-phase resolution, 5 provider types, security hypervisor)
- Browser runtime (Playwright + HTTP, 25 capability paths)
- Desktop runtime (4 strategies: Native/NutJS/UIAutomation/OCR)
- Offline runtime (connectivity monitoring, local model registry, execution queue, artifact cache, sync engine)
- Mission Control operational console (real-time monitoring, security audit, resource alerts)
- 100-benchmark suite passing in 3 modes (ONLINE/OFFLINE/CHAOS)
- Real-world task framework (11 tasks with actual API calls)
- 221+ tests passing
- 9 ADRs and 6 constitution documents

## Phase 1: Internal Dogfooding (Current)

**Goal**: Team members use AgentOS for daily work, collect telemetry, file friction reports.

- [ ] Internal dogfooding program launch
- [ ] Collect operational telemetry from real usage
- [ ] Fix top 10 friction points identified by dogfooders
- [ ] Polish "Hello, AgentOS" onboarding experience
- [ ] Global CLI entry point (`agentos` command)

## Phase 2: External Alpha (Next)

**Goal**: 5-10 trusted external users perform meaningful work with AgentOS.

- [ ] Package for distribution (npm publish or tarball)
- [ ] Docker container for self-hosted deployment
- [ ] External alpha program with trusted users
- [ ] Market research, document generation, file organization tasks
- [ ] Collect external feedback and telemetry
- [ ] Iterate on developer experience based on real usage
- [ ] Complete remaining stubs (embedding API, OCR strategy, browser workspace tracking)

## Phase 3: Beta Preparation

**Goal**: Stabilize APIs, grow community, prepare for broader adoption.

- [ ] API stability review — freeze public interfaces
- [ ] Reputation Engine implementation (ADR-009, driven by collected telemetry)
- [ ] Agent Economy implementation (ADR-009, pricing and scoring)
- [ ] MCP (Model Context Protocol) evolution
- [ ] Additional desktop hardening
- [ ] Performance optimization based on production telemetry
- [ ] Documentation polish and tutorials
- [ ] Community contribution process refinement

## Phase 4: Beta Release

**Goal**: Public Beta with stable APIs and backward compatibility commitments.

Beta transition criteria (defined in BETA_TRANSITION_CRITERIA.md):
- 95%+ task completion rate across 500+ real-world executions
- < 5% human intervention rate
- < 1s average capability resolution latency
- Zero constitutional violations in 1000 consecutive operations
- Stable public API with documented deprecation policy
- At least 3 external contributors with merged PRs
- Community engagement: 100+ GitHub stars, 10+ active issue contributors

## What Is NOT on the Roadmap

- We are not adding new platform subsystems during Alpha
- We are not committing to specific dates — quality and real-world feedback drive timing
- We are not promising backward compatibility until Beta

## How to Influence the Roadmap

1. File issues with the `architecture-discussion` label
2. Open discussions in GitHub Discussions
3. Run AgentOS and report friction points
4. Contribute capability providers for new tools/services

The roadmap is shaped by real usage, not theoretical planning. Your feedback directly influences what we build next.