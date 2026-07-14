# @agentos/types

Shared type system, Zod schemas, and constitutional constants for the AgentOS monorepo. This package is the single source of truth for all TypeScript types, interfaces, enums, and constants derived from the 6 ratified constitution documents.

## Overview

Every other AgentOS package depends on `@agentos/types`. It provides primitive ID types (UUID, AgentID, TaskID, ...), resource-unit definitions (RU/MU/EU/VU budgets), agent/task/workspace state machines, capability and permission types, ACP message payloads, blackboard section types, memory tier enums, error codes, and runtime configuration helpers. Zod schemas are available via the `./zod` subpath export for runtime validation.

## API

- **Primitives** — `UUID`, `AgentID`, `TaskID`, `WorkspaceID`, `CapabilityID`, ... plus `isUUID`, `asUUID`, `createUUID`.
- **Resource types** — `ResourceUnit` (RU/MU/EU/VU), `ResourceBudget`, `ResourceConsumption`, `ZERO_BUDGET`, `addBudgets`, `subtractBudgets`, `budgetGTE`, `scaleBudget`.
- **Agents / Tasks / Workspaces** — `AgentType`, `AgentState`, `TaskState`, `WorkspaceState` enums and their transition maps (`AGENT_TRANSITIONS`, `TASK_TRANSITIONS`, `WORKSPACE_TRANSITIONS`).
- **Capabilities** — `ROOT_CAPABILITIES`, `CapabilityPath`, `Capability`, `CapabilityProvider`, `InvocationResult`, `ResolutionRequest`.
- **ACP messages** — `ACPMessage` and all payload types (`TaskCreatePayload`, `RPCRequestPayload`, `MemoryRetrievePayload`, ...).
- **Blackboard** — 7 section types: `GoalSection`, `TaskSection`, `ClaimSection`, `ResultSection`, `ContextSection`, `ConsensusSection`, `ErrorSection`.
- **Error codes** — `KER`, `ACP_E`, `BB_E`, `CG_E` namespaces.
- **Config** — `envString`, `envNumber`, `envBool`, `loadConfig`, `DEFAULT_CONFIG`, `AgentOSConfig`.

## Usage

```typescript
import { createUUID, ResourceUnit, AgentState, DEFAULT_CONFIG, loadConfig } from '@agentos/types';

const agentId = createUUID();
const budget = ResourceUnit.compute(100, 0, 0, 0); // RU=100
const config = loadConfig(process.env);
```

Zod schemas for runtime validation:

```typescript
import { AgentSchema, TaskSchema } from '@agentos/types/zod';
const parsed = AgentSchema.parse(rawAgent);
```

## Configuration

`loadConfig()` reads environment variables via `envString`, `envNumber`, `envBool`. See `DEFAULT_CONFIG` for the full set of keys including kernel, event store, resource, and LLM settings.

## Tests

```bash
pnpm --filter @agentos/types test
```

## License

Proprietary — Nous Research