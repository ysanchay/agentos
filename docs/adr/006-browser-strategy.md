# ADR-006: Browser Strategy

**Status**: Accepted

**Date**: 2026-06-11

**Deciders**: Chief Architect, AI Architect, Systems Architect

**Constitution Reference**: capability-graph-v1.md (Articles I-XV), threat-model-v1.md (Articles I, VII)

---

## Context

AgentOS agents need to interact with the web: fetching pages, extracting content, filling forms, clicking buttons, taking screenshots, and navigating complex single-page applications. The challenge is that browser automation spans a vast capability spectrum -- from simple HTTP GET requests that return raw HTML to full browser automation that executes JavaScript, renders pages, and interacts with dynamic content.

Two competing approaches exist:

1. **HTTP-only (lightweight)**: Use native `fetch` to retrieve HTML and parse it with a built-in CSS selector parser. Zero external dependencies. Cannot execute JavaScript, take real screenshots, or interact with dynamic pages. Sufficient for reading server-rendered content, extracting links, and submitting simple forms.

2. **Full browser automation (heavyweight)**: Use Playwright to launch a real browser (Chromium, Firefox, or WebKit). Execute JavaScript, render pages, click elements, type text, scroll, hover, take screenshots, handle authentication, intercept network requests, and manage multiple tabs. Requires `playwright-core` as an external dependency with significant resource overhead (each browser instance consumes hundreds of MB of RAM and takes seconds to launch).

The tension: many AgentOS workspaces run on resource-constrained environments where launching a full browser is impractical. Other workspaces need JavaScript rendering to interact with modern web applications. Forcing all workspaces to use one strategy either leaves dynamic-site workspaces unable to function or forces lightweight workspaces to carry unnecessary dependencies and resource costs.

The capability graph constitution defines 25 browser capability paths under `perceive.browser.*` and `navigate.browser.*`. Some of these (like `perceive.browser.screenshot`) fundamentally require a JS-capable browser. Others (like `perceive.browser.text` or `perceive.browser.links`) work fine with HTTP-only access.

### Constraints

- Playwright is an optional peer dependency. AgentOS must work without it installed.
- Browser sessions are expensive resources. Uncontrolled session creation exhausts system memory.
- Different workspaces have different browser needs. A workspace scraping API docs needs HTTP only. A workspace testing a React app needs Playwright.
- The security hypervisor (ADR-005) classifies browser navigation capabilities (`navigate.browser.goto`, `navigate.browser.click`, `navigate.browser.type`) as approval-required in production mode because they have side effects.

---

## Decision

Implement a dual-strategy architecture with a common interface (`IBrowserStrategy`), automatic best-strategy selection, and session pooling. Agents never know which strategy is executing -- they call capability methods on the interface and receive typed results.

### Strategy Interface

Both strategies implement `IBrowserStrategy`, which defines the complete browser automation API:

```typescript
interface IBrowserStrategy {
  readonly name: string;          // 'http' or 'playwright'
  readonly supportsJS: boolean;  // false for HTTP, true for Playwright

  // Navigation
  goto(url, options?): Promise<PageState>;
  back(): Promise<PageState>;
  forward(): Promise<PageState>;
  reload(): Promise<PageState>;

  // Perception
  screenshot(options?): Promise<ScreenshotResult>;
  extract(options): Promise<ExtractResult>;
  query(options): Promise<ElementInfo[]>;

  // Interaction
  click(options): Promise<ActionResult>;
  type(options): Promise<ActionResult>;
  scroll(options): Promise<ActionResult>;
  hover(options): Promise<ActionResult>;
  select(options): Promise<ActionResult>;
  wait(condition, timeoutMs?): Promise<WaitResult>;

  // Advanced (Playwright only; HTTP returns REQUIRES_JS error)
  authenticate(options): Promise<AuthResult>;
  download(url, options?): Promise<DownloadResult>;
  interceptNetwork(pattern, handler): Promise<string>;
  // ... tabs, frames, dialogs, geolocation, timezone, drag-drop, file upload

  // Lifecycle
  close(): Promise<void>;
}
```

### HTTPStrategy

