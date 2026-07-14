# @agentos/llm

LLM integration client for AgentOS. Connects agent capabilities to a task-based model router and tracks token consumption for resource accountability.

## Overview

Every LLM call in AgentOS flows through `LLMClient.complete()`, which forwards the request to a Model Router (localhost:8080 by default) with an `x-task-type` header derived by `CapabilityRouter`. The router selects the appropriate model for the task type (code generation, analysis, summarization, etc.). `TokenTracker` produces a `ResourceConsumption` record for every call, satisfying the constitutional requirement for resource conservation tracking (Invariant 1).

## API

- **`LLMClient`** — primary client; `complete()` sends a prompt and returns an `LLMResponse`.
- **`CapabilityRouter`** — maps capability paths to `TaskType` values for model routing.
- **`TokenTracker`** — tracks prompt/completion tokens and computes `ResourceConsumption` with `TokenCostConfig`.
- **Types** — `LLMClientConfig`, `LLMCompleteOptions`, `LLMResponse`, `ChatMessage`, `TaskType`, `TokenCostConfig`.
- **Constants** — `DEFAULT_LLM_CONFIG`, `DEFAULT_TOKEN_COSTS`.

## Usage

```typescript
import { LLMClient, CapabilityRouter, TokenTracker, DEFAULT_LLM_CONFIG } from '@agentos/llm';

const router = new CapabilityRouter();
const tracker = new TokenTracker(DEFAULT_TOKEN_COSTS);
const client = new LLMClient({
  ...DEFAULT_LLM_CONFIG,
  router,
  tracker,
});

const response = await client.complete({
  messages: [{ role: 'user', content: 'Summarize this PR.' }],
  taskType: router.route('code.review'),
});
console.log(response.content, response.usage);
```

## Configuration

`LLMClientConfig` (via `DEFAULT_LLM_CONFIG`) sets the router endpoint (`localhost:8080`), timeout, and retry policy. `TokenCostConfig` (via `DEFAULT_TOKEN_COSTS`) defines per-token RU/MU/EU/VU costs. No environment variables read directly.

## Tests

```bash
pnpm --filter @agentos/llm test
```

## License

Proprietary — Nous Research