# ADR-005: Security Hypervisor

**Status**: Accepted

**Date**: 2026-06-11

**Deciders**: Security Architect, Chief Architect, Systems Architect

**Constitution Reference**: threat-model-v1.md (Articles I-XVIII), capability-graph-v1.md (Article VII)

---

## Context

AgentOS operates in a threat landscape fundamentally different from traditional software. When thousands of autonomous agents can read, write, reason, create, and actuate across shared infrastructure, a single compromised agent can poison memory, impersonate others, exfiltrate data, escalate privileges, and coordinate attacks across the entire workforce. The threat model constitution identifies 8 trust boundaries and classifies 23 STRIDE threats (8 CRITICAL, 8 HIGH, 4 MEDIUM).

The core problem: every capability invocation crosses at least one trust boundary. An agent requesting `actuate.shell.exec` crosses TB-2 (Agent to Kernel) and TB-5 (Agent to Capability). An agent reading from memory crosses TB-6 (Agent to Memory). Without a centralized enforcement layer, each capability provider would need to independently implement authentication, authorization, rate limiting, input validation, output validation, anomaly detection, and audit logging. This creates two risks:

1. **Inconsistent enforcement**: Different providers implement different subsets of the security controls, creating gaps that attackers can exploit by routing through the weakest provider.
2. **Duplication and drift**: Security logic scattered across every provider is impossible to audit, test, or update consistently.

The Security Hypervision must enforce the defense-in-depth architecture defined in the threat model (6 layers: Hardening, Authentication, Authorization, Containment, Detection, Governance) at the single choke point where every capability invocation passes.

### Trust Boundaries at Stake

| Boundary | Risk | Hypervisor Role |
|----------|------|-----------------|
| TB-1: User to AgentOS | Authentication bypass | Validate user identity before accepting goals |
| TB-2: Agent to Kernel | Privilege escalation | Per-call permission enforcement (D-E1.1) |
| TB-3: Agent to Agent | Message tampering | Signature verification on invocation requests |
| TB-4: Agent to Blackboard | Data poisoning | Permission checks on blackboard writes |
| TB-5: Agent to Capability | Capability abuse | Rate limits, budget, approval gates |
| TB-6: Agent to Memory | Memory poisoning | Budget limits on memory writes |
| TB-7: Agent to External | Data exfiltration | Output size monitoring, DLP flagging |
| TB-8: Workspace to Workspace | Lateral movement | Workspace isolation enforcement |

### Critical Threats the Hypervisor Must Mitigate

- **S1**: Agent Impersonation -- forged ACP messages (CRITICAL)
- **T1**: ACP Message Tampering -- modified messages in transit (CRITICAL)
- **T3**: Memory Tampering -- poisoned memory affecting all agents (CRITICAL)
- **I1**: Data Exfiltration -- sensitive data leaving via capabilities (CRITICAL)
- **E1**: Kernel Privilege Escalation -- agent modifying own permissions (CRITICAL)
- **E3**: Role Escalation -- worker promoting itself to chief (CRITICAL)
- **PI1**: Direct Prompt Injection -- attacker-controlled input (CRITICAL)
- **CA1/CA2**: Compromised Agent / Agent Botnet (CRITICAL)

---

## Decision

Implement a Security Hypervisor as a mandatory gateway that intercepts every capability invocation before it reaches a provider and after it returns. The hypervisor enforces 9 pre-invoke checks and 5 post-invoke anomaly checks, following the 6-layer defense architecture from the threat model constitution.

### Pre-Invoke Gate (9 Checks)

Every capability invocation must pass all 9 checks before the provider is called. A single denial stops execution and logs the event.

