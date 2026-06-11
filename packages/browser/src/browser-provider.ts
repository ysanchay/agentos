/**
 * @agentos/browser — Browser Provider
 * ICapabilityProvider for browser automation.
 * Exposes perceive.browser.* (read-only) and navigate.browser.* (mutation) capabilities.
 * Delegates to IBrowserStrategy — agents never know the implementation.
 */

import type { ResourceConsumption, CapabilityPath } from '@agentos/types';
import type { ProviderExecuteContext, ProviderSandboxConfig } from '@agentos/capabilities';
import { ProviderBase, type ProviderBaseConfig, type ProviderCapabilityDef } from '@agentos/capabilities';
import type {
  NavigateOptions,
  ScreenshotOptions,
  ExtractOptions,
  QueryOptions,
  ClickOptions,
  TypeOptions,
  ScrollOptions,
  HoverOptions,
  SelectOptions,
  WaitCondition,
  BrowserPoolConfig,
  AuthOptions,
  DownloadOptions,
  NetworkPattern,
  NetworkHandler,
  DialogAction,
  GeolocationOptions,
  DragDropOptions,
  FileUploadOptions,
} from './types.js';
import { BROWSER_ERRORS } from './types.js';
import { BrowserPool } from './browser-pool.js';
import { HTTPStrategy } from './strategies/http-strategy.js';

// ─── Input Schemas ─────────────────────────────────────────────────────────

const URL_INPUT = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', description: 'URL to navigate to' },
    waitUntil: { type: 'string', enum: ['load', 'domcontentloaded', 'networkidle', 'commit'] },
    timeoutMs: { type: 'number', description: 'Navigation timeout in ms' },
    referrer: { type: 'string', description: 'HTTP referrer header' },
  },
} as const;

const EMPTY_INPUT = {
  type: 'object',
  properties: {},
} as const;

const SCREENSHOT_INPUT = {
  type: 'object',
  properties: {
    format: { type: 'string', enum: ['png', 'jpeg'] },
    quality: { type: 'number', description: 'JPEG quality 0-100' },
    fullPage: { type: 'boolean', description: 'Capture full scrollable page' },
    clipSelector: { type: 'string', description: 'CSS selector to clip to' },
  },
} as const;

const SELECTOR_INPUT = {
  type: 'object',
  required: ['selector'],
  properties: {
    selector: { type: 'string', description: 'CSS selector' },
  },
} as const;

const EXTRACT_INPUT = {
  type: 'object',
  required: ['selector'],
  properties: {
    selector: { type: 'string', description: 'CSS selector for element to extract' },
    properties: { type: 'array', items: { type: 'string' }, description: 'Properties to extract' },
    includeChildren: { type: 'boolean' },
    maxDepth: { type: 'number' },
  },
} as const;

const QUERY_INPUT = {
  type: 'object',
  required: ['selector'],
  properties: {
    selector: { type: 'string', description: 'CSS selector' },
    limit: { type: 'number', description: 'Maximum results (default 100)' },
  },
} as const;

const CLICK_INPUT = {
  type: 'object',
  required: ['selector'],
  properties: {
    selector: { type: 'string', description: 'CSS selector of element to click' },
    button: { type: 'string', enum: ['left', 'right', 'middle'] },
    clickCount: { type: 'number' },
    delay: { type: 'number', description: 'Delay between mousedown and mouseup in ms' },
    waitForNavigation: { type: 'boolean' },
    navigationTimeoutMs: { type: 'number' },
  },
} as const;

const TYPE_INPUT = {
  type: 'object',
  required: ['selector', 'text'],
  properties: {
    selector: { type: 'string', description: 'CSS selector of element to type into' },
    text: { type: 'string', description: 'Text to type' },
    delay: { type: 'number', description: 'Delay between keystrokes in ms' },
    clear: { type: 'boolean', description: 'Clear existing text before typing' },
  },
} as const;

const SCROLL_INPUT = {
  type: 'object',
  properties: {
    direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
    amount: { type: 'number', description: 'Scroll amount in pixels' },
    selector: { type: 'string', description: 'CSS selector to scroll within' },
  },
} as const;

const HOVER_INPUT = {
  type: 'object',
  required: ['selector'],
  properties: {
    selector: { type: 'string', description: 'CSS selector of element to hover' },
  },
} as const;

