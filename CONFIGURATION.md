# AgentOS Configuration Guide

AgentOS reads configuration from environment variables. All values have sensible defaults for local development, so no configuration is required to get started.

## Quick Start

```bash
# Copy the example configuration
cp .env.example .env

# Edit values as needed
# Then run AgentOS — it will pick up .env automatically
```

## Environment Variables

### LLM Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTOS_LLM_BASE_URL` | `http://localhost:8080` | Base URL of the LLM Model Router |
| `AGENTOS_LLM_TIMEOUT` | `120000` | Request timeout in milliseconds |
| `AGENTOS_LLM_MAX_RETRIES` | `3` | Max retries on transient errors |
| `AGENTOS_LLM_API_KEY` | (none) | API key for authentication (optional) |

### Connectivity

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTOS_HEALTH_CHECK_URL` | `https://httpbin.org/head` | URL for connectivity health checks |

### Swarm Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTOS_SWARM_MAX_WORKERS` | `10` | Max workers per manager |
| `AGENTOS_SWARM_MAX_RETRIES` | `3` | Max retries for failed tasks |
| `AGENTOS_SWARM_VALIDATION_THRESHOLD` | `0.7` | Validation consensus threshold (0.0-1.0) |
| `AGENTOS_SWARM_VALIDATORS_PER_RESULT` | `3` | Number of validators per task result |

### Data and Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTOS_DATA_DIR` | `.agentos` | Directory for telemetry and cache storage |
| `AGENTOS_LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

## Configuration in Code

You can also load configuration programmatically:

```typescript
import { loadConfig } from '@agentos/types';

const config = loadConfig();
console.log(config.llmBaseUrl);  // from AGENTOS_LLM_BASE_URL or default
```

## Docker Configuration

When running in Docker, pass environment variables via `-e` flags or a `docker-compose.yml`:

```yaml
services:
  agentos:
    image: agentos:alpha
    environment:
      - AGENTOS_LLM_BASE_URL=http://model-router:8080
      - AGENTOS_DATA_DIR=/data
      - AGENTOS_LOG_LEVEL=info
```