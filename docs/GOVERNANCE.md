# AgentOS Governance

## Roles

| Role | Description | Authority |
|------|-------------|-----------|
| **Architect** | Design authority for constitutional and architectural decisions | Constitutional amendment (2/3 approval), ADR approval, package API approval |
| **Maintainer** | Code quality and merge authority | PR review and merge, release management, CI/CD |
| **Contributor** | Code and documentation contributions | Submit PRs, report issues, propose features |

## Decision Tiers

### Tier 1: Constitutional (Highest Authority)
- **Scope**: Changes to the 6 ratified constitution documents
- **Process**: Proposal → 2/3 architect approval → Amendment document → Update
- **Examples**: Adding a new resource type, changing ACP message schema, modifying kernel invariants

### Tier 2: Architectural (ADR Required)
- **Scope**: Significant design decisions that affect multiple packages
- **Process**: ADR document → 1 architect + 1 maintainer approval → Implementation
- **Examples**: New package, new provider type, new capability root, new consensus strategy

### Tier 3: Implementation (PR Review)
- **Scope**: Code changes within existing architectural boundaries
- **Process**: PR → 1 maintainer review → Merge
- **Examples**: Bug fixes, new test cases, performance improvements, documentation

## Constitution Amendment Process

1. **Proposal**: Create a branch `docs/amendment-<name>` with proposed changes and rationale
2. **Discussion**: Architects review and discuss in the PR
3. **Vote**: 2/3 architect approval required
4. **Ratification**: Update the constitution document with version history entry
5. **Implementation**: Update all affected packages to comply with the amendment

All amendments **must** preserve existing invariants and conservation laws.

## Release Process

### Alpha (Current)
- Feature-complete but may have breaking changes
- Constitutional guarantees validated via simulation
- Coverage thresholds enforced per package tier
- No SLA commitments

### Beta (Planned)
- API stability commitment (no breaking changes without deprecation notice)
- Performance benchmarks established
- External testing with feedback loop
- Security audit completed

### Stable (Planned)
- Production-ready with SLA commitments
- Full documentation and API reference
- Performance guarantees
- Security audit passed
- 90%+ coverage across all packages

## Security Disclosure

Security vulnerabilities should be reported privately to the security team. Do not file public issues for security vulnerabilities.

**Severity levels and response times:**
- **P0 (Critical)**: Active exploitation, data breach → 5-minute initial response
- **P1 (High)**: Privilege escalation, data exfiltration → 1-hour initial response
- **P2 (Medium)**: DoS, information disclosure → 24-hour initial response
- **P3 (Low)**: Minor vulnerabilities → 72-hour initial response

## Package Ownership

Each package has a designated maintainer responsible for:
- Reviewing PRs affecting their package
- Maintaining coverage thresholds
- Ensuring constitutional compliance
- Triaging issues

## Meeting Cadence

- **Weekly**: Architecture review (all architects)
- **Bi-weekly**: Sprint planning and retrospective
- **Monthly**: Constitution review and amendment discussion