# @agentos/desktop

Desktop automation runtime for AgentOS, exposed as capabilities. Implements a 4-strategy abstraction (Native, NutJS, UIAutomation, OCR) so agents can interact with desktop applications through a unified API.

## Overview

The desktop package provides OS-level automation through pluggable strategies. `NativeStrategy` uses accessibility APIs for screen-reader-style tree inspection. `NutJSStrategy` leverages `@nut-tree-fork/nut-js` for mouse/keyboard simulation. `UIAutomationStrategy` targets platform UI automation frameworks. `OCRStrategy` falls back to optical character recognition when accessibility trees are unavailable. `DesktopPool` manages session reuse, `WindowManager` handles window focus and layout, and `DesktopProvider` integrates everything into the capability system.

## API

- **`DesktopProvider`** — capability provider; config via `DesktopProviderConfig`.
- **`DesktopSession`** — single desktop session with navigation, tree reading, interaction, and screenshot.
- **`DesktopPool`** — session pool with `DesktopPoolConfig`.
- **Strategies** — `NativeStrategy`, `NutJSStrategy`, `UIAutomationStrategy`, `OCRStrategy` (all implement `IDesktopStrategy`).
- **`createBestDesktopStrategy()`** / `createDesktopStrategy()` — strategy selection helpers; `isNutJSAvailable()`, `isUIAutomationAvailable()`, `hasDisplay()`.
- **`WindowManager`** — window focus, listing, and management with `WindowSnapshot`.
- **Types** — `WindowInfo`, `AccessibilityTreeNode`, `AccessibilityTree`, `DesktopElement`, `ElementContent`, `DesktopActionResult`, `ProcessInfo`, `TrayIconInfo`.
- **`DESKTOP_ERRORS`** — typed error codes.

## Usage

```typescript
import { DesktopProvider, createBestDesktopStrategy } from '@agentos/desktop';

const strategy = createBestDesktopStrategy();
const provider = new DesktopProvider({ strategy });
const session = await provider.createSession();
const tree = await session.getAccessibilityTree();
await session.click({ selector: 'button[title=Save]' });
await session.close();
```

## Configuration

`@nut-tree-fork/nut-js` is an optional peer dependency (>=4.0.0). Strategy selection is automatic via `createBestDesktopStrategy()`, which probes for available backends and display availability.

## Tests

```bash
pnpm --filter @agentos/desktop test
```

## License

Proprietary — Nous Research