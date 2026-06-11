# Contributing to AgentOS

Thank you for your interest in contributing to AgentOS! This document provides guidelines for development.

## Project Overview

AgentOS is a goal-based operating system for intelligent workforces, built as a 14-package TypeScript monorepo:

- **Foundation**: `types`, `protocol`, `eventstore`, `kernel`
- **Coordination**: `blackboard`, `resources`, `simulation`
- **Agent**: `llm`, `memory`, `swarm`, `capabilities`
- **Interface**: `browser`, `desktop`
- **Tools**: `tsconfig`, `eslint-config`

## Prerequisites

- Node.js 20+
- pnpm 8+ (`npm install -g pnpm`)
- Turbo (`pnpm add -g turbo`)

## Setup

```bash
git clone https://github.com/your-org/agentos.git
cd agentos
pnpm install
pnpm build
pnpm test
```

## Development Workflow

### Branch Naming

- `feat/` — new features (e.g., `feat/offline-runtime`)
- `fix/` — bug fixes (e.g., `fix/memory-eviction-race`)
- `docs/` — documentation (e.g., `docs/adr-008-offline`)
- `refactor/` — code restructuring

### Commit Conventions

We use conventional commits:
- `feat(scope): description` — new feature
- `fix(scope): description` — bug fix
- `docs(scope): description` — documentation
- `test(scope): description` — tests
- `refactor(scope): description` — refactoring
- `chore(scope): description` — maintenance

### Testing

All packages must maintain their coverage thresholds:

| Tier | Packages | Lines | Branches | Functions | Statements |
|------|----------|-------|----------|-----------|-------------|
| Foundation | types, eventstore | 90% | 90% | 90% | 90% |
| Core | protocol, kernel, blackboard, resources, simulation | 80% | 65% | 80% | 80% |
| Integration | memory, swarm, capabilities | 80% | 65% | 80% | 80% |
| Interface | browser, desktop, llm | 75% | 60% | 75% | 75% |

Run tests for a single package:
```bash
pnpm --filter @agentos/memory test
```

Run all tests:
```bash
pnpm test
```

Run with coverage:
```bash
pnpm test:unit
```

## Architecture Decision Records

All significant architectural decisions must be documented in `docs/adr/`. Use the Michael Nygard format:

```markdown
# ADR-NNN: Title

## Status

Accepted

## Context

What is the issue that we're seeing that is motivating this decision or change?

## Decision

What is the change that we're proposing and/or doing?

## Consequences

What becomes easier or more difficult to do because of this change?
```

Number ADRs sequentially (001, 002, ...). Reference the relevant constitution document when applicable.

## Constitution Amendment Process

AgentOS has 6 ratified constitution documents in `docs/constitution/`:
1. Kernel API v1
2. ACP v1
3. Resource Model v1
4. Blackboard Protocol v1
5. Capability Graph v1
6. Threat Model v1

Amendments require **2/3 architect approval**. All amendments must preserve existing invariants and conservation laws. To propose an amendment:

1. Create a branch: `docs/amendment-<name>`
2. Write the proposed changes with rationale
3. Submit for architect review
4. Upon approval, update the constitution document and add a version history entry

## Code Style

- TypeScript strict mode (enforced by `@agentos/tsconfig`)
- ESM modules (`.js` extensions in imports)
- ESLint with `@agentos/eslint-config` (typescript-eslint strict)
- `no-explicit-any: error`, `explicit-function-return-type: warn`, `consistent-type-imports: error`
- Prettier for formatting

## PR Checklist

Before submitting a pull request:

- [ ] All tests pass (`pnpm test`)
- [ ] Coverage thresholds maintained (`pnpm test:unit`)
- [ ] Type checking passes (`pnpm typecheck`)
- [ ] Linting passes (`pnpm lint`)
- [ ] ADR added for architectural changes
- [ ] Constitution references updated if behavior changes
- [ ] Changelog entry added for user-visible changes

## Release Process

AgentOS follows a phased release model:
1. **Alpha** — Feature-complete, internal testing, constitutional guarantees validated
2. **Beta** — External testing, stability hardening, performance optimization
3. **Stable** — Production-ready, documented, SLA commitments

The current release is **0.1.0-alpha**.