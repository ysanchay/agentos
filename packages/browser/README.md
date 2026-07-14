# @agentos/browser

Browser automation runtime for AgentOS, exposed as capabilities. Agents interact with a unified browser API without knowing whether Playwright, HTTP, or another strategy is executing underneath.

## Overview

The browser package provides a strategy-based abstraction over browser automation. `PlaywrightStrategy` offers full DOM interaction (click, type, scroll, screenshot, extract) when `playwright-core` is available. `HTTPStrategy` provides lightweight HTTP-fetch-based page interaction as a fallback. `BrowserPool` manages session lifecycle and reuse, and `BrowserProvider` integrates the runtime into the capability system so agents invoke browser actions through standard capability paths.

## API

- **`BrowserProvider`** — capability provider integrating browser actions; config via `BrowserProviderConfig`.
- **`BrowserSession`** — single browser session with navigation, extraction, interaction, and screenshot APIs.
- **`BrowserPool`** — session pool with `BrowserPoolConfig` for concurrency management.
- **`HTTPStrategy`** — HTTP-only strategy for headless page fetching.
- **`PlaywrightStrategy`** — full browser strategy via `playwright-core`; `isPlaywrightAvailable()`, `createBestStrategy()`.
- **`IBrowserStrategy`** — interface implemented by all strategies.
- **Types** — `NavigateOptions`, `PageState`, `ScreenshotOptions`, `ExtractOptions`, `ExtractResult`, `ClickOptions`, `TypeOptions`, `WaitCondition`, `WaitResult`.
- **`BROWSER_ERRORS`** — typed error codes for browser failures.

## Usage

```typescript
import { BrowserProvider, createBestStrategy } from '@agentos/browser';

const strategy = createBestStrategy(); // Playwright if available, else HTTP
const provider = new BrowserProvider({ strategy });
const session = await provider.createSession();
await session.navigate('https://example.com');
const text = await session.extract({ selector: 'h1', property: 'textContent' });
await session.close();
```

## Configuration

`playwright-core` is an optional peer dependency (>=1.40.0). When absent, the runtime automatically falls back to `HTTPStrategy`. Strategy and pool config are passed programmatically.

## Tests

```bash
pnpm --filter @agentos/browser test
```

## License

Proprietary — Nous Research