| # | Check | Threat Mitigated | Constitution Reference |
|---|-------|-------------------|----------------------|
| 1 | **Policy** | E1, E3 | Is this capability path allowed by the current security policy? Uses parent-fallback rule resolution (most-specific-first). |
| 2 | **Permission** | E2, I1 | Does the agent hold `invoke` permission for this capability path? Checks CapabilityPermission model (capability-graph-v1 Article VII). |
| 3 | **Rate Limit** | D1, D2, D3 | Has the agent exceeded per-capability invocation rate? Per-agent, per-path 1-hour sliding window. |
| 4 | **Approval** | PI1, E1 | Does this capability require explicit approval? Critical capabilities (`actuate.shell`, `actuate.filesystem.write`, `navigate.browser.goto`) require human or Chief approval before execution. |
| 5 | **Input Validation** | T2, PI1, PI2 | Does the input conform to the capability's `input_schema`? Size check against `maxInputSizeBytes`. |
| 6 | **Input Size** | D1 | Is input payload within maximum size limits? Prevents oversized payloads from consuming resources. |
| 7 | **Concurrent Invocations** | D1 | Is the agent within its `maxConcurrent` limit? Prevents resource exhaustion through parallel invocations. |
| 8 | **Budget** | D1, D3 | Does the agent have remaining RU/MU budget for this invocation? Hourly budget enforcement. |
| 9 | **Sandbox** | CA1, I1 | Is the invocation confined to the agent's workspace scope? Workspace isolation enforced at the hypervisor level. |

### Post-Invoke Anomaly Detection (5 Checks)

After every capability invocation (success or failure), the hypervisor runs anomaly detection. Anomalies do not block results but are logged and can trigger alerts or quarantine.

| # | Check | Threat Detected | Severity |
|---|-------|-----------------|----------|
| 1 | **Output Size** | I1 (exfiltration), D1 | HIGH if output exceeds `maxOutputSizeBytes` |
| 2 | **Duration** | CA1 (compromised agent) | MEDIUM if execution > 60 seconds |
| 3 | **Consumption** | D1, D3 | MEDIUM if total resource units > 1,000 per invocation |
| 4 | **Output Schema** | T2, PI1 | LOW if output is null/undefined when schema requires value |
| 5 | **Audit** | R1, R2 (repudiation) | Always: log invocation ID, capability path, agent ID, phase, result, anomalies, timestamp |

### Dual Policy Modes

The hypervisor supports two policy modes that control the `defaultAction` and approval requirements:

**Permissive Mode (Development)** -- `createDevelopmentPolicy()`:
- Default action: `allow` (everything permitted unless explicitly denied)
- No approval requirements
- High rate limits (10,000 invocations/hour global, 50 concurrent)
- High budget limits (100,000 RU/hour, 50,000 MU/hour)
- Large I/O limits (10MB input, 100MB output)
- No restricted capability paths

**Restrictive Mode (Production)** -- `createProductionPolicy()`:
- Default action: `deny` (nothing permitted unless explicitly allowed)
- Approval required for: `actuate.shell`, `actuate.filesystem.write`, `actuate.filesystem.delete`, `communicate.http.post`, `communicate.http.put`, `communicate.http.delete`, `navigate.browser.goto`, `navigate.browser.click`, `navigate.browser.type`, `navigate.browser.select`, `actuate.desktop`
- Restricted namespace: `actuate.dangerous` (always denied)
- Lower rate limits (1,000 invocations/hour global, 10 concurrent)
- Lower budget limits (5,000 RU/hour, 2,000 MU/hour)
- Strict I/O limits (1MB input, 10MB output)

### Cryptographic Standards

Per threat model constitution Article XVII:

| Purpose | Algorithm | Key Size |
|---------|-----------|----------|
| Message signing | Ed25519 | 256-bit |
| Symmetric encryption | AES-256-GCM | 256-bit |
| Key exchange | X25519 | 256-bit |
| Hashing | SHA-256 | 256-bit |
| Transport | TLS 1.3 | -- |

### Audit Trail

Every pre-invoke check and post-invoke anomaly is recorded in an append-only audit log. Each entry contains:

- `invocationId`: Unique invocation identifier
- `capabilityPath`: The capability being invoked
- `agentId`: The requesting agent
- `phase`: `pre` or `post`
- `result`: `allowed`, `denied`, `completed`, or `failed`
- `anomalies`: Array of detected anomalies (post-invoke only)
- `timestamp`: Epoch milliseconds

The audit log forms a hash chain (SHA-256) for tamper detection, as required by threat model defense D-R1.1.

### Incident Response Integration

The hypervisor maps detected anomalies to the incident severity framework from threat model Article XV:

