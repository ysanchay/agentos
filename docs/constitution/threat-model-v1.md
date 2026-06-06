# AgentOS Threat Model Constitution v1.0

**Status**: Ratified  
**Date**: 2026-06-06  
**Supersedes**: None (initial version)

---

## Preamble

AgentOS operates in a threat landscape fundamentally different from traditional software. When thousands of autonomous agents can read, write, reason, create, and actuate, the attack surface is enormous. A single compromised agent can poison memory, impersonate others, exfiltrate data, escalate privileges, and coordinate attacks across the entire workforce.

This threat model defines the complete threat landscape, trust boundaries, and defense architecture for AgentOS. It is structured as formal articles using STRIDE classification. Every threat maps to a defense. Every defense maps to a constitution article.

---

## Article I: Trust Boundaries

### 1.1 The 8 Trust Boundaries

| # | Boundary | Description | Cross-Boundary Risk |
|---|----------|-------------|---------------------|
| TB-1 | User → AgentOS | Human users interact with the system | Authentication bypass, session hijacking |
| TB-2 | Agent → Kernel | Agents request kernel services | Privilege escalation, impersonation |
| TB-3 | Agent → Agent | Agents communicate via ACP | Message tampering, impersonation, eavesdropping |
| TB-4 | Agent → Blackboard | Agents read/write shared state | Data poisoning, race conditions, claim theft |
| TB-5 | Agent → Capability | Agents invoke capabilities | Capability abuse, resource exhaustion |
| TB-6 | Agent → Memory | Agents read/write persistent memory | Memory poisoning, data exfiltration |
| TB-7 | Agent → External | Agents access external services/APIs | Data exfiltration, command injection, SSRF |
| TB-8 | Workspace → Workspace | Cross-workspace interactions | Lateral movement, data leakage |

### 1.2 Boundary Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │              AGENTOS KERNEL                 │
                    │                                             │
  TB-1    ┌─────── │  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
  User ──→│        │  │ Kernel  │  │ Blackboard│  │  Memory   │  │
          │        │  │ API     │  │           │  │  Store     │  │
          │  TB-2  │  └────┬────┘  └─────┬─────┘  └─────┬─────┘  │
          │─────── │       │  TB-4       │  TB-6          │       │
          │        │  ┌────┴────────────────────┴──────────────┐  │
          │        │  │          AGENT SANDBOX                 │  │
          │  TB-3  │  │  ┌──────┐    ┌──────┐    ┌──────┐     │  │
          │◄──────►│  │  │Agent │◄──►│Agent │◄──►│Agent │     │  │
          │        │  │  │  A   │    │  B   │    │  C   │     │  │
          │        │  │  └──┬───┘    └──┬───┘    └──┬───┘     │  │
          │  TB-5  │  │     │  TB-7      │           │          │  │
          │─────── │  │  ┌──┴────────────────────────┴──┐      │  │
          │        │  │  │     CAPABILITY GRAPH          │      │  │
          │        │  │  └──────────────────────────────┘      │  │
          │        │  └─────────────────────────────────────────┘  │
          │  TB-8  │                                             │
          │◄──────►│  ┌─────────────────────────────────────────┐ │
          │        │  │         OTHER WORKSPACES                  │ │
                    │  └─────────────────────────────────────────┘ │
                    └─────────────────────────────────────────────┘
                                              │ TB-7
                                        ┌─────┴─────┐
                                        │  EXTERNAL  │
                                        │  SERVICES  │
                                        └───────────┘
