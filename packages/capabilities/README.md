# @agentos/capabilities

Capability runtime for AgentOS — the universal execution layer between agents and external systems. All agent actions are expressed as capabilities resolved through a 7-phase pipeline with a security hypervisor enforcing 9 pre-checks and 5 post-checks.

## Overview

Every external action (file I/O, HTTP request, shell command, model inference, MCP tool) is a capability. The `CapabilityResolver` performs 7-phase resolution: path matching, provider selection, policy evaluation, quota check, sandbox setup, execution, and consumption tracking. Five built-in providers (Filesystem, HTTP, Shell, LocalModel, MCP) cover the core surface, and the `SecurityHypervisor` enforces capability rules, sandbox boundaries, and consumption limits. MCP (Model Context Protocol) support allows integrating external tool servers as capability providers.

## API

- **`CapabilityRegistry`** — registers capabilities and providers.
- **`CapabilityResolver`** — 7-phase resolution pipeline; returns `ResolutionResult`.
- **`CapabilityExecutor`** — executes resolved capabilities with sandboxing and consumption tracking.
- **`SecurityHypervisor`** — enforces `SecurityPolicy` and `CapabilityRule[]`; 9 pre + 5 post checks.
- **`SandboxManager`** — manages isolated execution environments.
- **`ConsumptionTracker`** — tracks RU/MU/EU/VU consumption per invocation.
- **Providers** — `FilesystemProvider`, `HttpProvider`, `ShellProvider`, `LocalModelProvider`, `MCPProvider` (all extend `ProviderBase`).
- **MCP** — `MCPRuntime`, `MCPProvider`, `adaptMCPRuntime` for integrating MCP tool servers.
- **Policies** — `createProductionPolicy`, `createDevelopmentPolicy`.

## Usage

```typescript
import { CapabilityRegistry, CapabilityResolver, FilesystemProvider, createProductionPolicy } from '@agentos/capabilities';

const registry = new CapabilityRegistry();
registry.registerProvider(new FilesystemProvider({ root: '/workspace' }));
const resolver = new CapabilityResolver(registry, {
  policy: createProductionPolicy(),
});
const result = await resolver.resolve({ path: 'fs.read', requester: agentId });
```

## Configuration

Provider configs (`FilesystemProviderConfig`, `HttpProviderConfig`, `ShellProviderConfig`, ...) are passed at registration. Security policies are created via `createProductionPolicy()` or `createDevelopmentPolicy()`.

## Tests

```bash
pnpm --filter @agentos/capabilities test
```

## License

Proprietary — Nous Research