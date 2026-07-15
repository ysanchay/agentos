# AgentOS — Goal-Based Operating System for AI Agent Workforces

> **Status: AgentOS is in v0.1.0-alpha (Developer Preview).** The core runtime is implemented and under active dogfooding. APIs, package structure, and internal behavior may change before Beta. We welcome contributors, feedback, bug reports, and architecture discussions.

AgentOS is a production-grade operating system for autonomous AI agent swarms. You give it a goal — it spawns agents, coordinates them through a deterministic kernel, routes work through a capability graph, executes via browser/desktop/LLM providers, and returns a validated outcome. Everything is observable through Mission Control, auditable through an event-sourced hash chain, and secure through Ed25519-signed messaging and a 6-layer security hypervisor.

## Why does it exist?

Existing agent frameworks are thin orchestration layers. They lack:

- Deterministic execution guarantees (agents race, states corrupt, retries duplicate work)
- Resource accounting (no budgets, no quotas, no fair-share scheduling)
- Offline operation (agents stop working when the network drops)
- Audit trails (no cryptographic proof of what happened and when)
- Security boundaries (agents can access anything, communicate through any channel)

AgentOS solves these. It is an operating system, not a framework. Agents run inside a kernel that enforces invariants the same way an OS kernel enforces memory protection.

## How is it different?

```
User Goal
    │
    ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Kernel     │────▶│  ACP Protocol │────▶│  Capability Graph │
│ (deterministic│     │ (Ed25519      │     │ (7-phase resolution│
│  10 invariants)     │  signed msgs) │     │  5 provider types) │
└──────┬───────┘     └──────────────┘     └────────┬─────────┘
       │                                             │
       ▼                                             ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Swarm       │────▶│  Blackboard   │────▶│  Security         │
│  Runtime     │     │  (task coord) │     │  Hypervisor       │
│  Chief→Mgr→  │     │  7 sections   │     │  (6-layer defense)│
│  Worker→Val  │     │  atomic claim │     │  pre+post checks  │
└──────┬───────┘     └──────────────┘     └──────────────────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Memory      │     │  Resource     │     │  Offline Runtime  │
│  L1-L4 tiers │     │  Scheduler    │     │  (queue, cache,   │
│  Knowledge   │     │  RU/MU/EU/VU  │     │   sync, local     │
│  Graph       │     │  budgets      │     │   models)         │
└─────────────┘     └──────────────┘     └──────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Mission Control                          │
│  Real-time observability · Security audit · Resource alerts │
│  Event timeline · Performance analytics                     │
└─────────────────────────────────────────────────────────────┘
```

Every layer is a package. Every package is tested. Every state transition is audited.

## Quick Start

```bash
# Clone
git clone https://github.com/nousresearch/agentos.git
cd agentos

# Install
pnpm install

# Build
pnpm build

# Run the Hello AgentOS demo (spawns agents, runs a benchmark, prints a report)
pnpm hello

# Run all tests (221+ across 15 packages)
pnpm test

# Run the 100-benchmark suite in all 3 modes
npx tsx packages/benchmarks/src/cli/run-three-modes.ts

# Run real-world tasks (actual API calls, file operations)
npx tsx packages/benchmarks/src/cli/run-real-world.ts
```

**Prerequisites**: Node.js 20+, pnpm 9+. See [INSTALL.md](INSTALL.md) for full instructions.

## Hello AgentOS

The fastest way to understand AgentOS is to run the demo:

```bash
pnpm hello
```

This will:
1. Initialize the kernel and enforce all 10 constitutional invariants
2. Spawn a Chief Agent, Manager Agent, and Worker Agents
3. Execute a small benchmark task through the full stack
4. Validate the result through the Validator Agent
5. Print a Mission Control summary with telemetry

You should see output like:

```
╔══════════════════════════════════════════════╗
║           AgentOS — Hello Demo               ║
╠══════════════════════════════════════════════╣
║  Kernel:     INITIALIZED (10 invariants OK)  ║
║  Agents:     4 spawned (Chief+Mgr+2 Workers) ║
║  Task:       "Research and summarize X"      ║
║  ACP msgs:   12 signed, 12 verified          ║
║  Result:     VALIDATED                       ║
║  Duration:   1.2s                            ║
║  Violations: 0                               ║
╚══════════════════════════════════════════════╝
```

## Packages (15)

| Package | Purpose |
|---------|---------|
| @agentos/types | Constitutional type system, Zod schemas |
| @agentos/kernel | Deterministic runtime, 10 invariants, registries |
| @agentos/protocol | ACP messaging — Ed25519 signed, routed, encrypted |
| @agentos/eventstore | SHA-256 hash-chained event store |
| @agentos/blackboard | Task coordination, 7 sections, atomic claiming |
| @agentos/resources | Resource scheduler — RU/MU/EU/VU, budget enforcement |
| @agentos/memory | 4-tier memory — L1 Working → L4 Knowledge Graph |
| @agentos/swarm | Swarm runtime — Chief/Manager/Worker/Validator |
| @agentos/capabilities | 7-phase capability resolution, security hypervisor |
| @agentos/llm | LLM client, capability router, token tracker |
| @agentos/browser | Browser automation — Playwright + HTTP |
| @agentos/desktop | Desktop automation — 4 strategies |
| @agentos/offline | Offline runtime — queue, cache, sync, local models |
| @agentos/simulation | 100-agent simulation, verifier, reporter |
| @agentos/benchmarks | 100 benchmark specs, 3-mode runner, telemetry |

## Operating Modes

| Mode | Description |
|------|-------------|
| ONLINE | Full connectivity, cloud-first with local fallback |
| OFFLINE | No network, local-only models, operations queued |
| HYBRID | Partial connectivity, per-capability routing |

## Documentation

- [INSTALL.md](INSTALL.md) — Full installation guide
- [CONFIGURATION.md](CONFIGURATION.md) — All configuration options
- [ROADMAP.md](ROADMAP.md) — Transparent roadmap and current status
- [CONTRIBUTING.md](CONTRIBUTING.md) — How to contribute
- [docs/](docs/) — 9 ADRs and 6 constitution documents
- [ALPHA_FREEZE.md](ALPHA_FREEZE.md) — Architecture freeze declaration
- [INTERNAL_DOGFOODING.md](INTERNAL_DOGFOODING.md) — Dogfooding program

## Benchmarks

```
Metric                       ONLINE    OFFLINE    CHAOS
Completion Rate              100.0%    100.0%     100.0%
Avg Latency                  3358ms    3054ms     3057ms
Validation Accuracy           99.7%     99.7%      99.7%
Recovery Success             100.0%    100.0%     100.0%
Human Intervention             1.0%      1.0%       1.0%
Constitutional Violations       0         0          0
```

All four Alpha Success Criteria pass in all three operating modes.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Good first issues are labeled `good first issue`. Architecture discussions are labeled `architecture-discussion`.

## License

Apache License 2.0 — See [LICENSE](LICENSE).

## Community

- File issues for bugs, features, or architecture discussions
- See [SECURITY.md](SECURITY.md) for vulnerability reporting
- See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community standards

---
