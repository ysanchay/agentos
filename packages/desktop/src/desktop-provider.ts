/**
 * @agentos/desktop — Desktop Provider
 * ICapabilityProvider for desktop automation.
 * Exposes perceive.desktop.* (read-only) and actuate.desktop.* (mutation) capabilities.
 * Delegates to IDesktopStrategy — agents never know the implementation.
 */

import type { ResourceConsumption } from '@agentos/types';
import type { ProviderExecuteContext, ProviderSandboxConfig } from '@agentos/capabilities';
import { ProviderBase, type ProviderBaseConfig, type ProviderCapabilityDef } from '@agentos/capabilities';
import type {
  DesktopScreenshotOptions,
  DesktopTreeOptions,
  DesktopQueryOptions,
  DesktopReadOptions,
  DesktopClickOptions,
  DesktopTypeOptions,
  DesktopScrollOptions,
  DesktopLaunchOptions,
  DesktopFocusOptions,
  DesktopKeyOptions,
  DesktopPoolConfig,
  DesktopDragDropOptions,
  DesktopFileUploadOptions,
  ProcessInfo,
  TrayIconInfo,
} from './types.js';
import { DESKTOP_ERRORS } from './types.js';
import { DesktopPool } from './desktop-pool.js';
import { NativeStrategy } from './strategies/native-strategy.js';

// ─── Input Schemas ─────────────────────────────────────────────────────────

const SCREENSHOT_INPUT = {
  type: 'object',
  properties: {
    windowId: { type: 'string', description: 'Target window ID (null = full screen)' },
    region: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } }, description: 'Region to capture' },
    format: { type: 'string', enum: ['png', 'jpeg'], description: 'Output format' },
    quality: { type: 'number', description: 'JPEG quality 1-100' },
  },
} as const;

const TREE_INPUT = {
  type: 'object',
  properties: {
    windowId: { type: 'string', description: 'Target window ID (null = active window)' },
    maxDepth: { type: 'number', description: 'Maximum depth to traverse (default: 10)' },
    roles: { type: 'array', items: { type: 'string' }, description: 'Filter by roles' },
  },
} as const;

const QUERY_INPUT = {
  type: 'object',
  properties: {
    role: { type: 'string', description: 'Accessibility role to search for' },
    name: { type: 'string', description: 'Element name (substring match)' },
    id: { type: 'string', description: 'Element ID' },
    selector: { type: 'string', description: 'CSS-like selector' },
    limit: { type: 'number', description: 'Maximum results (default: 100)' },
    windowId: { type: 'string', description: 'Target window ID' },
  },
} as const;

const READ_INPUT = {
  type: 'object',
  required: ['elementId'],
  properties: {
    elementId: { type: 'string', description: 'Element ID to read' },
    windowId: { type: 'string', description: 'Target window ID' },
    properties: { type: 'array', items: { type: 'string' }, description: 'Properties to read' },
  },
} as const;

const CLICK_INPUT = {
  type: 'object',
  properties: {
    x: { type: 'number', description: 'X coordinate to click' },
    y: { type: 'number', description: 'Y coordinate to click' },
    elementId: { type: 'string', description: 'Element ID to click' },
    button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button' },
    clickCount: { type: 'number', description: 'Number of clicks' },
  },
} as const;

const TYPE_INPUT = {
  type: 'object',
  required: ['text'],
  properties: {
    text: { type: 'string', description: 'Text to type' },
    elementId: { type: 'string', description: 'Element ID to type into' },
    delay: { type: 'number', description: 'Delay between keystrokes in ms' },
    clear: { type: 'boolean', description: 'Clear existing text before typing' },
  },
} as const;

const SCROLL_INPUT = {
  type: 'object',
  properties: {
    direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
    amount: { type: 'number', description: 'Scroll amount in pixels' },
    elementId: { type: 'string', description: 'Element ID to scroll within' },
  },
} as const;

const LAUNCH_INPUT = {
  type: 'object',
  required: ['app'],
  properties: {
    app: { type: 'string', description: 'Application name or path' },
    args: { type: 'array', items: { type: 'string' }, description: 'Command-line arguments' },
    cwd: { type: 'string', description: 'Working directory' },
    waitForReady: { type: 'boolean', description: 'Wait for app to be ready' },
    timeoutMs: { type: 'number', description: 'Maximum wait time in ms' },
  },
} as const;