const SELECT_INPUT = {
  type: 'object',
  required: ['selector', 'values'],
  properties: {
    selector: { type: 'string', description: 'CSS selector of <select> element' },
    values: { type: 'array', items: { type: 'string' }, description: 'Values to select' },
  },
} as const;

const WAIT_INPUT = {
  type: 'object',
  required: ['condition'],
  properties: {
    condition: {
      type: 'object',
      description: 'Wait condition (selector, url, navigation, timeout, text, networkIdle, visible, hidden)',
    },
    timeoutMs: { type: 'number', description: 'Maximum wait time in ms' },
  },
} as const;

// ─── Advanced Capability Input Schemas ──────────────────────────────────────

const AUTH_INPUT = {
  type: 'object',
  required: ['loginUrl', 'usernameSelector', 'username', 'passwordSelector', 'password'],
  properties: {
    loginUrl: { type: 'string', description: 'URL of the login page' },
    usernameSelector: { type: 'string', description: 'CSS selector for username input' },
    username: { type: 'string', description: 'Username or email' },
    passwordSelector: { type: 'string', description: 'CSS selector for password input' },
    password: { type: 'string', description: 'Password' },
    submitSelector: { type: 'string', description: 'CSS selector for submit button' },
    successSelector: { type: 'string', description: 'Selector confirming login success' },
    timeoutMs: { type: 'number', description: 'Maximum time for login in ms' },
    cookies: { type: 'object', description: 'Cookies to set before login' },
    extraFields: { type: 'object', description: 'Additional form fields (selector → value)' },
  },
} as const;

const AUTH_OUTPUT = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    cookies: { type: 'object', description: 'Cookies after authentication' },
    storageState: { type: 'string', description: 'Serialized storage state' },
    finalUrl: { type: 'string' },
    error: { type: 'string' },
    durationMs: { type: 'number' },
  },
} as const;

const DOWNLOAD_INPUT = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', description: 'URL to download from' },
    suggestedFilename: { type: 'string', description: 'Suggested filename' },
    downloadDir: { type: 'string', description: 'Directory to save download to' },
    timeoutMs: { type: 'number', description: 'Maximum wait time in ms' },
  },
} as const;

const DOWNLOAD_OUTPUT = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    filePath: { type: 'string' },
    filename: { type: 'string' },
    sizeBytes: { type: 'number' },
    error: { type: 'string' },
    durationMs: { type: 'number' },
  },
} as const;

const INTERCEPT_INPUT = {
  type: 'object',
  required: ['pattern', 'handler'],
  properties: {
    pattern: {
      type: 'object',
      description: 'Network pattern to match',
      properties: {
        type: { type: 'string', enum: ['url', 'resourceType', 'method'] },
        pattern: { type: 'string' },
        resourceType: { type: 'string' },
        method: { type: 'string' },
      },
    },
    handler: {
      type: 'object',
      description: 'Action to take',
      properties: {
        action: { type: 'string', enum: ['block', 'mock', 'modify', 'log'] },
        status: { type: 'number' },
        body: { type: 'string' },
        headers: { type: 'object' },
      },
    },
  },
} as const;

const DIALOG_INPUT = {
  type: 'object',
  required: ['action'],
  properties: {
    action: { type: 'string', enum: ['accept', 'dismiss'], description: 'Dialog action' },
    inputText: { type: 'string', description: 'Text for prompt dialogs' },
  },
} as const;

const GEOLOCATION_INPUT = {
  type: 'object',
  required: ['latitude', 'longitude'],
  properties: {
    latitude: { type: 'number', description: 'Latitude (-90 to 90)' },
    longitude: { type: 'number', description: 'Longitude (-180 to 180)' },
    accuracy: { type: 'number', description: 'Accuracy in meters' },
  },
} as const;

const TIMEZONE_INPUT = {
  type: 'object',
  required: ['timezone'],
  properties: {
    timezone: { type: 'string', description: 'IANA timezone identifier (e.g., America/New_York)' },
  },
} as const;

const FRAME_INPUT = {
  type: 'object',
  required: ['selector'],
  properties: {
    selector: { type: 'string', description: 'CSS selector for the iframe' },
  },
} as const;