- **Name**: `http`
- **supportsJS**: `false`
- **Dependencies**: None (uses native `fetch` and a built-in CSS selector parser)
- **Capabilities supported**: `goto`, `back`, `forward`, `reload`, `extract`, `query`, `wait` (partial)
- **Capabilities unavailable**: `screenshot` (returns empty placeholder), `click`, `type`, `scroll`, `hover`, `select` (return `BROWSER_REQUIRES_JS` error), `authenticate`, `download`, `interceptNetwork`, tab/frame/dialog/geolocation operations
- **HTML parser**: Built-in `HTMLSelectorParser` supports tag selectors, `.class`, `#id`, `[attr]`, `[attr=value]`, descendant combinator (space), child combinator (`>`), `:first-child`, `:last-child`, `:nth-child(n)`. No external dependencies like cheerio.
- **Response size limit**: 5MB default (configurable via `maxResponseSize`)
- **Cookie handling**: Parses `Set-Cookie` headers and sends cookies on subsequent requests within the same strategy instance
- **Script/style stripping**: `<script>` and `<style>` blocks are skipped during parsing to reduce noise

### PlaywrightStrategy

- **Name**: `playwright`
- **supportsJS**: `true`
- **Dependencies**: `playwright-core` (optional peer dependency, lazy-loaded via dynamic `import()`)
- **Capabilities supported**: All `IBrowserStrategy` methods
- **Browser types**: `chromium` (default), `firefox`, `webkit`
- **Headless mode**: `true` by default
- **Viewport**: 1280x720 default
- **Lazy initialization**: Browser, context, and page are created on first use via `ensurePlaywright()` -> `ensureBrowser()` -> `ensureContext()` -> `ensurePage()` chain
- **Network interception**: Full request interception via `page.route()`, supporting block, mock, modify, and log actions
- **Authentication**: Full login flow automation with cookie and storage state extraction
- **Tab management**: Multi-tab support via context pages
- **Frame navigation**: `switchToFrame`/`switchToMainFrame` for iframe interaction

### Automatic Strategy Selection

`createBestStrategy()` resolves the strategy at runtime:

```typescript
async function createBestStrategy(
  playwrightConfig?: PlaywrightStrategyConfig,
  httpConfig?: HttpStrategyConfig,
): Promise<IBrowserStrategy> {
  if (await isPlaywrightAvailable()) {
    return new PlaywrightStrategy(playwrightConfig);
  }
  return new HTTPStrategy(httpConfig);
}
```

- `isPlaywrightAvailable()` attempts `import('playwright-core')`. If the import succeeds, Playwright is available. If it throws, Playwright is not installed.
- This check runs once at startup. The selected strategy is used for the lifetime of the browser pool.
- If Playwright is installed but browser binaries are missing, the strategy will fail on first `ensureBrowser()` call with a clear error message.

### Browser Pool (Session Management)

Browser sessions are pooled to prevent resource exhaustion:

```typescript
interface BrowserPoolConfig {
  maxSessions?: number;          // Default: 5
  idleTimeoutMs?: number;       // Default: 300,000 (5 minutes)
  maxTotalRequests?: number;    // Default: 1,000
  strategyType?: 'http' | 'playwright';
}
```

- **Session reuse**: When a workspace requests a session and an active session exists for that workspace, the existing session is reused (via `touch()` to update the last-activity timestamp).
- **Session lifecycle**: `active` -> `expired` (after idle timeout) -> `closed`. Expired sessions are recycled on the next `getSession()` call via `recycleExpired()`.
- **Eviction policy**: When the pool is at `maxSessions` capacity, the least-recently-used session (oldest `lastActivityAt`) is evicted to make room for the new session.
- **Pool shutdown**: `shutdown()` closes all sessions in parallel and clears the pool.
- **Request tracking**: Total request count across all sessions, capped at `maxTotalRequests`.

### Capability Path Mapping

The 25 browser capability paths map to strategy methods as follows:

