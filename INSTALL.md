# AgentOS Installation Guide

## Prerequisites

- **Node.js** 20.0.0 or later
- **pnpm** 9.0.0 or later
- **Git** 2.30.0 or later
- **Playwright** (for browser automation — installed automatically)

### Optional
- **Docker** (for containerized deployment)
- **Tesseract** (for OCR in desktop automation)
- **Local LLM** (for offline inference — e.g., llama.cpp, Ollama)

## Installation

### From Source (Development)

```bash
# Clone the repository
git clone https://github.com/nousresearch/agentos.git
cd agentos

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Verify installation
npx tsx packages/benchmarks/src/cli/run-real-world.ts
```

### From npm (When Published)

```bash
# Install globally
npm install -g @agentos/cli

# Initialize workspace
agentos init

# Run a task
agentos run "Organize my downloads folder by file type"
```

## Configuration

AgentOS works out of the box with sensible defaults. To customize:

```bash
# Copy the example configuration
cp .env.example .env

# Edit configuration
# See CONFIGURATION.md for all available options
```

Key configuration options:

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTOS_LLM_BASE_URL` | `http://localhost:8080` | LLM Model Router URL |
| `AGENTOS_DATA_DIR` | `.agentos` | Telemetry and cache directory |
| `AGENTOS_LOG_LEVEL` | `info` | Logging verbosity |
| `AGENTOS_HEALTH_CHECK_URL` | `https://httpbin.org/head` | Connectivity probe URL |

See [CONFIGURATION.md](CONFIGURATION.md) for the complete list.

## Verifying Your Installation

```bash
# Run all tests
pnpm test

# Run the real-world task suite (makes actual API calls)
npx tsx packages/benchmarks/src/cli/run-real-world.ts

# Run the 100-benchmark suite
npx tsx packages/benchmarks/src/cli/run-all.ts
```

## Troubleshooting

### Build fails with TypeScript errors
The project has pre-existing TypeScript lib target warnings (Map, Promise, Set). These are warnings from the tsconfig, not actual build failures. If `pnpm build` completes, the build is successful.

### Playwright not found
```bash
npx playwright install chromium
```

### Port 8080 already in use
Set `AGENTOS_LLM_BASE_URL` to a different port:
```bash
export AGENTOS_LLM_BASE_URL=http://localhost:3000
```

### Tests fail
Ensure all dependencies are installed:
```bash
pnpm install
pnpm build
```

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| Linux | Supported | Primary development platform |
| macOS | Supported | Full functionality |
| Windows | Partial | Core works, desktop automation limited |

## Next Steps

- Read the [README.md](README.md) for architecture overview
- Read [CONFIGURATION.md](CONFIGURATION.md) for all configuration options
- Read [INTERNAL_DOGFOODING.md](INTERNAL_DOGFOODING.md) for daily usage scenarios
- Run `npx tsx packages/benchmarks/src/cli/run-real-world.ts` to see AgentOS in action