/**
 * @agentos/desktop — UIAutomation Strategy
 * Windows desktop automation using System.Windows.Automation (UIAutomation API).
 * Provides rich accessibility tree traversal, element querying, and interaction
 * via PowerShell scripts wrapping the .NET UIAutomation framework.
 *
 * This strategy offers deeper accessibility coverage than NativeStrategy
 * (which relies on window lists and SendKeys) and does not require nut-js.
 * It is the preferred strategy on Windows when UIAutomation is available.
 */

import { execFile } from 'node:child_process';
import type {
  IDesktopStrategy,
  DesktopPlatform,
  DesktopScreenshotOptions,
  DesktopScreenshotResult,
  DesktopTreeOptions,
  AccessibilityTree,
  AccessibilityTreeNode,
  AccessibilityRole,
  DesktopQueryOptions,
  DesktopElement,
  DesktopReadOptions,
  ElementContent,
  DesktopClickOptions,
  DesktopTypeOptions,
  DesktopScrollOptions,
  DesktopLaunchOptions,
  DesktopFocusOptions,
  DesktopKeyOptions,
  DesktopActionResult,
  WindowInfo,
} from '../types.js';
import { DESKTOP_ERRORS } from '../types.js';
import {
  buildScreenshotPS,
  buildGetTreePS,
  buildQueryPS,
  buildReadPS,
  buildClickPS,
  buildTypePS,
  buildScrollPS,
  buildLaunchAppPS,
  buildFocusPS,
  buildPressKeyPS,
  buildListWindowsPS,
} from './uiautomation-helpers.js';

// ─── Config ──────────────────────────────────────────────────────────────────────

export interface UIAutomationStrategyConfig {
  /** Maximum command timeout in ms (default: 15000) */
  defaultTimeoutMs?: number;
  /** PowerShell executable path (default: 'powershell') */
  powershellPath?: string;
  /** Maximum tree traversal depth (default: 8) */
  maxTreeDepth?: number;
}

const DEFAULT_CONFIG: Required<UIAutomationStrategyConfig> = {
  defaultTimeoutMs: 15_000,
  powershellPath: 'powershell',
  maxTreeDepth: 8,
};

// ─── Command Execution Helper ────────────────────────────────────────────────────

function execPS(script: string, powershellPath: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      powershellPath,
      ['-NoProfile', '-Command', script],
      { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      },
    );
  });
}

// ─── JSON Parser ──────────────────────────────────────────────────────────────────