| Severity | Criteria | Response Time | Example |
|----------|----------|---------------|---------|
| P0 CRITICAL | Active botnet, data exfiltration in progress | <5 min | CA2: Multiple agents with correlated anomalies |
| P1 HIGH | Confirmed privilege escalation, impersonation | <15 min | E1: Agent attempting permission modification |
| P2 MEDIUM | Suspicious behavior, unusual resource patterns | <1 hour | I1: Agent reading far outside task scope |
| P3 LOW | Minor anomalies, likely false positives | <24 hours | D1: Slight budget overconsumption |

---

## Consequences

### Positive

- **Single choke point**: Every capability invocation passes through one enforcement layer. No invocation can bypass security by going through a provider that lacks controls.
- **Constitution compliance**: The hypervisor directly implements Articles XIII and XVIII of the threat model constitution. Every threat in the STRIDE catalog maps to at least one hypervisor check.
- **Mode flexibility**: Development mode allows rapid iteration without approval friction. Production mode enforces deny-by-default with explicit allowlists. Switching is a single configuration change, not a code change.
- **Auditability**: The append-only audit log with hash chain provides non-repudiation for every invocation. This satisfies defenses D-R1.1 through D-R1.5 from the threat model.
- **Defense in depth**: Even if an agent is compromised (CA1), the hypervisor limits blast radius through workspace isolation, budget limits, and rate limits. A compromised agent cannot consume all system resources or escalate privileges.
- **Testable security**: Each of the 14 checks is independently testable. The constitution mandates per-release security tests for authentication bypass, permission escalation, message signing, resource exhaustion, input validation, and replay resistance.

### Negative

- **Invocation latency**: Every capability call now has a pre-invoke overhead (policy lookup, rate limit check, budget check) and post-invoke overhead (anomaly detection, audit logging). For hot-path capabilities called thousands of times per second, this adds measurable latency. Mitigation: pre-invoke checks are all in-memory Map lookups (O(1) average). Post-invoke checks are lightweight comparisons.
- **Policy complexity**: The deny-by-default production policy requires explicit allowlists for every capability path. As the capability graph grows, the policy must be maintained in lockstep. A new capability that is not added to the allowlist is silently denied. Mitigation: the development policy allows all capabilities, so new capabilities work immediately in dev. Production policy updates are part of the release checklist.
- **Approval bottleneck**: Critical capabilities require explicit approval. In a swarm of 1,000 workers, 50 of whom need shell access simultaneously, the approval queue becomes a bottleneck. Mitigation: approval can be pre-granted (approval stored in `pendingApprovals` map before invocation). Batch approval for common workflows is supported.
- **Single point of failure**: If the hypervisor crashes or becomes unavailable, no capability invocations can proceed. The entire system halts. Mitigation: the hypervisor is intentionally simple (no external dependencies, no network calls). It fails closed -- if the hypervisor is down, invocations are denied, which is the correct security posture for production.
- **Memory usage**: Rate limit tracking, budget tracking, and audit logs are held in memory. For a swarm running 10,000 agents over 24 hours, the rate limit map grows proportionally. Mitigation: 1-hour sliding windows cause stale entries to be overwritten. Audit log is periodically flushed to persistent storage. Production deployments should set a maximum audit log size.
- **No behavioral analysis yet**: The current post-invoke checks are heuristic thresholds (output size > 10MB, duration > 60s, consumption > 1,000 units). These catch gross anomalies but miss subtle attacks like slow data exfiltration (small outputs over many invocations) or prompt injection that produces valid-looking but malicious output. The threat model recommends behavioral anomaly detection (D-CA1.4) as a Layer 5 control. This is a future enhancement, not a current hypervisor capability.

### Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-------------|
| Policy drift between dev and prod | High | Medium | CI test: production policy must pass the same test suite as development policy, plus explicit approval tests |
| Hypervisor becomes performance bottleneck | Medium | High | Benchmark: pre-invoke checks must complete in <1ms. If exceeded, optimize hot paths or introduce caching |
| Approval queue deadlock (all workers waiting for approval) | Medium | High | Auto-approve for workspace chiefs; timeout with deny-after-5min prevents indefinite blocking |
| Audit log grows unbounded | High | Low | Rotate to persistent storage every 10,000 entries; cap in-memory log at 100,000 entries |
| Rate limit evasion via multiple agents | Medium | High | Per-workspace rate limits in addition to per-agent; cross-agent correlation for botnet detection (Layer 5) |