const FOCUS_INPUT = {
  type: 'object',
  properties: {
    windowId: { type: 'string', description: 'Window ID to focus' },
    elementId: { type: 'string', description: 'Element ID to focus' },
    appName: { type: 'string', description: 'Application name to focus' },
  },
} as const;

const KEY_INPUT = {
  type: 'object',
  required: ['key'],
  properties: {
    key: { type: 'string', description: 'Key or key combination (e.g., "ctrl+c")' },
    modifiers: { type: 'array', items: { type: 'string', enum: ['ctrl', 'alt', 'shift', 'meta'] }, description: 'Key modifiers' },
    count: { type: 'number', description: 'Number of times to press' },
  },
} as const;

// ─── Advanced Capability Input Schemas ──────────────────────────────────────────

const PROCESS_LIST_INPUT = {
  type: 'object',
  properties: {
    filter: { type: 'string', description: 'Process name filter (substring match)' },
    limit: { type: 'number', description: 'Maximum results (default: 100)' },
  },
} as const;

const PROCESS_LIST_OUTPUT = {
  type: 'object',
  properties: {
    processes: { type: 'array', items: { type: 'object' } },
    count: { type: 'number' },
  },
} as const;

const WINDOW_LIST_INPUT = {
  type: 'object',
  properties: {
    filter: { type: 'string', description: 'Window title filter (substring match)' },
    limit: { type: 'number', description: 'Maximum results (default: 50)' },
  },
} as const;

const TRAY_INPUT = {
  type: 'object',
  properties: {},
} as const;

const TRAY_OUTPUT = {
  type: 'object',
  properties: {
    icons: { type: 'array', items: { type: 'object' } },
    count: { type: 'number' },
  },
} as const;

const DRAG_DROP_INPUT = {
  type: 'object',
  properties: {
    fromElementId: { type: 'string', description: 'Source element ID' },
    fromX: { type: 'number', description: 'Source X coordinate' },
    fromY: { type: 'number', description: 'Source Y coordinate' },
    toElementId: { type: 'string', description: 'Target element ID' },
    toX: { type: 'number', description: 'Target X coordinate' },
    toY: { type: 'number', description: 'Target Y coordinate' },
  },
} as const;

const FILE_UPLOAD_INPUT = {
  type: 'object',
  required: ['files'],
  properties: {
    elementId: { type: 'string', description: 'Element ID of the file input' },
    files: { type: 'array', items: { type: 'string' }, description: 'File paths to upload' },
  },
} as const;

// ─── Output Schemas ───────────────────────────────────────────────────────

const SCREENSHOT_OUTPUT = {
  type: 'object',
  properties: {
    data: { type: 'string', description: 'Base64-encoded image data' },
    mimeType: { type: 'string' },
    width: { type: 'number' },
    height: { type: 'number' },
    sizeBytes: { type: 'number' },
  },
} as const;

const TREE_OUTPUT = {
  type: 'object',
  properties: {
    root: { type: 'object' },
    nodeCount: { type: 'number' },
    maxDepth: { type: 'number' },
    window: { type: 'object' },
  },
} as const;

const QUERY_OUTPUT = {
  type: 'object',
  properties: {
    elements: { type: 'array', items: { type: 'object' } },
  },
} as const;

const READ_OUTPUT = {
  type: 'object',
  properties: {
    elementId: { type: 'string' },
    text: { type: 'string' },
    value: { type: 'string' },
    role: { type: 'string' },
    name: { type: 'string' },
    properties: { type: 'object' },
  },
} as const;

const ACTION_OUTPUT = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    error: { type: 'string' },
    durationMs: { type: 'number' },
    window: { type: 'object' },
  },
} as const;

// ─── Provider Config ──────────────────────────────────────────────────────────

export interface DesktopProviderConfig extends ProviderBaseConfig {
  /** Maximum concurrent desktop sessions (default: 3) */
  maxSessions?: number;
  /** Session idle timeout in ms (default: 300000) */
  idleTimeoutMs?: number;
  /** Strategy type: 'native' or 'nutjs' (default: auto-detect) */
  strategyType?: 'native' | 'nutjs';
  /** Custom pool config */
  poolConfig?: DesktopPoolConfig;
}

// ─── Desktop Provider ─────────────────────────────────────────────────────────

export class DesktopProvider extends ProviderBase {
  private pool: DesktopPool;