function parseJSONSafe(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    // PowerShell sometimes wraps arrays in newline-separated objects
    // Try to fix by wrapping in brackets
    try {
      const fixed = `[${stdout}]`.replace(/\}\s*\{/g, '},{');
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}

// ─── UIAutomation ControlType → AccessibilityRole Mapping ────────────────────────

const CONTROL_TYPE_MAP: Record<string, AccessibilityRole> = {
  Desktop: 'desktop',
  Button: 'button',
  Calendar: 'unknown',
  CheckBox: 'checkbox',
  ComboBox: 'combobox',
  Custom: 'unknown',
  DataGrid: 'table',
  DataItem: 'listitem',
  Document: 'document',
  Edit: 'edit',
  Group: 'group',
  Header: 'unknown',
  HeaderItem: 'unknown',
  Hyperlink: 'hyperlink',
  Image: 'image',
  List: 'list',
  ListItem: 'listitem',
  Menu: 'menu',
  MenuBar: 'menubar',
  MenuItem: 'menuitem',
  Pane: 'pane',
  ProgressBar: 'progressbar',
  RadioButton: 'radio',
  ScrollBar: 'scrollbar',
  Separator: 'separator',
  Slider: 'slider',
  Spinner: 'spinbutton',
  SplitButton: 'button',
  StatusBar: 'statusbar',
  Tab: 'tablist',
  TabItem: 'tab',
  Table: 'table',
  Text: 'text',
  Thumb: 'unknown',
  TitleBar: 'titlebar',
  ToolBar: 'toolbar',
  ToolTip: 'tooltip',
  Tree: 'tree',
  TreeItem: 'treeitem',
  Window: 'window',
};

function mapControlType(ct: string): AccessibilityRole {
  return CONTROL_TYPE_MAP[ct] ?? 'unknown';
}

// ─── Recursive Tree Builder ───────────────────────────────────────────────────────

function buildTreeNode(raw: any, depth: number = 0): AccessibilityTreeNode {
  const children: AccessibilityTreeNode[] = (raw['children'] ?? []).map((c: any) => buildTreeNode(c, depth + 1));

  let bounds: { x: number; y: number; width: number; height: number } | undefined;
  const rawBounds = raw['bounds'];
  if (rawBounds && typeof rawBounds === 'object' && rawBounds['x'] !== undefined) {
    bounds = {
      x: rawBounds['x'],
      y: rawBounds['y'],
      width: rawBounds['width'],
      height: rawBounds['height'],
    };
  }

  return {
    id: raw['id'] ?? `el_${depth}_${raw['role']}_${raw['name']}`.slice(0, 64),
    role: mapControlType(raw['role'] ?? ''),
    name: raw['name'] ?? '',
    value: raw['value'] ?? undefined,
    description: undefined,
    bounds,
    visible: raw['visible'] ?? true,
    focused: raw['focused'] ?? false,
    enabled: raw['enabled'] ?? true,
    children,
  };
}

function countNodes(node: AccessibilityTreeNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

function maxDepthOf(node: AccessibilityTreeNode, currentDepth: number = 0): number {
  if (node.children.length === 0) return currentDepth;
  return Math.max(...node.children.map(c => maxDepthOf(c, currentDepth + 1)));
}

// ─── UIAutomation Strategy ────────────────────────────────────────────────────────

export class UIAutomationStrategy implements IDesktopStrategy {
  readonly name = 'uiautomation';
  readonly supportsNativeApps = true;
  readonly platform: DesktopPlatform = 'windows';
  private config: Required<UIAutomationStrategyConfig>;
  private _windows: WindowInfo[] = [];

  constructor(config?: UIAutomationStrategyConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Perceive (read-only) ──────────────────────────────────────────────────

  async screenshot(options?: DesktopScreenshotOptions): Promise<DesktopScreenshotResult> {
    const start = Date.now();
    const ps = buildScreenshotPS(options?.region ? { region: options.region } : undefined);
    const { stdout } = await execPS(ps, this.config.powershellPath, this.config.defaultTimeoutMs);

    const data = stdout.trim();
    const format = options?.format === 'jpeg' ? 'image/jpeg' : 'image/png';

    return {
      data,
      mimeType: format,
      width: options?.region?.width ?? 0,
      height: options?.region?.height ?? 0,
      sizeBytes: Math.floor(data.length * 3 / 4),
    };
  }

  async getTree(options?: DesktopTreeOptions): Promise<AccessibilityTree> {
    const ps = buildGetTreePS({
      windowId: options?.windowId,
      maxDepth: options?.maxDepth ?? this.config.maxTreeDepth,
    });

    const { stdout } = await execPS(ps, this.config.powershellPath, this.config.defaultTimeoutMs);
    const parsed = parseJSONSafe(stdout);

    if (!parsed || typeof parsed !== 'object') {
      // Empty tree: return a minimal desktop
      const windows = await this.listWindows();
      return {
        root: {
          id: 'root',
          role: 'desktop' as AccessibilityRole,
          name: 'Desktop',
          children: windows.map((w, i) => ({
            id: w.windowId || String(i),
            role: 'window' as AccessibilityRole,
            name: w.title || w.appName,
            value: undefined,
            description: undefined,
            bounds: w.bounds,
            visible: true,
            focused: w.focused,
            enabled: true,
            children: [],
          })),
        },
        nodeCount: windows.length + 1,
        maxDepth: 1,
        window: windows[0] ?? { title: 'Desktop', appName: 'Desktop', pid: 0, windowId: 'root', bounds: { x: 0, y: 0, width: 0, height: 0 }, focused: true },
      };
    }

    const root = buildTreeNode(parsed);
    // Filter by roles if requested
    if (options?.roles?.length) {
      filterTreeByRoles(root, options.roles);
    }

    const windowList = await this.listWindows();
    return {
      root,
      nodeCount: countNodes(root),
      maxDepth: maxDepthOf(root),
      window: windowList[0] ?? { title: 'Desktop', appName: 'Desktop', pid: 0, windowId: 'root', bounds: { x: 0, y: 0, width: 0, height: 0 }, focused: true },
    };
  }

  async query(options: DesktopQueryOptions): Promise<DesktopElement[]> {
    const ps = buildQueryPS({
      role: options.role,
      name: options.name,
      id: options.id,
      className: options.selector, // Use selector as className
      limit: options.limit,
    });

    const { stdout } = await execPS(ps, this.config.powershellPath, this.config.defaultTimeoutMs);
    const parsed = parseJSONSafe(stdout);

    if (!parsed) return [];

    const items = Array.isArray(parsed) ? parsed : [parsed];
    return items.map((item: any) => ({
      id: item.id ?? '',
      role: mapControlType(item.role ?? ''),
      name: item.name ?? '',
      value: item.value ?? undefined,
      bounds: item.bounds && typeof item.bounds === 'object' && item.bounds.x !== undefined
        ? { x: item.bounds.x, y: item.bounds.y, width: item.bounds.width, height: item.bounds.height }
        : undefined,
      visible: item.visible ?? true,
      enabled: item.enabled ?? true,
      focused: item.focused ?? false,
      properties: {},
    }));
  }

  async read(options: DesktopReadOptions): Promise<ElementContent> {
    const ps = buildReadPS({ elementId: options.elementId });
    const { stdout } = await execPS(ps, this.config.powershellPath, this.config.defaultTimeoutMs);
    const parsed = parseJSONSafe(stdout) as any;

    if (!parsed || parsed.error === 'element_not_found') {
      return {
        elementId: options.elementId,
        role: 'unknown',
        name: '',
        properties: {},
      };
    }

    const properties: Record<string, string> = {};
    if (parsed['enabled'] !== undefined) properties['enabled'] = String(parsed['enabled']);
    if (parsed['focused'] !== undefined) properties['focused'] = String(parsed['focused']);
    if (parsed['bounds'] && typeof parsed['bounds'] === 'object') {
      const b = parsed['bounds'] as Record<string, number>;
      properties['bounds'] = `${b['x']},${b['y']},${b['width']},${b['height']}`;
    }

    return {
      elementId: options.elementId,
      text: parsed.text ?? undefined,
      value: parsed.value ?? undefined,
      role: mapControlType(parsed.role ?? ''),
      name: parsed.name ?? '',
      properties,
    };
  }

  // ─── Actuate (mutation) ───────────────────────────────────────────────────

  async click(options: DesktopClickOptions): Promise<DesktopActionResult> {
    const start = Date.now();

    try {
      const ps = buildClickPS({
        elementId: options.elementId,
        x: options.x,
        y: options.y,
        button: options.button,
        clickCount: options.clickCount,
      });

      const { stdout } = await execPS(ps, this.config.powershellPath, this.config.defaultTimeoutMs);
      const parsed = parseJSONSafe(stdout) as any;

      if (parsed && parsed.success === false) {
        return { success: false, error: parsed.error ?? 'click_failed', durationMs: Date.now() - start };
      }

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async type(options: DesktopTypeOptions): Promise<DesktopActionResult> {
    const start = Date.now();

    try {
      const ps = buildTypePS({
        text: options.text,
        elementId: options.elementId,
        clear: options.clear,
      });

      const { stdout } = await execPS(ps, this.config.powershellPath, this.config.defaultTimeoutMs);
      const parsed = parseJSONSafe(stdout) as any;

      if (parsed && parsed.success === false) {
        return { success: false, error: parsed.error ?? 'type_failed', durationMs: Date.now() - start };
      }

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async scroll(options: DesktopScrollOptions): Promise<DesktopActionResult> {
    const start = Date.now();

    try {
      const ps = buildScrollPS({
        direction: options.direction,
        amount: options.amount ? Math.ceil(options.amount / 300) : 1,
        elementId: options.elementId,
      });

      await execPS(ps, this.config.powershellPath, this.config.defaultTimeoutMs);
      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async launchApp(options: DesktopLaunchOptions): Promise<DesktopActionResult> {
    const start = Date.now();

    try {
      const ps = buildLaunchAppPS({
        app: options.app,
        args: options.args,
        waitForReady: options.waitForReady,
      });

      await execPS(ps, this.config.powershellPath, options.timeoutMs ?? this.config.defaultTimeoutMs);
      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async focus(options: DesktopFocusOptions): Promise<DesktopActionResult> {
    const start = Date.now();

    try {
      const ps = buildFocusPS({
        elementId: options.elementId,
        appName: options.appName,
      });

      const { stdout } = await execPS(ps, this.config.powershellPath, this.config.defaultTimeoutMs);
      const parsed = parseJSONSafe(stdout) as any;

      if (parsed && parsed.success === false) {
        return { success: false, error: parsed.error ?? 'focus_failed', durationMs: Date.now() - start };
      }

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async pressKey(options: DesktopKeyOptions): Promise<DesktopActionResult> {
    const start = Date.now();

    try {
      const ps = buildPressKeyPS({
        key: options.key,
        modifiers: options.modifiers,
        count: options.count,
      });

      const count = options.count ?? 1;
      for (let i = 0; i < count; i++) {
        await execPS(ps, this.config.powershellPath, this.config.defaultTimeoutMs);
      }

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  // ─── State ──────────────────────────────────────────────────────────────────

  currentWindow(): WindowInfo | null {
    return this._windows.find(w => w.focused) ?? this._windows[0] ?? null;
  }

  async listWindows(): Promise<WindowInfo[]> {
    try {
      const ps = buildListWindowsPS();
      const { stdout } = await execPS(ps, this.config.powershellPath, this.config.defaultTimeoutMs);
      const parsed = parseJSONSafe(stdout);

      if (!parsed) return [];

      const items = Array.isArray(parsed) ? parsed : [parsed];
      this._windows = items.map((item: any, i: number) => ({
        title: item.title ?? item.name ?? '',
        appName: item.appName ?? '',
        pid: Number(item.pid ?? i),
        windowId: item.windowId ?? item.id ?? String(i),
        bounds: item.bounds && typeof item.bounds === 'object' && item.bounds.x !== undefined
          ? { x: item.bounds.x, y: item.bounds.y, width: item.bounds.width, height: item.bounds.height }
          : { x: 0, y: 0, width: 0, height: 0 },
        focused: Boolean(item.focused ?? i === 0),
      }));

      return this._windows;
    } catch {
      return [];
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    this._windows = [];
  }
}

// ─── Tree Filter Utility ─────────────────────────────────────────────────────────

function filterTreeByRoles(node: AccessibilityTreeNode, roles: AccessibilityRole[]): void {
  // Remove children that don't match any allowed role (recursively)
  node.children = node.children.filter(child => {
    filterTreeByRoles(child, roles);
    return roles.includes(child.role) || child.children.length > 0;
  });
}

// ─── UIAutomation Availability Detection ──────────────────────────────────────────

/**
 * Detect whether the Windows UIAutomation API is available.
 * Returns true only on Windows with UIAutomationClient assembly loaded.
 */
export async function isUIAutomationAvailable(powershellPath: string = 'powershell'): Promise<boolean> {
  if (process.platform !== 'win32') return false;

  const { buildUIAutomationAvailablePS } = await import('./uiautomation-helpers.js');
  const ps = buildUIAutomationAvailablePS();

  try {
    const { stdout } = await execPS(ps, powershellPath, 5_000);
    const parsed = parseJSONSafe(stdout) as any;
    return parsed?.available === true;
  } catch {
    return false;
  }
}