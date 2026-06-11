# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-alpha] - 2026-06-11

### Added

#### Foundation Packages
- **@agentos/types** — Constitutional type system with Zod schemas for all 10 core objects, state machines, error codes, and event types
- **@agentos/protocol** — ACP (Agent Communication Protocol) with Ed25519 message signing, 5 routing modes, 3 delivery guarantees, 4 encryption tiers, heartbeat state machine, RPC with backpressure, and dead letter queue
- **@agentos/eventstore** — Immutable event stream with SHA-256 hash chain, 11 event domains, write-ahead persistence, and correlation/causation IDs for distributed tracing
- **@agentos/kernel** — Deterministic OS runtime with agent/task/workspace lifecycle state machines, dependency graph, event bus, permission engine, and 10 kernel invariants

#### Coordination Packages
- **@agentos/blackboard** — Shared coordination layer with 7 sections, atomic task claiming (9 states), read/write/upgrade locks, deadlock detection (4 strategies), and SHA-256 audit chain
- **@agentos/resources** — Resource management with 4 resource types (RU/MU/EU/VU), 7 allocation states, conservation invariants, fair-share scheduling, priority inversion prevention, and budget enforcement (80/95/100% thresholds)
- **@agentos/simulation** — 100-agent verification with CLI, deterministic clock, reporter, and verifier that validates constitutional architecture

#### Agent Packages
- **@agentos/llm** — LLM integration with capability router, token tracker (RU consumption mapping), and model-agnostic client
- **@agentos/memory** — Four-tier memory engine (L1 Working, L2 Workspace, L3 Long-Term, L4 Knowledge Graph) with auto-tiering, artifact generation, and graph traversal (BFS, shortest path)
- **@agentos/swarm** — Swarm runtime coordinating Chief/Manager/Worker/Validator agents via ACP messaging, Blackboard task coordination, 4 consensus strategies, Mission Control observability, and failure recovery
- **@agentos/capabilities** — Universal execution layer with 7-phase resolution algorithm, 5 provider types, MCP runtime, sandbox manager, security hypervisor (6 defense layers), and production/development policy modes

#### Interface Packages
- **@agentos/browser** — Browser automation runtime with HTTP + Playwright dual strategy, session pooling with expiry, 25 capability paths, and resource consumption tracking
- **@agentos/desktop** — Desktop automation runtime with Native + NutJS + UIAutomation + OCR strategies, window management, and capability bridge

#### Architecture & Governance
- 6 ratified constitution documents (ACP, Capability Graph, Resource Model, Blackboard Protocol, Threat Model, Kernel API)
- 7 Architecture Decision Records (ACP, Capability Graph, Resource Model, Event Sourcing, Security Hypervisor, Browser Strategy, Swarm Orchestration)
- Coverage thresholds enforced for all packages (80-90% for foundation, 65-80% for integration)
- Turborepo build pipeline with project references and topological ordering

### Tests
- 1,630+ tests across 13 packages (growing to 2,300+ with stabilization sprint)
- 94 test files covering unit, integration, and E2E benchmark scenarios
- Coverage thresholds: types/eventstore at 90%, protocol/kernel/blackboard/resources/simulation at 80%, newer packages at 75-80%

### Infrastructure
- pnpm 11.3.0 workspace with Turborepo 2.9.16
- TypeScript 5.8+ with strict mode, ESM modules, project references
- Vitest 4.1.8 with v8 coverage provider
- ESLint 9 with typescript-eslint strict config
- Docker Compose for PostgreSQL and Redis