| Capability Path | HTTPStrategy | PlaywrightStrategy | Resource Cost |
|-----------------|-------------|-------------------|---------------|
| `perceive.browser.html` | `extract({ selector: 'body', properties: ['html'] })` | Same | 1 EU |
| `perceive.browser.text` | `extract({ selector: 'body', properties: ['text'] })` | Same | 1 EU |
| `perceive.browser.links` | `extract({ selector: 'a', properties: ['href'] })` | Same | 1 EU |
| `perceive.browser.forms` | `extract({ selector: 'form', properties: ['html', 'attributes'] })` | Same | 1 EU |
| `perceive.browser.screenshot` | Empty placeholder (0x0) | Real PNG/JPEG screenshot | 1 EU + 1 VU |
| `perceive.browser.extract` | `extract(options)` | Same | 1 EU |
| `perceive.browser.query` | `query(options)` | Same | 1 EU |
| `perceive.browser.wait` | Partial (selector, text, timeout only) | Full (all conditions) | 1 EU |
| `navigate.browser.http` | `goto(url)` | `goto(url)` | 5 EU |
| `navigate.browser.redirect` | `goto(url)` (follows redirects) | `goto(url)` (follows redirects) | 5 EU |
| `navigate.browser.goto` | BROWSER_REQUIRES_JS error | `goto(url, options)` | 5 EU |
| `navigate.browser.click` | BROWSER_REQUIRES_JS error | `click(options)` | 1 EU |
| `navigate.browser.type` | BROWSER_REQUIRES_JS error | `type(options)` | 1 EU |
| `navigate.browser.scroll` | BROWSER_REQUIRES_JS error | `scroll(options)` | 1 EU |
| `navigate.browser.hover` | BROWSER_REQUIRES_JS error | `hover(options)` | 1 EU |
| `navigate.browser.select` | BROWSER_REQUIRES_JS error | `select(options)` | 1 EU |
| `navigate.browser.auth` | BROWSER_REQUIRES_JS error | `authenticate(options)` | 5 EU |
| `navigate.browser.download` | BROWSER_REQUIRES_JS error | `download(url, options)` | 5 EU |
| `navigate.browser.intercept` | BROWSER_REQUIRES_JS error | `interceptNetwork(pattern, handler)` | 5 EU |
| `navigate.browser.tabs` | Single tab only | `listTabs()`, `switchTab()`, `closeTab()` | 1 EU |
| `navigate.browser.frames` | No-op | `switchToFrame()`, `switchToMainFrame()` | 1 EU |
| `navigate.browser.dialog` | BROWSER_REQUIRES_JS error | `handleDialog(action)` | 1 EU |
| `navigate.browser.geolocation` | BROWSER_REQUIRES_JS error | `setGeolocation(options)` | 1 EU |
| `navigate.browser.timezone` | BROWSER_REQUIRES_JS error | `setTimezone(timezone)` | 1 EU |
| `navigate.browser.dragdrop` | BROWSER_REQUIRES_JS error | `dragDrop(options)` | 1 EU |

### Security Integration

Per the production security policy (ADR-005):

- **Perceive capabilities** (read-only, no side effects): Allowed without approval. Rate limited at 100-300 invocations/hour per agent.
- **Navigate capabilities** (side effects -- page changes, form submissions): Allowed but require approval in production mode. Rate limited at 50 invocations/hour per agent.
- **`actuate.desktop`** integration: Always requires approval.

The `BROWSER_REQUIRES_JS` error code is not a security denial -- it is a capability limitation. Agents receiving this error know to either: (a) request a workspace with Playwright installed, (b) adjust their task plan to avoid JS-dependent capabilities, or (c) report the task as blocked due to missing infrastructure.

---

## Consequences

### Positive

- **Zero-dependency baseline**: HTTPStrategy works everywhere. Any AgentOS deployment can browse the web, extract text and links, and navigate to URLs without installing anything beyond the core packages.
- **Graceful degradation**: When Playwright is absent, agents can still accomplish many web tasks. The `BROWSER_REQUIRES_JS` error clearly communicates which operations need Playwright, so agents can adapt their behavior rather than failing opaquely.
- **Transparent strategy selection**: Agents call `IBrowserStrategy` methods without knowing which strategy is active. This follows the capability graph principle: agents request capabilities, not tools. The system resolves the best implementation.
- **Resource efficiency**: HTTPStrategy sessions consume negligible memory (just the HTML string of the current page). Playwright sessions are pooled with configurable limits (default: 5 concurrent) and idle timeout recycling (default: 5 minutes), preventing uncontrolled browser process spawning.
- **Security alignment**: The security hypervisor treats browser perception capabilities as low-risk (no approval required) and browser navigation capabilities as moderate-risk (approval required in production). This matches the actual threat profile: reading a page is safe, clicking a button that submits a form is not.
- **Extensibility**: New strategies can be added by implementing `IBrowserStrategy`. A future `PuppeteerStrategy` or `SeleniumStrategy` would slot in without changing any agent code.

