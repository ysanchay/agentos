# Security Policy

## Supported Versions

AgentOS is in v0.1.0-alpha. Security fixes are applied to the latest `main` branch.

| Version | Supported |
|---------|-----------|
| main (alpha) | Yes |
| tagged releases | Yes |

## Reporting a Vulnerability

If you discover a security vulnerability in AgentOS, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: security@nousresearch.com

Include the following information:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

You will receive a response within 72 hours. If the vulnerability is confirmed, we will work on a fix and coordinate disclosure with you.

## Security Architecture

AgentOS includes a multi-layer security model documented in:
- `docs/adr/005-security-hypervisor.md` — Security Hypervisor architecture
- `docs/constitution/threat-model-v1.md` — Threat model and mitigations
- `docs/constitution/acp-v1.md` — Agent Communication Protocol (Ed25519 signing, encryption)

Key security features:
- All agent communication is Ed25519 signed (no unsigned messages accepted)
- 6-layer Security Hypervisor with pre-invoke and post-invoke checks
- Permission engine with workspace-scoped grants
- Sandboxed capability execution
- Constitutional invariants enforced at runtime (10 invariants, 0 violations in benchmarks)

## Disclosure Policy

- We follow coordinated disclosure
- Credit will be given to reporters (unless they prefer to remain anonymous)
- We request a 90-day disclosure window before public publication