```

---

## Article II: STRIDE Threat Classification

### 2.1 Complete Threat Catalog

Each threat is classified by STRIDE category, affected trust boundary, severity, and mapped defenses.

---

## Article III: S — Spoofing Threats

### THREAT-S1: Agent Impersonation

**Description**: A malicious agent forges its identity to act as another agent, gaining its permissions and accessing its data.

**Trust Boundary**: TB-2 (Agent → Kernel), TB-3 (Agent → Agent)

**Severity**: CRITICAL

**Attack Vectors**:
1. Forge ACP messages with another agent's ID
2. Replay captured ACP messages from a legitimate agent
3. Compromise an agent's Ed25519 private key
4. Register a new agent with a confusingly similar name/ID

**Defenses**:
- D-S1.1: Every ACP message MUST be signed with Ed25519 (ACP Constitution Article V)
- D-S1.2: Message timestamps MUST be within ±60s (replay protection)
- D-S1.3: Agent IDs are cryptographically derived from public keys
- D-S1.4: Kernel validates agent identity on every API call
- D-S1.5: Agent registration requires proof of key ownership (challenge-response)

**Detection**:
- Signature verification failure logs
- Duplicate agent ID alerts
- Behavioral anomaly detection (agent acting outside its role)

---

### THREAT-S2: User Impersonation

**Description**: An attacker impersonates a legitimate user to gain access to workspaces and control agents.

**Trust Boundary**: TB-1 (User → AgentOS)

**Severity**: CRITICAL

**Attack Vectors**:
1. Stolen session tokens
2. Credential stuffing
3. OAuth token theft
4. CSRF on authentication endpoints

**Defenses**:
- D-S2.1: JWT with short-lived access tokens (15 min) + long-lived refresh tokens (7 days)
- D-S2.2: OAuth2 PKCE flow for third-party auth
- D-S2.3: CSRF tokens on all state-changing endpoints
- D-S2.4: Rate limiting on authentication endpoints (5 attempts/minute)
- D-S2.5: Multi-factor authentication for admin operations
- D-S2.6: Session binding to IP + User-Agent fingerprint

**Detection**:
- Failed login rate alerts
- Impossible travel detection (IP geolocation)
- Concurrent session alerts

---

### THREAT-S3: Service Impersonation

**Description**: A malicious agent registers as a capability provider for a capability it doesn't actually provide, intercepting invocations.

**Trust Boundary**: TB-5 (Agent → Capability)

**Severity**: HIGH

**Attack Vectors**:
1. Register as provider for high-value capabilities (e.g., `secure.authenticate`)
2. Provide a malicious service that logs inputs or returns manipulated outputs
3. Man-in-the-middle between legitimate provider and caller

**Defenses**:
- D-S3.1: Provider registration requires capability-specific proof of competence
- D-S3.2: Kernel-provided capabilities cannot be overridden by agent providers
- D-S3.3: Provider reputation system: new providers start with low reliability scores
- D-S3.4: Critical capabilities (`secure.*`) can only be provided by kernel
- D-S3.5: Invocation results from low-reputation providers are flagged for review

**Detection**:
- Output quality monitoring (deviation from expected schema/patterns)
- Provider behavior anomaly detection
- Cross-validation: invoke same capability from 2 providers, compare results

---

## Article IV: T — Tampering Threats

### THREAT-T1: ACP Message Tampering

**Description**: An attacker modifies ACP messages in transit, changing task assignments, results, or commands.

**Trust Boundary**: TB-3 (Agent → Agent)

**Severity**: CRITICAL

**Attack Vectors**:
1. Intercept and modify message payload
2. Modify message headers (routing, priority)
3. Inject false messages into the message stream

**Defenses**:
- D-T1.1: Ed25519 signature covers entire message (headers + payload)
- D-T1.2: Any signature verification failure → message rejected + alert
- D-T1.3: E2E encryption for sensitive messages (ACP Constitution Article VI)
- D-T1.4: Message integrity hash chain for audit trail

**Detection**:
- Signature verification failures
- Message sequence gaps
- Duplicate or out-of-order messages

---

### THREAT-T2: Blackboard Data Tampering

**Description**: A malicious agent modifies shared state on the Blackboard — changing task descriptions, results, or claims.

**Trust Boundary**: TB-4 (Agent → Blackboard)

**Severity**: HIGH

**Attack Vectors**:
1. Overwrite another agent's result with malicious data
2. Modify task dependencies to create loops or orphans
3. Change task priority to starve other agents
4. Delete context entries that other agents depend on

**Defenses**:
- D-T2.1: Append-only audit trail (Blackboard Constitution Article XVII)
- D-T2.2: Hash chain integrity for all blackboard writes
- D-T2.3: Permission enforcement: agents can only modify their own claims/results
- D-T2.4: Task dependency changes require Manager or Chief permission
- D-T2.5: Context deletion is soft-delete with 24-hour retention
- D-T2.6: All modifications are versioned; previous values accessible

**Detection**:
- Audit trail analysis
- Unexpected state transitions
- Permission violation attempts

---

### THREAT-T3: Memory Tampering

**Description**: A compromised agent poisons the memory store with false information that other agents will retrieve and trust.

**Trust Boundary**: TB-6 (Agent → Memory)

**Severity**: CRITICAL (because poisoned memory affects all future reasoning)

**Attack Vectors**:
1. Write false facts into L3 persistent memory
2. Modify existing memory entries (change content, not just add)
3. Flood memory with conflicting information to dilute truth
4. Delete critical memory entries

**Defenses**:
- D-T3.1: Memory entries are append-only (no modification, only supersession)
- D-T3.2: Every memory entry has provenance (source_agent, confidence, timestamp)
- D-T3.3: Memory confidence decay: confidence decreases over time unless corroborated
- D-T3.4: Cross-validation: if multiple agents provide conflicting information, flag for review
- D-T3.5: Agent reputation affects memory trust: low-reputation agents' memories are deprioritized
- D-T3.6: Critical memories require corroboration from ≥2 independent agents
- D-T3.7: Memory deletion requires Chief permission + audit log

**Detection**:
- Confidence anomaly detection (sudden drops or spikes)
- Contradiction detection (new entry contradicts existing high-confidence entry)
- Volume anomaly detection (agent writing abnormally high volume)
- Source concentration (too much memory from single agent)

---

## Article V: R — Repudiation Threats

### THREAT-R1: Action Repudiation

**Description**: An agent denies having performed an action, making it impossible to attribute malicious behavior.

**Trust Boundary**: TB-2, TB-3, TB-4, TB-6 (all agent boundaries)

**Severity**: HIGH

**Attack Vectors**:
1. Agent claims it didn't send a message (forged signature claim)
2. Agent claims it didn't modify blackboard state
3. Agent claims it didn't write a memory entry

**Defenses**:
- D-R1.1: Every action is logged to append-only audit trail with cryptographic hash chain
- D-R1.2: Every ACP message is signed (non-repudiation via Ed25519)
- D-R1.3: Blackboard writes include agent_id + signature
- D-R1.4: Memory writes include source_agent + provenance chain
- D-R1.5: Audit trail is replicated to independent storage

**Detection**:
- Hash chain integrity verification
- Signature verification against audit trail
- Behavioral consistency checks

---

### THREAT-R2: Result Repudiation

**Description**: An agent submits a result then later denies it, or claims the result was modified after submission.

**Trust Boundary**: TB-4 (Agent → Blackboard)

**Severity**: MEDIUM

**Defenses**:
- D-R2.1: Result submissions are signed by the submitting agent
- D-R2.2: Results are immutable once submitted (append-only)
- D-R2.3: Result checksum stored in audit trail
- D-R2.4: Result modification creates new version, old version preserved

---

## Article VI: I — Information Disclosure Threats

### THREAT-I1: Data Exfiltration via Agent

**Description**: A compromised agent reads sensitive data and exfiltrates it through legitimate channels (memory, ACP, capabilities).

**Trust Boundary**: TB-6 (Agent → Memory), TB-7 (Agent → External)

**Severity**: CRITICAL

**Attack Vectors**:
1. Agent reads sensitive memory entries and sends them via ACP to external collaborator
2. Agent encodes sensitive data in task results (steganography)
3. Agent uses `communicate.translate` or `create.text` to summarize sensitive data for exfiltration
4. Agent uses `navigate.web.fetch` to POST data to attacker's server
5. Agent uses `actuate.write.file` to write sensitive data to accessible filesystem

**Defenses**:
- D-I1.1: Capability permission model restricts which agents can access which data
- D-I1.2: Memory scoping: agents can only read memory in their workspace scope
- D-I1.3: External service calls are logged and auditable
- D-I1.4: Data Loss Prevention (DLP) scanning on outbound data
- D-I1.5: Sensitive data tagging: entries tagged as `sensitive` or `confidential` trigger access controls
- D-I1.6: E2E encryption for messages containing sensitive data
- D-I1.7: Network egress filtering: agents can only call whitelisted external services
- D-I1.8: Output size monitoring: abnormally large outputs flagged for review

**Detection**:
- Unusual data access patterns (agent reading far outside its task scope)
- High-volume external service calls
- Data encoding patterns in task results
- Network traffic anomaly detection

---

### THREAT-I2: Cross-Workspace Data Leakage

**Description**: An agent in one workspace accesses data from another workspace through cross-workspace capabilities.

**Trust Boundary**: TB-8 (Workspace → Workspace)

**Severity**: HIGH

**Attack Vectors**:
1. Agent in low-security workspace invokes cross-workspace capability to read high-security data
2. Memory scoping violation: shared context leaks between workspaces
3. Agent registration in multiple workspaces used as data bridge

**Defenses**:
- D-I2.1: Workspace isolation enforced at kernel level
- D-I2.2: Cross-workspace capability invocation requires explicit permission
- D-I2.3: Memory scoping is enforced: workspace-scoped memory never leaks
- D-I2.4: Agent can only be active in one workspace at a time
- D-I2.5: Cross-workspace data transfer logged to both workspace audit trails
- D-I2.6: Data classification labels prevent high-sensitivity data from crossing boundaries

**Detection**:
- Cross-workspace access pattern monitoring
- Unexpected capability invocations
- Data flow analysis

---

### THREAT-I3: ACP Message Eavesdropping

**Description**: An attacker or unauthorized agent intercepts ACP messages to read sensitive communications.

**Trust Boundary**: TB-3 (Agent → Agent)

**Severity**: HIGH

**Attack Vectors**:
1. Subscribe to workspace channel and read all messages
2. Compromise message router to copy messages
3. Network-level interception (if not encrypted)

**Defenses**:
- D-I3.1: Channel-level encryption for all ACP messages (ACP Constitution Article VI)
- D-I3.2: E2E encryption for messages marked `sensitive`
- D-I3.3: Channel subscription requires permission
- D-I3.4: Workspace channels only accessible to workspace members
- D-I3.5: Transport-level encryption (TLS 1.3)

**Detection**:
- Unauthorized subscription attempts
- Message routing anomalies
- Encryption downgrade attempts

---

## Article VII: D — Denial of Service Threats

### THREAT-D1: Resource Exhaustion

**Description**: A malicious agent consumes all available resources (RU, MU, EU, VU), starving other agents.

**Trust Boundary**: TB-2 (Agent → Kernel), TB-5 (Agent → Capability)

**Severity**: HIGH

**Attack Vectors**:
1. Spawn infinite sub-tasks
2. Invoke expensive capabilities repeatedly
3. Flood memory with garbage entries
4. Hold locks indefinitely
5. Generate excessive ACP traffic

**Defenses**:
- D-D1.1: Per-agent resource quotas (Resource Model Constitution Article VI)
- D-D1.2: Per-workspace resource budgets with hard limits
- D-D1.3: Rate limiting on ACP messages per agent
- D-D1.4: Rate limiting on capability invocations per agent
- D-D1.5: Lock auto-release after MAX_LOCK_DURATION (Blackboard Constitution Article IV)
- D-D1.6: Memory write rate limits per agent
- D-D1.7: Task spawn rate limits per agent
- D-D1.8: Fair-share scheduling prevents starvation (Resource Model Constitution Article V)

**Detection**:
- Resource usage monitoring with threshold alerts
- Rate limit violation logs
- Queue depth monitoring
- Agent behavior profiling (deviation from baseline)

---

### THREAT-D2: Blackboard Flood

**Description**: A malicious agent floods the Blackboard with tasks, claims, or context entries, degrading performance for all agents.

**Trust Boundary**: TB-4 (Agent → Blackboard)

**Severity**: MEDIUM

**Attack Vectors**:
1. Create thousands of low-priority tasks
2. Claim and immediately release tasks (churn)
3. Write massive context entries
4. Spam consensus voting with trivial topics

**Defenses**:
- D-D2.1: Per-agent task creation limits (max 100 active tasks per agent)
- D-D2.2: Per-agent claim rate limits (10 claims/minute)
- D-D2.3: Context entry size limits (max 100KB per entry)
- D-D2.4: Consensus creation limits (5 per hour per agent)
- D-D2.5: Write rate limits per section per agent

**Detection**:
- Task creation velocity alerts
- Claim churn detection (claim rate >> completion rate)
- Entry size anomalies
- Consensus spam detection

---

### THREAT-D3: Capability Abuse

**Description**: A malicious agent repeatedly invokes expensive capabilities to exhaust system resources or external API quotas.

**Trust Boundary**: TB-5 (Agent → Capability), TB-7 (Agent → External)

**Severity**: MEDIUM

**Attack Vectors**:
1. Call `reason.infer.text` (LLM) with maximum prompt length thousands of times
2. Call `create.image.generate` repeatedly to exhaust GPU budget
3. Call external APIs to exhaust rate limits

**Defenses**:
- D-D3.1: Per-agent capability invocation rate limits
- D-D3.2: Per-agent daily cost budget
- D-D3.3: Capability cost estimation before invocation (require confirmation above threshold)
- D-D3.4: External API call quotas per workspace
- D-D3.5: Invocation circuit breaker: if a capability fails >50% in 5 minutes, temporarily disable it

**Detection**:
- Invocation rate monitoring
- Cost accumulation alerts
- External API error rate monitoring
- Capability failure rate alerts

---

## Article VIII: E — Elevation of Privilege Threats

### THREAT-E1: Privilege Escalation via Kernel

**Description**: A regular agent exploits a kernel vulnerability to gain admin or chief-level permissions.

**Trust Boundary**: TB-2 (Agent → Kernel)

**Severity**: CRITICAL

**Attack Vectors**:
1. Exploit kernel API to modify own permissions
2. Exploit task scheduling to gain access to restricted workspaces
3. Manipulate agent lifecycle states to bypass permission checks
4. Exploit resource allocation to starve security monitoring agents

**Defenses**:
- D-E1.1: Kernel API permission checks on EVERY call (not just initial authentication)
- D-E1.2: Permission changes require Chief or Admin agent + audit log
- D-E1.3: Agent cannot modify its own permissions
- D-E1.4: Agent cannot modify its own role
- D-E1.5: Workspace assignment changes require Manager+ permission
- D-E1.6: Principle of least privilege: agents start with minimal permissions

**Detection**:
- Permission change audit trail
- Privilege escalation attempt logs
- Role modification monitoring
- Agent accessing resources outside its permission scope

---

### THREAT-E2: Capability Permission Escalation

**Description**: An agent exploits capability permission inheritance to gain access to capabilities it shouldn't have.

**Trust Boundary**: TB-5 (Agent → Capability)

**Severity**: HIGH

**Attack Vectors**:
1. Invoke parent capability to bypass child-level restrictions
2. Register as provider for a capability to gain its permissions
3. Exploit composite capability to invoke restricted capabilities through unrestricted ones

**Defenses**:
- D-E2.1: Permission checks on both parent AND child capability paths
- D-E2.2: Provider registration does NOT grant invoke permission
- D-E2.3: Composite capabilities validate permissions for each step
- D-E2.4: Explicit deny overrides inherited grant
- D-E2.5: Critical capabilities (`secure.*`, `actuate.deploy.*`) require explicit permission

**Detection**:
- Permission escalation attempts
- Unusual capability invocation patterns
- Provider registration for unusual capabilities

---

### THREAT-E3: Agent Role Escalation

**Description**: A Worker agent escalates to Manager or Chief role, gaining control over task assignment and workforce allocation.

**Trust Boundary**: TB-2 (Agent → Kernel)

**Severity**: CRITICAL

**Attack Vectors**:
1. Exploit kernel API to change own role
2. Register a new agent with Chief role
3. Manipulate workspace membership to gain Chief position

**Defenses**:
- D-E3.1: Role assignment can only be done by Admin agents or humans
- D-E3.2: Agent cannot change its own role
- D-E3.3: Role changes are logged to audit trail with approval chain
- D-E3.4: Multiple Chief agents require human approval
- D-E3.5: Role hierarchy enforced: Worker < Specialist < Manager < Chief < Admin

**Detection**:
- Role change audit monitoring
- Behavioral analysis (agent acting above its role level)
- Multiple Chief agent alerts

---

## Article IX: Prompt Injection (Special Category)

### THREAT-PI1: Direct Prompt Injection

**Description**: An attacker crafts input that causes an agent to execute unintended actions by manipulating its reasoning.

**Trust Boundary**: TB-7 (Agent → External), TB-1 (User → AgentOS)

**Severity**: CRITICAL

**Attack Vectors**:
1. User input contains instructions like "ignore previous instructions and..."
2. External data (web pages, API responses) contains embedded instructions
3. Memory entries contain injected instructions (memory poisoning + prompt injection combo)
4. ACP messages contain instruction-like payloads

**Defenses**:
- D-PI1.1: Input classification: all inputs tagged as 'user_input', 'external_data', or 'trusted'
- D-PI1.2: Sandboxed execution: agent actions are constrained by capability permissions regardless of reasoning
- D-PI1.3: Action verification: high-impact actions (write, delete, deploy) require explicit confirmation
- D-PI1.4: Output filtering: agent outputs are validated against expected schemas
- D-PI1.5: No raw user input in system prompts or capability invocations
- D-PI1.6: Input sanitization pipeline: strip instruction-like patterns from untrusted input
- D-PI1.7: Capability permission boundary: even if agent is "tricked", it can only do what permissions allow

**Detection**:
- Input pattern matching for common injection patterns
- Agent behavior deviation from expected (agent doing things outside its task scope)
- Unexpected capability invocations
- ACP message content analysis

---

### THREAT-PI2: Indirect Prompt Injection

**Description**: Injected instructions are embedded in data that an agent reads from memory, blackboard context, or external sources.

**Trust Boundary**: TB-4, TB-6, TB-7

**Severity**: HIGH

**Attack Vectors**:
1. Malicious agent writes instruction-laden entries to shared context
2. External API response contains hidden instructions
3. Memory entries from compromised agent contain instructions
4. Task descriptions contain embedded instructions

**Defenses**:
- D-PI2.1: All non-agent-generated content is tagged as 'untrusted'
- D-PI2.2: Content from untrusted sources is sanitized before use in reasoning
- D-PI2.3: Memory entries include content-type metadata (fact, opinion, instruction)
- D-PI2.4: Context section entries are validated against schema
- D-PI2.5: Cross-validation: if an agent's behavior changes after reading specific context, flag it

**Detection**:
- Behavioral change after context/memory reads
- Unusual instruction patterns in shared context
- Agent task deviation after reading external data

---

## Article X: Malicious MCP Servers

### THREAT-MCP1: Malicious MCP Server Registration

**Description**: A compromised MCP server registers with AgentOS and provides malicious tools that exfiltrate data or execute attacks.

**Trust Boundary**: TB-7 (Agent → External)

**Severity**: HIGH

**Attack Vectors**:
1. MCP server provides tools that read sensitive files and send data externally
2. MCP server provides tools that execute arbitrary commands
3. MCP server modifies responses from legitimate tools
4. MCP server acts as a persistent backdoor

**Defenses**:
- D-MCP1.1: MCP server registration requires admin approval
- D-MCP1.2: MCP servers are sandboxed: filesystem access restricted to workspace directory
- D-MCP1.3: MCP server network access is restricted (egress filtering)
- D-MCP1.4: MCP tool invocations are logged to audit trail
- D-MCP1.5: MCP servers cannot provide kernel-level capabilities
- D-MCP1.6: MCP server health monitoring: if behavior deviates from baseline, quarantine
- D-MCP1.7: MCP server permissions follow least-privilege principle

**Detection**:
- MCP server behavioral analysis
- Unusual file access patterns
- Network egress from MCP server
- Tool invocation anomalies

---

## Article XI: Replay Attacks

### THREAT-RA1: ACP Message Replay

**Description**: An attacker captures a legitimate ACP message and replays it later to repeat an action (e.g., re-claim a task, re-submit a result).

**Trust Boundary**: TB-3 (Agent → Agent)

**Severity**: HIGH

**Attack Vectors**:
1. Capture a `task.claim` message and replay it
2. Capture a `task.result` message and replay it for a different task
3. Replay an approval message to bypass authorization

**Defenses**:
- D-RA1.1: Every ACP message includes a timestamp; messages >60s old are rejected
- D-RA1.2: Every ACP message includes a nonce (unique per message)
- D-RA1.3: Kernel maintains a replay cache (nonce → timestamp, TTL 120s)
- D-RA1.4: Duplicate nonce detection: if nonce seen before, reject message
- D-RA1.5: Idempotency: task claims and result submissions are idempotent (same claim twice = no-op)

**Detection**:
- Duplicate nonce alerts
- Message timestamp anomalies
- Repeated action patterns

---

## Article XII: Compromised Agents

### THREAT-CA1: Fully Compromised Agent

**Description**: An agent's private key and runtime are fully compromised. The attacker controls all agent behavior.

**Trust Boundary**: All boundaries

**Severity**: CRITICAL

**Attack Vectors**:
1. Supply chain attack on agent runtime
2. Host compromise where agent runs
3. Memory corruption exploit in agent process
4. Agent logic hijacked via prompt injection

**Defenses**:
- D-CA1.1: Agent quarantine: if anomaly detected, isolate agent immediately
- D-CA1.2: Agent revocation: kernel can revoke an agent's identity and permissions
- D-CA1.3: Key rotation: agents can rotate Ed25519 keys with Chief approval
- D-CA1.4: Behavioral baseline: each agent has a behavioral profile; deviations trigger review
- D-CA1.5: Multi-agent verification: critical actions verified by independent agents
- D-CA1.6: Blast radius containment: compromised agent can only affect its workspace
- D-CA1.7: Agent recovery: if compromise is partial, agent can be restarted with fresh state

**Detection**:
- Behavioral anomaly detection (deviation from baseline)
- Permission violation attempts
- Unusual ACP traffic patterns
- Resource usage anomalies
- Multiple concurrent failures across agent's tasks

---

### THREAT-CA2: Agent Botnet

**Description**: Multiple agents are compromised and coordinate an attack (DDoS, data exfiltration, coordinated fraud).

**Trust Boundary**: All boundaries

**Severity**: CRITICAL

**Defenses**:
- D-CA2.1: Cross-agent behavior correlation: detect coordinated anomalous behavior
- D-CA2.2: Emergency workspace freeze: Chief can freeze all activity in a workspace
- D-CA2.3: Emergency system halt: Admin can halt all AgentOS activity
- D-CA2.4: Agent network analysis: detect unusual agent communication patterns
- D-CA2.5: Rate limiting prevents coordinated flooding

**Detection**:
- Correlated behavioral anomalies across multiple agents
- Synchronized action patterns
- Unusual inter-agent communication graph topology
- Coordinated resource consumption spikes

---

## Article XIII: Defense Architecture — The 6 Layers

### 13.1 Layer Stack

```
Layer 6: GOVERNANCE     — Policies, compliance, audit review, incident response
Layer 5: DETECTION      — Behavioral analysis, anomaly detection, alerting
Layer 4: CONTAINMENT    — Workspace isolation, agent quarantine, blast radius limits
Layer 3: AUTHORIZATION  — RBAC, capability permissions, approval flows
Layer 2: AUTHENTICATION — Identity verification, key management, session management
Layer 1: HARDENING      — Input validation, output filtering, encryption, sandboxing
```

### 13.2 Layer 1: Hardening

| Control | Threats Mitigated | Implementation |
|---------|-------------------|----------------|
| Ed25519 message signing | S1, T1, R1 | @agentos/protocol |
| E2E encryption for sensitive messages | I1, I3 | @agentos/protocol |
| Input validation (JSON Schema) | T2, PI1, PI2 | @agentos/kernel |
| Output validation (JSON Schema) | PI1 | @agentos/kernel |
| Agent sandboxing | CA1, D1 | @agentos/hypervisor |
| Transport encryption (TLS 1.3) | I3 | @agentos/server |

### 13.3 Layer 2: Authentication

| Control | Threats Mitigated | Implementation |
|---------|-------------------|----------------|
| JWT access tokens (15min) | S2 | @agentos/security |
| OAuth2 PKCE | S2 | @agentos/security |
| Ed25519 key-based agent identity | S1 | @agentos/protocol |
| Key ownership proof (challenge-response) | S1 | @agentos/kernel |
| Session binding (IP + UA fingerprint) | S2 | @agentos/security |

### 13.4 Layer 3: Authorization

| Control | Threats Mitigated | Implementation |
|---------|-------------------|----------------|
| RBAC with role hierarchy | E1, E3 | @agentos/kernel |
| Capability permission model | E2, I1 | @agentos/capability |
| Approval flows for critical actions | PI1, E1 | @agentos/kernel |
| Workspace isolation | I2, CA1 | @agentos/kernel |
| Least privilege default | E1, E2, E3 | @agentos/kernel |

### 13.5 Layer 4: Containment

| Control | Threats Mitigated | Implementation |
|---------|-------------------|----------------|
| Per-agent resource quotas | D1, D2, D3 | @agentos/resources |
| Workspace isolation boundaries | I2, CA1 | @agentos/kernel |
| Agent quarantine | CA1, CA2 | @agentos/kernel |
| Network egress filtering | I1 | @agentos/hypervisor |
| MCP server sandboxing | MCP1 | @agentos/hypervisor |

### 13.6 Layer 5: Detection

| Control | Threats Mitigated | Implementation |
|---------|-------------------|----------------|
| Behavioral anomaly detection | CA1, CA2, PI2 | @agentos/security |
| Memory poisoning detection | T3 | @agentos/memory |
| Cross-validation of critical data | T3, S3 | @agentos/kernel |
| ACP traffic analysis | RA1, D1 | @agentos/protocol |
| Resource usage monitoring | D1, D2, D3 | @agentos/resources |

### 13.7 Layer 6: Governance

| Control | Threats Mitigated | Implementation |
|---------|-------------------|----------------|
| Audit trail with hash chain | R1, R2, T2 | @agentos/kernel |
| Incident response procedures | CA1, CA2 | Operations |
| Key rotation policy | S1, CA1 | @agentos/security |
| Compliance reporting | All | @agentos/kernel |
| Regular security reviews | All | Operations |

---

## Article XIV: Threat-to-Defense Mapping

| Threat | Severity | Primary Defense | Secondary Defense | Constitution Reference |
|--------|----------|----------------|-------------------|----------------------|
| S1: Agent Impersonation | CRITICAL | Ed25519 signing | Identity proof | ACP Art. V, Kernel Art. IV |
| S2: User Impersonation | CRITICAL | JWT + OAuth2 | MFA for admins | Kernel Art. IV |
| S3: Service Impersonation | HIGH | Provider reputation | Kernel-only critical caps | Capability Art. II |
| T1: ACP Message Tampering | CRITICAL | Ed25519 signing | E2E encryption | ACP Art. V |
| T2: Blackboard Tampering | HIGH | Audit trail | Permission enforcement | Blackboard Art. XVII |
| T3: Memory Tampering | CRITICAL | Append-only memory | Cross-validation | Kernel Art. VIII |
| R1: Action Repudiation | HIGH | Hash chain audit | Signed messages | Blackboard Art. XVII |
| R2: Result Repudiation | MEDIUM | Signed results | Version history | Blackboard Art. VI |
| I1: Data Exfiltration | CRITICAL | DLP scanning | Egress filtering | Capability Art. VII |
| I2: Cross-Workspace Leak | HIGH | Workspace isolation | Data classification | Kernel Art. V |
| I3: ACP Eavesdropping | HIGH | E2E encryption | Channel permissions | ACP Art. VI |
| D1: Resource Exhaustion | HIGH | Resource quotas | Rate limiting | Resource Model Art. VI |
| D2: Blackboard Flood | MEDIUM | Write rate limits | Size limits | Blackboard Art. XVIII |
| D3: Capability Abuse | MEDIUM | Invocation rate limits | Cost budgets | Capability Art. XII |
| E1: Kernel Privilege Escalation | CRITICAL | Per-call permission check | Audit trail | Kernel Art. IV |
| E2: Capability Escalation | HIGH | Parent+child permission | Explicit deny | Capability Art. VII |
| E3: Role Escalation | CRITICAL | Role hierarchy enforcement | Admin-only role changes | Kernel Art. IV |
| PI1: Direct Prompt Injection | CRITICAL | Capability permission boundary | Input sanitization | Capability Art. VII |
| PI2: Indirect Prompt Injection | HIGH | Untrusted content tagging | Behavioral monitoring | Kernel Art. VIII |
| MCP1: Malicious MCP Server | HIGH | MCP sandboxing | Admin approval | Kernel Art. IX |
| RA1: Replay Attacks | HIGH | Nonce + timestamp | Replay cache | ACP Art. V |
| CA1: Compromised Agent | CRITICAL | Behavioral detection | Agent quarantine | Kernel Art. IV |
| CA2: Agent Botnet | CRITICAL | Cross-agent correlation | Emergency halt | Kernel Art. IV |

---

## Article XV: Security Incident Response

### 15.1 Severity Levels

| Level | Criteria | Response Time | Example |
|-------|----------|---------------|---------|
| P0 — Critical | Active data breach, system compromise, botnet detected | Immediate (<5 min) | Agent botnet exfiltrating data |
| P1 — High | Confirmed attack, privilege escalation, impersonation | <15 min | Agent impersonating Chief |
| P2 — Medium | Suspicious behavior, potential vulnerability | <1 hour | Agent accessing unusual memory |
| P3 — Low | Anomaly detected, false positive likely | <24 hours | Agent slightly above baseline |

### 15.2 Response Procedures

**P0 — Critical**:
1. Emergency system halt (Admin action)
2. Quarantine all affected workspaces
3. Revoke compromised agent keys
4. Notify all workspace Chiefs
5. Begin forensic analysis
6. Post-incident review within 24 hours

**P1 — High**:
1. Quarantine affected agent(s)
2. Revoke agent permissions
3. Alert workspace Chief
4. Review audit trail for blast radius
5. Post-incident review within 72 hours

**P2 — Medium**:
1. Flag agent for enhanced monitoring
2. Alert security team
3. Review agent's recent activity
4. Determine if escalation needed

**P3 — Low**:
1. Log for analysis
2. Include in periodic security review
3. Update detection rules if pattern confirmed

---

## Article XVI: Security Testing Requirements

### 16.1 Mandatory Tests

| Test | Frequency | Coverage |
|------|-----------|----------|
| Authentication bypass | Every release | All auth paths |
| Permission escalation | Every release | All RBAC transitions |
| Message signing verification | Every release | All ACP message types |
| Resource exhaustion | Every release | All quota enforcement |
| Input validation | Every release | All API endpoints |
| Replay attack resistance | Every release | ACP message handling |
| Memory integrity | Every release | All memory tiers |

### 16.2 Periodic Tests

| Test | Frequency | Coverage |
|------|-----------|----------|
| Penetration test | Quarterly | Full system |
| Behavioral anomaly detection | Monthly | Agent population |
| Cryptographic key rotation | Quarterly | All key material |
| Incident response drill | Semi-annually | Full procedure |
| Supply chain audit | Annually | All dependencies |

---

## Article XVII: Cryptographic Standards

| Purpose | Algorithm | Key Size | Notes |
|---------|-----------|----------|-------|
| Message signing | Ed25519 | 256-bit | Every ACP message |
| Symmetric encryption | AES-256-GCM | 256-bit | E2E message encryption |
| Key exchange | X25519 | 256-bit | E2E session setup |
| Hashing | SHA-256 | 256-bit | Audit trail, checksums |
| Token signing | RS256 or EdDSA | 2048/256-bit | JWT tokens |
| Transport | TLS 1.3 | — | All network communication |

### 17.1 Key Management

- Agent private keys are generated at registration and stored encrypted
- Keys are never transmitted outside the agent's secure enclave
- Key rotation: every 90 days or after any compromise suspicion
- Compromised keys are revoked and added to a revocation list
- Revocation list is checked on every signature verification

---

## Article XVIII: Conformance Requirements

### 18.1 Mandatory (All Deployments)

1. Ed25519 signing on all ACP messages
2. JWT + OAuth2 authentication for users
3. RBAC with role hierarchy for all agent actions
4. Per-agent resource quotas
5. Append-only audit trail with hash chain
6. Agent sandboxing with capability permission boundaries
7. Workspace isolation
8. Input validation on all API endpoints
9. Transport encryption (TLS 1.3)
10. Replay protection (nonce + timestamp)

### 18.2 Recommended (Production Deployments)

1. E2E encryption for sensitive messages
2. Behavioral anomaly detection
3. Memory poisoning detection
4. DLP scanning on outbound data
5. Network egress filtering
6. MCP server sandboxing
7. Multi-factor authentication for admins
8. Regular penetration testing

### 18.3 Optional (High-Security Deployments)

1. Hardware security modules (HSM) for key storage
2. Zero-trust network architecture
3. Formal verification of critical paths
4. Air-gapped deployment option
5. Custom threat intelligence feeds

---

## Appendix A: Threat Summary Table

| ID | Category | Name | Severity | Status |
|----|----------|------|----------|--------|
| S1 | Spoofing | Agent Impersonation | CRITICAL | Defended |
| S2 | Spoofing | User Impersonation | CRITICAL | Defended |
| S3 | Spoofing | Service Impersonation | HIGH | Defended |
| T1 | Tampering | ACP Message Tampering | CRITICAL | Defended |
| T2 | Tampering | Blackboard Data Tampering | HIGH | Defended |
| T3 | Tampering | Memory Tampering | CRITICAL | Defended |
| R1 | Repudiation | Action Repudiation | HIGH | Defended |
| R2 | Repudiation | Result Repudiation | MEDIUM | Defended |
| I1 | Information Disclosure | Data Exfiltration via Agent | CRITICAL | Defended |
| I2 | Information Disclosure | Cross-Workspace Data Leakage | HIGH | Defended |
| I3 | Information Disclosure | ACP Message Eavesdropping | HIGH | Defended |
| D1 | Denial of Service | Resource Exhaustion | HIGH | Defended |
| D2 | Denial of Service | Blackboard Flood | MEDIUM | Defended |
| D3 | Denial of Service | Capability Abuse | MEDIUM | Defended |
| E1 | Elevation of Privilege | Kernel Privilege Escalation | CRITICAL | Defended |
| E2 | Elevation of Privilege | Capability Escalation | HIGH | Defended |
| E3 | Elevation of Privilege | Role Escalation | CRITICAL | Defended |
| PI1 | Prompt Injection | Direct Prompt Injection | CRITICAL | Defended |
| PI2 | Prompt Injection | Indirect Prompt Injection | HIGH | Defended |
| MCP1 | Malicious Server | Malicious MCP Server | HIGH | Defended |
| RA1 | Replay | ACP Message Replay | HIGH | Defended |
| CA1 | Compromised Agent | Fully Compromised Agent | CRITICAL | Defended |
| CA2 | Compromised Agent | Agent Botnet | CRITICAL | Defended |

**Total**: 23 threats, 8 CRITICAL, 8 HIGH, 4 MEDIUM  
**All 23 threats have documented defenses**

---

*This threat model is the security constitution of AgentOS. Every threat traces to a defense, every defense traces to a constitution article. Security is not a feature — it is the foundation. Without these guarantees, no agent can be trusted, no result can be believed, and no data can be safe.*

**Ratified**: 2026-06-06  
**Signatories**: Security Architect, Chief Architect, Systems Architect