/**
 * @agentos/browser — Browser Runtime
 * Browser automation exposed as capabilities.
 * Agents never know whether Playwright, HTTP, or another strategy is executing.
 */

// Provider
export { BrowserProvider, type BrowserProviderConfig } from './browser-provider.js';

// Session + Pool
export { BrowserSession } from './browser-session.js';
export { BrowserPool } from './browser-pool.js';

// Strategies
export { HTTPStrategy, type HttpStrategyConfig } from './strategies/http-strategy.js';
export { PlaywrightStrategy, type PlaywrightStrategyConfig, isPlaywrightAvailable, createBestStrategy } from './strategies/playwright-strategy.js';

// Types
export type {
  IBrowserStrategy,
  NavigateOptions,
  PageState,
  ScreenshotOptions,
  ScreenshotResult,
  ExtractOptions,
  ExtractProperty,
  ExtractResult,
  ExtractedElement,
  QueryOptions,
  ElementInfo,
  ClickOptions,
  TypeOptions,
  ScrollOptions,
  HoverOptions,
  SelectOptions,
  ActionResult,
  WaitCondition,
  WaitResult,
  BrowserSessionConfig,
  BrowserSessionState,
  BrowserPoolConfig,
} from './types.js';

export { BROWSER_ERRORS } from './types.js';