const TAB_INPUT = {
  type: 'object',
  required: ['tabId'],
  properties: {
    tabId: { type: 'string', description: 'Tab identifier' },
  },
} as const;

const DRAG_DROP_INPUT = {
  type: 'object',
  required: ['fromSelector', 'toSelector'],
  properties: {
    fromSelector: { type: 'string', description: 'CSS selector for source element' },
    toSelector: { type: 'string', description: 'CSS selector for target element' },
    delayMs: { type: 'number', description: 'Delay before releasing in ms' },
  },
} as const;

const FILE_UPLOAD_INPUT = {
  type: 'object',
  required: ['selector', 'files'],
  properties: {
    selector: { type: 'string', description: 'CSS selector for file input' },
    files: { type: 'array', items: { type: 'string' }, description: 'File paths to upload' },
  },
} as const;

const TABS_OUTPUT = {
  type: 'object',
  properties: {
    tabs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          tabId: { type: 'string' },
          url: { type: 'string' },
          title: { type: 'string' },
          active: { type: 'boolean' },
        },
      },
    },
  },
} as const;

// ─── Output Schemas ───────────────────────────────────────────────────────

const PAGE_STATE_OUTPUT = {
  type: 'object',
  properties: {
    url: { type: 'string' },
    title: { type: 'string' },
    statusCode: { type: 'number' },
    durationMs: { type: 'number' },
  },
} as const;

const SCREENSHOT_OUTPUT = {
  type: 'object',
  properties: {
    data: { type: 'string', description: 'Base64-encoded image' },
    mimeType: { type: 'string' },
    width: { type: 'number' },
    height: { type: 'number' },
    sizeBytes: { type: 'number' },
  },
} as const;

const EXTRACT_OUTPUT = {
  type: 'object',
  properties: {
    elements: { type: 'array' },
    count: { type: 'number' },
    selector: { type: 'string' },
  },
} as const;

const QUERY_OUTPUT = {
  type: 'object',
  properties: {
    elements: { type: 'array', items: { type: 'object' } },
  },
} as const;

const ACTION_OUTPUT = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    url: { type: 'string' },
    error: { type: 'string' },
    durationMs: { type: 'number' },
  },
} as const;

const WAIT_OUTPUT = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    durationMs: { type: 'number' },
    conditionType: { type: 'string' },
  },
} as const;

// ─── Provider Config ──────────────────────────────────────────────────────

export interface BrowserProviderConfig extends ProviderBaseConfig {
  /** Maximum concurrent browser sessions (default: 5) */
  maxSessions?: number;
  /** Session idle timeout in ms (default: 300000) */
  idleTimeoutMs?: number;
  /** Strategy type: 'http' or 'playwright' (default: auto-detect) */
  strategyType?: 'http' | 'playwright';
  /** Custom pool config (overrides individual settings) */
  poolConfig?: BrowserPoolConfig;
}

// ─── Browser Provider ─────────────────────────────────────────────────────

export class BrowserProvider extends ProviderBase {
  private pool: BrowserPool;