  constructor(config?: Partial<DesktopProviderConfig>) {
    const sandboxOverride: Partial<ProviderSandboxConfig> = {
      network: {
        enabled: false, // Desktop doesn't need network by default
        allowedHosts: [],
        allowOutbound: false,
        maxResponseSize: 0,
      },
      maxTimeoutMs: 30_000,
    };

    const poolConfig = config?.poolConfig ?? {
      maxSessions: config?.maxSessions ?? 3,
      idleTimeoutMs: config?.idleTimeoutMs ?? 300_000,
      strategyType: config?.strategyType,
    };

    // Perceive (observe) capabilities — read-only
    const perceiveDefs: ProviderCapabilityDef[] = [
      {
        path: 'perceive.desktop.screenshot',
        displayName: 'Desktop Screenshot',
        description: 'Capture a screenshot of the desktop or a specific window',
        inputSchema: SCREENSHOT_INPUT,
        outputSchema: SCREENSHOT_OUTPUT,
        handler: (input, ctx) => this.handleScreenshot(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 5, mu: 3, eu: 10, vu: 5 }, peak: { ru: 20, mu: 15, eu: 30, vu: 10 }, timeout_ms: 15_000 },
      },
      {
        path: 'perceive.desktop.tree',
        displayName: 'Desktop Accessibility Tree',
        description: 'Get the accessibility tree of a desktop window',
        inputSchema: TREE_INPUT,
        outputSchema: TREE_OUTPUT,
        handler: (input, ctx) => this.handleTree(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 4, mu: 8, eu: 5, vu: 2 }, peak: { ru: 15, mu: 30, eu: 20, vu: 5 }, timeout_ms: 10_000 },
      },
      {
        path: 'perceive.desktop.query',
        displayName: 'Desktop Query',
        description: 'Find desktop elements by role, name, or ID',
        inputSchema: QUERY_INPUT,
        outputSchema: QUERY_OUTPUT,
        handler: (input, ctx) => this.handleQuery(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 3, mu: 5, eu: 3, vu: 1 }, peak: { ru: 10, mu: 20, eu: 10, vu: 3 }, timeout_ms: 10_000 },
      },
      {
        path: 'perceive.desktop.read',
        displayName: 'Desktop Read',
        description: 'Read content from a specific desktop element',
        inputSchema: READ_INPUT,
        outputSchema: READ_OUTPUT,
        handler: (input, ctx) => this.handleRead(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 2, mu: 3, eu: 3, vu: 1 }, peak: { ru: 8, mu: 10, eu: 10, vu: 3 }, timeout_ms: 5_000 },
      },
    ];

    // Actuate (interact) capabilities — mutation, requires approval in production
    const actuateDefs: ProviderCapabilityDef[] = [
      {
        path: 'actuate.desktop.click',
        displayName: 'Desktop Click',
        description: 'Click at coordinates or on a desktop element',
        inputSchema: CLICK_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleClick(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 3, mu: 1, eu: 8, vu: 3 }, peak: { ru: 10, mu: 5, eu: 20, vu: 5 }, timeout_ms: 5_000 },
      },
      {
        path: 'actuate.desktop.type',
        displayName: 'Desktop Type',
        description: 'Type text into the focused desktop element',
        inputSchema: TYPE_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleType(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 3, mu: 1, eu: 8, vu: 3 }, peak: { ru: 10, mu: 5, eu: 20, vu: 5 }, timeout_ms: 10_000 },
      },
      {
        path: 'actuate.desktop.scroll',
        displayName: 'Desktop Scroll',
        description: 'Scroll a desktop window or element',
        inputSchema: SCROLL_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleScroll(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 2, mu: 1, eu: 5, vu: 1 }, peak: { ru: 5, mu: 3, eu: 10, vu: 2 }, timeout_ms: 5_000 },
      },
      {
        path: 'actuate.desktop.launch',
        displayName: 'Desktop Launch App',
        description: 'Launch a desktop application',
        inputSchema: LAUNCH_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleLaunch(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 5, mu: 2, eu: 15, vu: 5 }, peak: { ru: 20, mu: 10, eu: 40, vu: 10 }, timeout_ms: 30_000 },
      },
      {
        path: 'actuate.desktop.focus',
        displayName: 'Desktop Focus',
        description: 'Focus a desktop window or element',
        inputSchema: FOCUS_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleFocus(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 2, mu: 1, eu: 3, vu: 1 }, peak: { ru: 5, mu: 3, eu: 10, vu: 3 }, timeout_ms: 5_000 },
      },
      {
        path: 'actuate.desktop.key',
        displayName: 'Desktop Key Press',
        description: 'Press a key or key combination on the desktop',
        inputSchema: KEY_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleKey(input, ctx),
        stability: 'beta',
        resourceProfile: { typical: { ru: 2, mu: 1, eu: 5, vu: 2 }, peak: { ru: 5, mu: 3, eu: 10, vu: 3 }, timeout_ms: 5_000 },
      },
    ];

    // ─── Advanced Perceive Capabilities ──────────────────────────────────────

    const advancedPerceiveDefs: ProviderCapabilityDef[] = [
      {
        path: 'perceive.desktop.process-list',
        displayName: 'Desktop Process List',
        description: 'List running processes on the desktop',
        inputSchema: PROCESS_LIST_INPUT,
        outputSchema: PROCESS_LIST_OUTPUT,
        handler: (input, ctx) => this.handleProcessList(input, ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 3, mu: 5, eu: 5, vu: 2 }, peak: { ru: 10, mu: 15, eu: 15, vu: 5 }, timeout_ms: 10_000 },
      },
      {
        path: 'perceive.desktop.window-list',
        displayName: 'Desktop Window List',
        description: 'List all open windows on the desktop',
        inputSchema: WINDOW_LIST_INPUT,
        outputSchema: PROCESS_LIST_OUTPUT,
        handler: (input, ctx) => this.handleWindowList(input, ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 2, mu: 3, eu: 3, vu: 1 }, peak: { ru: 8, mu: 10, eu: 10, vu: 3 }, timeout_ms: 5_000 },
      },
      {
        path: 'perceive.desktop.tray',
        displayName: 'Desktop System Tray',
        description: 'Read system tray icons on the desktop',
        inputSchema: TRAY_INPUT,
        outputSchema: TRAY_OUTPUT,
        handler: (_input, ctx) => this.handleTray(ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 2, mu: 2, eu: 3, vu: 1 }, peak: { ru: 5, mu: 5, eu: 8, vu: 2 }, timeout_ms: 5_000 },
      },
    ];

    // ─── Advanced Actuate Capabilities ──────────────────────────────────────

    const advancedActuateDefs: ProviderCapabilityDef[] = [
      {
        path: 'actuate.desktop.drag-drop',
        displayName: 'Desktop Drag & Drop',
        description: 'Drag and drop elements on the desktop',
        inputSchema: DRAG_DROP_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleDragDrop(input, ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 3, mu: 1, eu: 8, vu: 3 }, peak: { ru: 10, mu: 5, eu: 20, vu: 5 }, timeout_ms: 10_000 },
      },
      {
        path: 'actuate.desktop.file-upload',
        displayName: 'Desktop File Upload',
        description: 'Upload files via a desktop file dialog',
        inputSchema: FILE_UPLOAD_INPUT,
        outputSchema: ACTION_OUTPUT,
        handler: (input, ctx) => this.handleFileUpload(input, ctx),
        stability: 'experimental',
        resourceProfile: { typical: { ru: 3, mu: 5, eu: 10, vu: 2 }, peak: { ru: 10, mu: 20, eu: 30, vu: 5 }, timeout_ms: 30_000 },
      },
    ];

    const allDefs = [...perceiveDefs, ...actuateDefs, ...advancedPerceiveDefs, ...advancedActuateDefs];

    super(
      {
        root: 'perceive', // Primary root is perceive (observe)
        providerId: config?.providerId,
        reliabilityScore: 0.80,
        avgLatencyMs: 200,
        successRate: 0.85,
        maxConcurrent: 10,
        sandboxConfig: sandboxOverride,
        ...config,
      },
      allDefs,
    );

    this.pool = new DesktopPool(poolConfig);
  }

  // ─── Perceive Handlers ──────────────────────────────────────────────────────

  private async handleScreenshot(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.desktopStrategy;

    const options: DesktopScreenshotOptions = {
      windowId: input.windowId,
      region: input.region,
      format: input.format ?? 'png',
      quality: input.quality,
    };

    const result = await strategy.screenshot(options);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 5, mu: 3, eu: 10, vu: 5 });
  }

  private async handleTree(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.desktopStrategy;

    const options: DesktopTreeOptions = {
      windowId: input.windowId,
      maxDepth: input.maxDepth ?? 10,
      roles: input.roles,
    };

    const result = await strategy.getTree(options);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 4, mu: 8, eu: 5, vu: 2 });
  }

  private async handleQuery(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.desktopStrategy;

    const options: DesktopQueryOptions = {
      role: input.role,
      name: input.name,
      id: input.id,
      selector: input.selector,
      limit: input.limit ?? 100,
      windowId: input.windowId,
    };

    const result = await strategy.query(options);
    session.touch();
    this.pool.recordRequest();

    return this.success({ elements: result }, Date.now() - start, { ru: 3, mu: 5, eu: 3, vu: 1 });
  }

  private async handleRead(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.desktopStrategy;

    const options: DesktopReadOptions = {
      elementId: input.elementId,
      windowId: input.windowId,
      properties: input.properties,
    };

    const result = await strategy.read(options);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 2, mu: 3, eu: 3, vu: 1 });
  }

  // ─── Actuate Handlers ──────────────────────────────────────────────────────

  private async handleClick(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.desktopStrategy;

    const options: DesktopClickOptions = {
      x: input.x,
      y: input.y,
      elementId: input.elementId,
      button: input.button ?? 'left',
      clickCount: input.clickCount ?? 1,
    };

    const result = await strategy.click(options);
    session.touch();
    this.pool.recordRequest();

    if (!result.success) {
      context.log('warn', 'Desktop click failed', { error: result.error });
    }

    return this.success(result, Date.now() - start, { ru: 3, mu: 1, eu: 8, vu: 3 });
  }

  private async handleType(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.desktopStrategy;

    const options: DesktopTypeOptions = {
      text: input.text,
      elementId: input.elementId,
      delay: input.delay,
      clear: input.clear ?? true,
    };

    const result = await strategy.type(options);
    session.touch();
    this.pool.recordRequest();

    if (!result.success) {
      context.log('warn', 'Desktop type failed', { error: result.error });
    }

    return this.success(result, Date.now() - start, { ru: 3, mu: 1, eu: 8, vu: 3 });
  }

  private async handleScroll(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.desktopStrategy;

    const options: DesktopScrollOptions = {
      direction: input.direction ?? 'down',
      amount: input.amount ?? 300,
      elementId: input.elementId,
    };

    const result = await strategy.scroll(options);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 2, mu: 1, eu: 5, vu: 1 });
  }

  private async handleLaunch(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.desktopStrategy;

    const options: DesktopLaunchOptions = {
      app: input.app,
      args: input.args,
      cwd: input.cwd,
      waitForReady: input.waitForReady ?? false,
      timeoutMs: input.timeoutMs ?? Math.min(context.deadlineMs, 30_000),
    };

    const result = await strategy.launchApp(options);
    session.touch();
    this.pool.recordRequest();

    if (!result.success) {
      context.log('warn', 'Desktop launch failed', { error: result.error });
    }

    return this.success(result, Date.now() - start, { ru: 5, mu: 2, eu: 15, vu: 5 });
  }

  private async handleFocus(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.desktopStrategy;

    const options: DesktopFocusOptions = {
      windowId: input.windowId,
      elementId: input.elementId,
      appName: input.appName,
    };

    const result = await strategy.focus(options);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 2, mu: 1, eu: 3, vu: 1 });
  }

  private async handleKey(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.desktopStrategy;

    const options: DesktopKeyOptions = {
      key: input.key,
      modifiers: input.modifiers,
      count: input.count ?? 1,
    };

    const result = await strategy.pressKey(options);
    session.touch();
    this.pool.recordRequest();

    return this.success(result, Date.now() - start, { ru: 2, mu: 1, eu: 5, vu: 2 });
  }

  // ─── Advanced Perceive Handlers ─────────────────────────────────────────────

  private async handleProcessList(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.desktopStrategy;

    try {
      // List windows and derive process info
      const windows = await strategy.listWindows();
      session.touch();
      this.pool.recordRequest();

      // Group windows by process
      const processMap = new Map<string, ProcessInfo>();
      for (const w of windows) {
        if (!processMap.has(w.appName)) {
          processMap.set(w.appName, {
            pid: w.pid,
            name: w.appName,
            status: 'running',
          });
        }
      }

      let processes = Array.from(processMap.values());

      // Apply filter
      if (input.filter) {
        const filter = input.filter.toLowerCase();
        processes = processes.filter(p => p.name.toLowerCase().includes(filter));
      }

      // Apply limit
      const limit = input.limit ?? 100;
      processes = processes.slice(0, limit);

      return this.success({ processes, count: processes.length }, Date.now() - start, { ru: 3, mu: 5, eu: 5, vu: 2 });
    } catch (e) {
      return this.success({ processes: [], count: 0, error: e instanceof Error ? e.message : String(e) }, Date.now() - start, { ru: 3, mu: 5, eu: 5, vu: 2 });
    }
  }

  private async handleWindowList(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.desktopStrategy;

    try {
      let windows = await strategy.listWindows();
      session.touch();
      this.pool.recordRequest();

      // Apply filter
      if (input.filter) {
        const filter = input.filter.toLowerCase();
        windows = windows.filter(w =>
          w.title.toLowerCase().includes(filter) || w.appName.toLowerCase().includes(filter)
        );
      }

      // Apply limit
      const limit = input.limit ?? 50;
      windows = windows.slice(0, limit);

      return this.success({ windows, count: windows.length }, Date.now() - start, { ru: 2, mu: 3, eu: 3, vu: 1 });
    } catch (e) {
      return this.success({ windows: [], count: 0, error: e instanceof Error ? e.message : String(e) }, Date.now() - start, { ru: 2, mu: 3, eu: 3, vu: 1 });
    }
  }

  private async handleTray(context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();

    // System tray reading is platform-specific and limited
    // For now, return empty array with a note that tray reading
    // requires platform-specific implementation
    const icons: TrayIconInfo[] = [];

    return this.success({ icons, count: 0 }, Date.now() - start, { ru: 2, mu: 2, eu: 3, vu: 1 });
  }

  // ─── Advanced Actuate Handlers ─────────────────────────────────────────────

  private async handleDragDrop(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.desktopStrategy;

    try {
      // Desktop drag-drop: click source, then click target
      // This is a simplified implementation — real drag-drop requires mouse hold + move
      const options: DesktopDragDropOptions = {
        fromElementId: input.fromElementId,
        fromX: input.fromX,
        fromY: input.fromY,
        toElementId: input.toElementId,
        toX: input.toX,
        toY: input.toY,
      };

      // For coordinate-based drag-drop, use mouse click at source then target
      if (options.fromX !== undefined && options.fromY !== undefined && options.toX !== undefined && options.toY !== undefined) {
        // Click source
        await strategy.click({ x: options.fromX, y: options.fromY, button: 'left' });
        // Move and click target
        await strategy.click({ x: options.toX, y: options.toY, button: 'left' });
      }

      session.touch();
      this.pool.recordRequest();

      return this.success({ success: true, durationMs: Date.now() - start }, Date.now() - start, { ru: 3, mu: 1, eu: 8, vu: 3 });
    } catch (e) {
      return this.success({ success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start }, Date.now() - start, { ru: 3, mu: 1, eu: 8, vu: 3 });
    }
  }

  private async handleFileUpload(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const start = Date.now();
    const session = await this.getOrCreateSession(context);
    const strategy = session.desktopStrategy;

    try {
      const options: DesktopFileUploadOptions = {
        elementId: input.elementId,
        files: input.files,
      };

      // Desktop file upload: focus the file input element, then type the file path
      // This works for most native file dialogs
      if (options.elementId) {
        await strategy.focus({ elementId: options.elementId });
      }

      // For each file, type the path into the file dialog
      if (options.files.length > 0) {
        // Type the first file path (most dialogs accept one)
        await strategy.type({ text: options.files[0]!, clear: true });
        // Press Enter to confirm
        await strategy.pressKey({ key: 'enter' });
      }

      session.touch();
      this.pool.recordRequest();

      return this.success({ success: true, durationMs: Date.now() - start }, Date.now() - start, { ru: 3, mu: 5, eu: 10, vu: 2 });
    } catch (e) {
      return this.success({ success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start }, Date.now() - start, { ru: 3, mu: 5, eu: 10, vu: 2 });
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

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

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async getOrCreateSession(context: ProviderExecuteContext): Promise<import('./desktop-session.js').DesktopSession> {
    const workspaceId = context.invocation.caller?.workspace_id ?? 'default';
    return this.pool.getSession(workspaceId);
  }
}