### Negative

- **Inconsistent capability availability**: An agent written and tested in a Playwright-enabled workspace will break when deployed to an HTTP-only workspace. The `supportsJS` flag and `BROWSER_REQUIRES_JS` error help, but the agent must be designed to handle both cases. Mitigation: agent capability declarations should explicitly list which browser capabilities they need. The capability resolver can then reject agents that require Playwright-only capabilities in HTTP-only workspaces before they are assigned tasks.
- **Playwright startup latency**: The first Playwright operation has a cold-start cost of ~2-5 seconds (browser launch + context creation + page creation). Subsequent operations are fast, but the first interaction is noticeably slower than HTTP. Mitigation: `createBestStrategy()` could eagerly launch the browser at pool creation time rather than on first use. This is not currently implemented.
- **Session state leakage**: Browser sessions reuse cookies, localStorage, and sessionStorage across requests within the same session. If workspace A and workspace B share a session, workspace A's login state could leak to workspace B. Current implementation tracks sessions by workspace ID, but the `getSession()` method's workspace matching is incomplete (noted as TODO in `browser-pool.ts`). Mitigation: sessions should be strictly workspace-isolated. One session per workspace, no sharing.
- **HTML parser limitations**: The built-in `HTMLSelectorParser` supports common CSS selectors but not all. Missing: sibling combinators (`+`, `~`), attribute operators `~=` and `|=`, pseudo-classes like `:not()`, `:nth-of-type()`, `:empty`, `:checked`, and complex compound selectors. Agents using unsupported selectors will silently get empty results. Mitigation: document supported selectors in the capability metadata. Consider adding cheerio as an optional dependency for HTTP mode (not currently implemented).
- **Pool eviction data loss**: When the pool evicts the least-recently-used session, any unsaved state in that session (cookies, localStorage, form data) is lost. An agent that was mid-workflow in an evicted session will need to restart its browser interaction. Mitigation: `idleTimeoutMs` should be set high enough (5 minutes default) that active workflows are rarely evicted. Agents can also persist critical state to the memory store before idle periods.
- **Screenshot placeholder confusion**: HTTPStrategy returns a `ScreenshotResult` with `data: ''`, `width: 0`, `height: 0`, and `sizeBytes: 0`. An agent that does not check these fields may believe it has a valid screenshot. Mitigation: the `BROWSER_REQUIRES_JS` error exists specifically for this case. Consider changing `screenshot()` in HTTPStrategy to throw an error rather than returning an empty placeholder, so agents fail fast instead of receiving misleading data.

### Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-------------|
| Playwright binary not installed | High | High (Playwright import succeeds but browser launch fails) | `isPlaywrightAvailable()` only checks the npm module, not the browser binary. Add a binary check at pool creation time. |
| Memory exhaustion from browser sessions | Medium | High (system OOM) | Pool `maxSessions` (default: 5) caps concurrent sessions. `idleTimeoutMs` recycles idle sessions. Production deployments should monitor pool status via `BrowserPool.status`. |
| Cross-workspace session leakage | Medium | High (TB-8 violation) | Enforce strict one-session-per-workspace policy. Never reuse sessions across workspaces. |
| HTML parser silently returns empty results | Medium | Medium (agent gets wrong data) | Document supported CSS selectors. Add `supportsSelector(selector)` method to `IBrowserStrategy` for pre-check. |
| Strategy mismatch at runtime (agent expects Playwright, gets HTTP) | Medium | High (task failure) | Capability resolver should check `supportsJS` before assigning browser tasks. Agents declare required browser capabilities in their capability list. |