  constructor(config?: Partial<BrowserProviderConfig>) {
    const sandboxOverride: Partial<ProviderSandboxConfig> = {
      network: {
        enabled: true,
        allowedHosts: ['*'],
        allowOutbound: true,
        maxResponseSize: 10_000_000,
      },
      maxTimeoutMs: 60_000,
    };

    const poolConfig = config?.poolConfig ?? {
      maxSessions: config?.maxSessions ?? 5,
      idleTimeoutMs: config?.idleTimeoutMs ?? 300_000,
      strategyType: config?.strategyType,
    };

    // Perceive (observe) capabilities — read-only
    const observeDefs: ProviderCapabilityDef[] = [
      {
        path: 'perceive.browser.screenshot',
        displayName: 'Browser Screenshot',
        description: 'Capture a screenshot of the current browser page',
        inputSchema: SCREENSHOT_INPUT,
        outputSchema: SCREENSHOT_OUTPUT,
        handler: (input, ctx) => this.handleScreenshot(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 5, mu: 2, eu: 10, vu: 3 }, peak: { ru: 20, mu: 10, eu: 30, vu: 10 }, timeout_ms: 30_000 },
      },
      {
        path: 'perceive.browser.extract',
        displayName: 'Browser Extract',
        description: 'Extract content from the current browser page using CSS selectors',
        inputSchema: EXTRACT_INPUT,
        outputSchema: EXTRACT_OUTPUT,
        handler: (input, ctx) => this.handleExtract(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 3, mu: 5, eu: 5, vu: 2 }, peak: { ru: 10, mu: 20, eu: 15, vu: 5 }, timeout_ms: 15_000 },
      },
      {
        path: 'perceive.browser.query',
        displayName: 'Browser Query',
        description: 'Query elements on the current browser page using CSS selectors',
        inputSchema: QUERY_INPUT,
        outputSchema: QUERY_OUTPUT,
        handler: (input, ctx) => this.handleQuery(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 2, mu: 3, eu: 3, vu: 1 }, peak: { ru: 8, mu: 10, eu: 10, vu: 3 }, timeout_ms: 10_000 },
      },
      {
        path: 'perceive.browser.wait',
        displayName: 'Browser Wait',
        description: 'Wait for a condition on the browser page (element, text, navigation, etc.)',
        inputSchema: WAIT_INPUT,
        outputSchema: WAIT_OUTPUT,
        handler: (input, ctx) => this.handleWait(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 1, mu: 1, eu: 2, vu: 1 }, peak: { ru: 3, mu: 3, eu: 5, vu: 2 }, timeout_ms: 30_000 },
      },
    ];

    // Navigate (interact) capabilities — mutation, requires approval in production
    const navigateDefs: ProviderCapabilityDef[] = [
      {
        path: 'navigate.browser.goto',
        displayName: 'Browser Navigate',
        description: 'Navigate the browser to a URL',
        inputSchema: URL_INPUT,
        outputSchema: PAGE_STATE_OUTPUT,
        handler: (input, ctx) => this.handleGoto(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 5, mu: 3, eu: 15, vu: 5 }, peak: { ru: 20, mu: 10, eu: 40, vu: 10 }, timeout_ms: 30_000 },
      },
      {
        path: 'navigate.browser.back',
        displayName: 'Browser Back',
        description: 'Navigate back in browser history',
        inputSchema: EMPTY_INPUT,
        outputSchema: PAGE_STATE_OUTPUT,
        handler: (_input, ctx) => this.handleBack(ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 3, mu: 2, eu: 5, vu: 2 }, peak: { ru: 10, mu: 5, eu: 15, vu: 5 }, timeout_ms: 15_000 },
      },
      {
        path: 'navigate.browser.forward',
        displayName: 'Browser Forward',
        description: 'Navigate forward in browser history',
        inputSchema: EMPTY_INPUT,
        outputSchema: PAGE_STATE_OUTPUT,
        handler: (_input, ctx) => this.handleForward(ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 3, mu: 2, eu: 5, vu: 2 }, peak: { ru: 10, mu: 5, eu: 15, vu: 5 }, timeout_ms: 15_000 },
      },
      {
        path: 'navigate.browser.reload',
        displayName: 'Browser Reload',
        description: 'Reload the current browser page',
        inputSchema: EMPTY_INPUT,
        outputSchema: PAGE_STATE_OUTPUT,
        handler: (_input, ctx) => this.handleReload(ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 4, mu: 3, eu: 10, vu: 3 }, peak: { ru: 15, mu: 10, eu: 25, vu: 8 }, timeout_ms: 30_000 },
      },
      {
        path: 'navigate.browser.click',
        displayName: 'Browser Click',
        description: 'Click an element on the browser page',
        inputSchema: CLICK_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleClick(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 3, mu: 1, eu: 8, vu: 2 }, peak: { ru: 10, mu: 5, eu: 20, vu: 5 }, timeout_ms: 15_000 },
      },
      {
        path: 'navigate.browser.type',
        displayName: 'Browser Type',
        description: 'Type text into an element on the browser page',
        inputSchema: TYPE_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleType(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 3, mu: 1, eu: 8, vu: 2 }, peak: { ru: 10, mu: 5, eu: 20, vu: 5 }, timeout_ms: 15_000 },
      },
      {
        path: 'navigate.browser.scroll',
        displayName: 'Browser Scroll',
        description: 'Scroll the browser page or an element',
        inputSchema: SCROLL_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleScroll(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 2, mu: 1, eu: 5, vu: 1 }, peak: { ru: 5, mu: 3, eu: 10, vu: 2 }, timeout_ms: 10_000 },
      },
      {
        path: 'navigate.browser.hover',
        displayName: 'Browser Hover',
        description: 'Hover over an element on the browser page',
        inputSchema: HOVER_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleHover(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 2, mu: 1, eu: 5, vu: 1 }, peak: { ru: 5, mu: 3, eu: 10, vu: 2 }, timeout_ms: 10_000 },
      },
      {
        path: 'navigate.browser.select',
        displayName: 'Browser Select',
        description: 'Select options in a <select> element on the browser page',
        inputSchema: SELECT_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleSelect(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 3, mu: 1, eu: 8, vu: 2 }, peak: { ru: 10, mu: 5, eu: 20, vu: 5 }, timeout_ms: 15_000 },
      },
    ];

    // ─── Advanced Perceive Capabilities ──────────────────────────────────────

    const advancedPerceiveDefs: ProviderCapabilityDef[] = [
      {
        path: 'perceive.browser.auth-state',
        displayName: 'Browser Auth State',
        description: 'Check current authentication state (cookies, session)',
        inputSchema: EMPTY_INPUT,
        outputSchema: AUTH_OUTPUT,
        handler: (_input, ctx) => this.handleAuthState(ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 2, mu: 1, eu: 5, vu: 1 }, peak: { ru: 5, mu: 3, eu: 10, vu: 3 }, timeout_ms: 10_000 },
      },
      {
        path: 'perceive.browser.tabs',
        displayName: 'Browser Tabs',
        description: 'List all open browser tabs',
        inputSchema: EMPTY_INPUT,
        outputSchema: TABS_OUTPUT,
        handler: (_input, ctx) => this.handleListTabs(ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 1, mu: 1, eu: 2, vu: 1 }, peak: { ru: 3, mu: 3, eu: 5, vu: 2 }, timeout_ms: 5_000 },
      },
    ];

    // ─── Advanced Navigate Capabilities ─────────────────────────────────────

    const advancedNavigateDefs: ProviderCapabilityDef[] = [
      {
        path: 'navigate.browser.authenticate',
        displayName: 'Browser Authenticate',
        description: 'Execute an authentication flow (login) on a web page',
        inputSchema: AUTH_INPUT,
        outputSchema: AUTH_OUTPUT,
        handler: (input, ctx) => this.handleAuthenticate(input, ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 10, mu: 5, eu: 30, vu: 5 }, peak: { ru: 30, mu: 15, eu: 60, vu: 15 }, timeout_ms: 30_000 },
      },
      {
        path: 'navigate.browser.download',
        displayName: 'Browser Download',
        description: 'Download a file from the browser',
        inputSchema: DOWNLOAD_INPUT,
        outputSchema: DOWNLOAD_OUTPUT,
        handler: (input, ctx) => this.handleDownload(input, ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 5, mu: 10, eu: 20, vu: 3 }, peak: { ru: 15, mu: 50, eu: 40, vu: 10 }, timeout_ms: 60_000 },
      },
      {
        path: 'navigate.browser.intercept',
        displayName: 'Browser Network Intercept',
        description: 'Set up network request interception (block, mock, modify, or log)',
        inputSchema: INTERCEPT_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleIntercept(input, ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 3, mu: 2, eu: 5, vu: 2 }, peak: { ru: 10, mu: 5, eu: 15, vu: 5 }, timeout_ms: 10_000 },
      },
      {
        path: 'navigate.browser.dialog',
        displayName: 'Browser Dialog',
        description: 'Handle a browser dialog (alert, confirm, prompt)',
        inputSchema: DIALOG_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleDialog(input, ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 2, mu: 1, eu: 3, vu: 1 }, peak: { ru: 5, mu: 3, eu: 8, vu: 3 }, timeout_ms: 5_000 },
      },
      {
        path: 'navigate.browser.drag-drop',
        displayName: 'Browser Drag & Drop',
        description: 'Drag an element and drop it on another element',
        inputSchema: DRAG_DROP_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleDragDrop(input, ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 3, mu: 1, eu: 8, vu: 2 }, peak: { ru: 10, mu: 5, eu: 20, vu: 5 }, timeout_ms: 10_000 },
      },
      {
        path: 'navigate.browser.file-upload',
        displayName: 'Browser File Upload',
        description: 'Upload files to a file input element',
        inputSchema: FILE_UPLOAD_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleFileUpload(input, ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 3, mu: 5, eu: 10, vu: 2 }, peak: { ru: 10, mu: 20, eu: 30, vu: 5 }, timeout_ms: 30_000 },
      },
      {
        path: 'navigate.browser.switch-frame',
        displayName: 'Browser Switch Frame',
        description: 'Switch to an iframe on the page',
        inputSchema: FRAME_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleSwitchFrame(input, ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 2, mu: 1, eu: 5, vu: 1 }, peak: { ru: 5, mu: 3, eu: 10, vu: 3 }, timeout_ms: 10_000 },
      },
      {
        path: 'navigate.browser.switch-tab',
        displayName: 'Browser Switch Tab',
        description: 'Switch to a different browser tab',
        inputSchema: TAB_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleSwitchTab(input, ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 2, mu: 1, eu: 3, vu: 1 }, peak: { ru: 5, mu: 3, eu: 8, vu: 2 }, timeout_ms: 5_000 },
      },
      {
        path: 'navigate.browser.geolocation',
        displayName: 'Browser Set Geolocation',
        description: 'Set the browser geolocation for testing location-aware features',
        inputSchema: GEOLOCATION_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleSetGeolocation(input, ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 2, mu: 1, eu: 3, vu: 1 }, peak: { ru: 5, mu: 3, eu: 8, vu: 2 }, timeout_ms: 5_000 },
      },
      {
        path: 'navigate.browser.timezone',
        displayName: 'Browser Set Timezone',
        description: 'Set the browser timezone for testing time-aware features',
        inputSchema: TIMEZONE_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleSetTimezone(input, ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 2, mu: 1, eu: 3, vu: 1 }, peak: { ru: 5, mu: 3, eu: 8, vu: 2 }, timeout_ms: 5_000 },
      },
    ];

    const allDefs = [...observeDefs, ...navigateDefs, ...advancedPerceiveDefs, ...advancedNavigateDefs];

    super(
      {
        root: 'perceive', // Primary root is perceive (observe)
        providerId: config?.providerId,
        reliabilityScore: 0.85,
        avgLatencyMs: 500,
        successRate: 0.9,
        maxConcurrent: 20,
        sandboxConfig: sandboxOverride,
        ...config,
      },
      allDefs,
    );

    this.pool = new BrowserPool(poolConfig);
  }

  // ─── Perceive Handlers ──────────────────────────────────────────────────

  private async handleScreenshot(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const options: ScreenshotOptions = {
      format: input.format ?? 'png',
      quality: input.quality ?? 80,
      fullPage: input.fullPage ?? false,
      clipSelector: input.clipSelector,
    };

    const result = await strategy.screenshot(options);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 5, mu: 2, eu: 10, vu: 3 });
  }

  private async handleExtract(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const options: ExtractOptions = {
      selector: input.selector,
      properties: input.properties,
      includeChildren: input.includeChildren,
      maxDepth: input.maxDepth,
    };

    const result = await strategy.extract(options);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 3, mu: 5, eu: 5, vu: 2 });
  }

  private async handleQuery(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const options: QueryOptions = {
      selector: input.selector,
      limit: input.limit,
    };

    const result = await strategy.query(options);
    session.touch();
    this.pool.recordRequest();

    return this.success({ elements: result }, Date.now() - start, { ru: 2, mu: 3, eu: 3, vu: 1 });
  }

  private async handleWait(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const condition: WaitCondition = input.condition;
    const timeoutMs = input.timeoutMs ?? 5000;

    const result = await strategy.wait(condition, timeoutMs);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 1, mu: 1, eu: 2, vu: 1 });
  }

  // ─── Navigate Handlers ──────────────────────────────────────────────────

  private async handleGoto(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    // Validate URL
    const url = input.url;
    if (!url || !url.startsWith('http')) {
      throw new Error(`${BROWSER_ERRORS.NAVIGATION_FAILED}: Invalid URL: ${url}`);
    }

    const options: NavigateOptions = {
      waitUntil: input.waitUntil,
      timeoutMs: input.timeoutMs ?? Math.min(context.deadlineMs, 30_000),
      referrer: input.referrer,
    };

    const result = await strategy.goto(url, options);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 5, mu: 3, eu: 15, vu: 5 });
  }

  private async handleBack(context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const result = await session.browserStrategy.back();
    session.touch();
    this.pool.recordRequest();
    return this.success(result, Date.now() - start, { ru: 3, mu: 2, eu: 5, vu: 2 });
  }

  private async handleForward(context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const result = await session.browserStrategy.forward();
    session.touch();
    this.pool.recordRequest();
    return this.success(result, Date.now() - start, { ru: 3, mu: 2, eu: 5, vu: 2 });
  }

  private async handleReload(context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const result = await session.browserStrategy.reload();
    session.touch();
    this.pool.recordRequest();
    return this.success(result, Date.now() - start, { ru: 4, mu: 3, eu: 10, vu: 3 });
  }

  private async handleClick(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const options: ClickOptions = {
      selector: input.selector,
      button: input.button ?? 'left',
      clickCount: input.clickCount ?? 1,
      delay: input.delay,
      waitForNavigation: input.waitForNavigation,
      navigationTimeoutMs: input.navigationTimeoutMs,
    };

    const result = await strategy.click(options);
    session.touch();
    this.pool.recordRequest();

    if (!result.success) {
      context.log('warn', 'Browser click failed', { error: result.error });
    }

    return this.success(result, Date.now() - start, { ru: 3, mu: 1, eu: 8, vu: 2 });
  }

  private async handleType(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const options: TypeOptions = {
      selector: input.selector,
      text: input.text,
      delay: input.delay,
      clear: input.clear ?? true,
    };

    const result = await strategy.type(options);
    session.touch();
    this.pool.recordRequest();

    if (!result.success) {
      context.log('warn', 'Browser type failed', { error: result.error });
    }

    return this.success(result, Date.now() - start, { ru: 3, mu: 1, eu: 8, vu: 2 });
  }

  private async handleScroll(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const options: ScrollOptions = {
      direction: input.direction ?? 'down',
      amount: input.amount ?? 300,
      selector: input.selector,
    };

    const result = await strategy.scroll(options);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 2, mu: 1, eu: 5, vu: 1 });
  }

  private async handleHover(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const options: HoverOptions = {
      selector: input.selector,
    };

    const result = await strategy.hover(options);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 2, mu: 1, eu: 5, vu: 1 });
  }

  private async handleSelect(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const options: SelectOptions = {
      selector: input.selector,
      values: input.values,
    };

    const result = await strategy.select(options);
    session.touch();
    this.pool.recordRequest();

    if (!result.success) {
      context.log('warn', 'Browser select failed', { error: result.error });
    }

    return this.success(result, Date.now() - start, { ru: 3, mu: 1, eu: 8, vu: 2 });
  }

  // ─── Advanced Perceive Handlers ──────────────────────────────────────────

  private async handleAuthState(context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    // Auth state is read-only — check if we can get cookies/storage state
    // This requires JS, so if HTTP strategy is active, return current URL info
    if (!strategy.supportsJS) {
      return this.success({
        success: false,
        cookies: {},
        finalUrl: strategy.currentUrl(),
        error: `${BROWSER_ERRORS.REQUIRES_JS}: auth-state requires a JS-capable browser strategy`,
        durationMs: Date.now() - start,
      }, Date.now() - start, { ru: 2, mu: 1, eu: 5, vu: 1 });
    }

    // For Playwright strategy, we'd need to access context cookies/storageState
    // For now, return current page state info
    return this.success({
      success: true,
      cookies: {},
      finalUrl: strategy.currentUrl(),
      durationMs: Date.now() - start,
    }, Date.now() - start, { ru: 2, mu: 1, eu: 5, vu: 1 });
  }

  private async handleListTabs(context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const tabs = await strategy.listTabs();
    session.touch();
    this.pool.recordRequest();

    return this.success({ tabs }, Date.now() - start, { ru: 1, mu: 1, eu: 2, vu: 1 });
  }

  // ─── Advanced Navigate Handlers ──────────────────────────────────────────

  private async handleAuthenticate(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const options: AuthOptions = {
      loginUrl: input.loginUrl,
      usernameSelector: input.usernameSelector,
      username: input.username,
      passwordSelector: input.passwordSelector,
      password: input.password,
      submitSelector: input.submitSelector,
      successSelector: input.successSelector,
      timeoutMs: input.timeoutMs,
      cookies: input.cookies,
      extraFields: input.extraFields,
    };

    const result = await strategy.authenticate(options);
    session.touch();
    this.pool.recordRequest();

    if (!result.success) {
      context.log('warn', 'Browser authentication failed', { error: result.error });
    }

    return this.success(result, Date.now() - start, { ru: 10, mu: 5, eu: 30, vu: 5 });
  }

  private async handleDownload(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const options: DownloadOptions = {
      url: input.url,
      suggestedFilename: input.suggestedFilename,
      downloadDir: input.downloadDir,
      timeoutMs: input.timeoutMs,
    };

    const result = await strategy.download(input.url, options);
    session.touch();
    this.pool.recordRequest();

    if (!result.success) {
      context.log('warn', 'Browser download failed', { error: result.error });
    }

    return this.success(result, Date.now() - start, { ru: 5, mu: 10, eu: 20, vu: 3 });
  }

  private async handleIntercept(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const pattern: NetworkPattern = input.pattern;
    const handler: NetworkHandler = input.handler;

    const interceptionId = await strategy.interceptNetwork(pattern, handler);
    session.touch();
    this.pool.recordRequest();

    return this.success({ success: true, interceptionId, durationMs: Date.now() - start }, Date.now() - start, { ru: 3, mu: 2, eu: 5, vu: 2 });
  }

  private async handleDialog(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const action: DialogAction = {
      action: input.action,
      inputText: input.inputText,
    };

    const result = await strategy.handleDialog(action);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 2, mu: 1, eu: 3, vu: 1 });
  }

  private async handleDragDrop(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const options: DragDropOptions = {
      fromSelector: input.fromSelector,
      toSelector: input.toSelector,
      delayMs: input.delayMs,
    };

    const result = await strategy.dragDrop(options);
    session.touch();
    this.pool.recordRequest();

    if (!result.success) {
      context.log('warn', 'Browser drag-drop failed', { error: result.error });
    }

    return this.success(result, Date.now() - start, { ru: 3, mu: 1, eu: 8, vu: 2 });
  }

  private async handleFileUpload(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const options: FileUploadOptions = {
      selector: input.selector,
      files: input.files,
    };

    const result = await strategy.fileUpload(options);
    session.touch();
    this.pool.recordRequest();

    if (!result.success) {
      context.log('warn', 'Browser file upload failed', { error: result.error });
    }

    return this.success(result, Date.now() - start, { ru: 3, mu: 5, eu: 10, vu: 2 });
  }

  private async handleSwitchFrame(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const result = await strategy.switchToFrame(input.selector);
    session.touch();
    this.pool.recordRequest();

    if (!result.success) {
      context.log('warn', 'Browser switch frame failed', { error: result.error });
    }

    return this.success(result, Date.now() - start, { ru: 2, mu: 1, eu: 5, vu: 1 });
  }

  private async handleSwitchTab(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const result = await strategy.switchTab(input.tabId);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 2, mu: 1, eu: 3, vu: 1 });
  }

  private async handleSetGeolocation(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const options: GeolocationOptions = {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
    };

    const result = await strategy.setGeolocation(options);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 2, mu: 1, eu: 3, vu: 1 });
  }

  private async handleSetTimezone(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.browserStrategy;

    const result = await strategy.setTimezone(input.timezone);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 2, mu: 1, eu: 3, vu: 1 });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    // Pool is lazy — sessions created on demand
  }

  override async shutdown(): Promise<void> {
    await this.pool.shutdown();
  }

  protected override async performHealthCheck(): Promise<{ healthy: boolean; details?: unknown }> {
    try {
      const status = this.pool.status;
      return {
        healthy: true,
        details: {
          activeSessions: status.activeSessions,
          totalRequests: status.totalRequests,
        },
      };
    } catch {
      return { healthy: false };
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async getOrCreateSession(context: ProviderExecuteContext): Promise<import('./browser-session.js').BrowserSession> {
    const workspaceId = context.invocation.caller?.workspace_id ?? 'default';
    return this.pool.getSession(workspaceId);
  }
}