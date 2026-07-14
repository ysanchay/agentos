# @agentos/memory

Four-tier memory engine for AgentOS. Provides L1 Working Memory, L2 Workspace Memory, L3 Long-Term Memory, and L4 Knowledge Graph — with semantic search, graph traversal, and a unified orchestrator.

## Overview

Every completed task, ACP message, validation result, resource allocation, and decision generates memory artifacts that can later be retrieved through semantic search and graph traversal. The `MemoryOrchestrator` provides a single API that automatically routes stores and queries to the appropriate tier. L1 holds ephemeral per-agent context, L2 persists workspace-scoped session memory, L3 stores durable long-term observations, and L4 models relationships as a knowledge graph.

## API

- **`L1WorkingMemory`** — ephemeral, per-agent working context (in-process).
- **`L2WorkspaceMemory`** — workspace-scoped session memory with TTL.
- **`L3LongTermMemory`** — durable long-term storage with semantic retrieval.
- **`L4KnowledgeGraph`** — graph of `GraphNode` / `GraphEdge` with `GraphTraversalOptions`.
- **`MemoryOrchestrator`** — unified store/search/delete API across all tiers.
- **Types** — `MemoryQuery`, `MemorySearchResult`, `MemoryStoreOptions`, `MemoryEngineConfig`, `MemoryStats`.
- **Constants** — `L1_WORKING`, `L2_WORKSPACE`, `L3_LONG_TERM`, `L4_KNOWLEDGE_GRAPH`, `DEFAULT_MEMORY_CONFIG`.

## Usage

```typescript
import { MemoryOrchestrator } from '@agentos/memory';

const memory = new MemoryOrchestrator(DEFAULT_MEMORY_CONFIG);
await memory.store({
  tier: 'L3',
  agentId,
  workspaceId,
  type: 'task_result',
  content: { summary: 'Deployed API v2', confidence: 0.95 },
});
const results = await memory.search({ query: 'API deployment', tier: 'L3', limit: 10 });
```

## Configuration

`MemoryEngineConfig` (via `DEFAULT_MEMORY_CONFIG`) controls tier capacities, TTLs, and graph traversal depth. No environment variables read directly.

## Tests

```bash
pnpm --filter @agentos/memory test
```

## License

Proprietary — Nous Research