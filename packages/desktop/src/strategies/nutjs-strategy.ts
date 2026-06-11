/**
 * @agentos/desktop — NutJS Strategy
 * Full desktop automation using @nut-tree-fork/nut-js (optional peer dependency).
 * Provides real mouse/keyboard control, window management, and screen reading.
 * Falls back gracefully when nut-js is not installed.
 */

import type {
  IDesktopStrategy,
  DesktopPlatform,
  DesktopScreenshotOptions,
  DesktopScreenshotResult,
  DesktopTreeOptions,
  AccessibilityTree,
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

// ─── NutJS Strategy Config ────────────────────────────────────────────────────

export interface NutJSStrategyConfig {
  /** Auto-detect display availability (default: true) */
  autoDetectDisplay?: boolean;
  /** Default timeout in ms (default: 10000) */
  defaultTimeoutMs?: number;
}

const DEFAULT_NUTJS_CONFIG: Required<NutJSStrategyConfig> = {
  autoDetectDisplay: true,
  defaultTimeoutMs: 10_000,
};

// ─── NutJS Strategy ───────────────────────────────────────────────────────────

/**
 * Full desktop automation strategy using @nut-tree-fork/nut-js.
 * Requires @nut-tree-fork/nut-js to be installed (optional peer dependency).
 * Supports real mouse/keyboard control, screen reading, and window management.
 */
export class NutJSStrategy implements IDesktopStrategy {
  readonly name = 'nutjs';
  readonly supportsNativeApps = true;
  readonly platform: DesktopPlatform;
  private config: Required<NutJSStrategyConfig>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _nutjs: any = null;
  private _currentWindowId: string | null = null;
  private _windows: WindowInfo[] = [];

  constructor(config?: NutJSStrategyConfig) {
    this.platform = this.detectPlatform();
    this.config = { ...DEFAULT_NUTJS_CONFIG, ...config };
  }

  private detectPlatform(): DesktopPlatform {
    switch (process.platform) {
      case 'win32': return 'windows';
      case 'darwin': return 'macos';
      case 'linux': return 'linux';
      default: return 'unknown';
    }
  }

  // ─── Lazy NutJS Loading ────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async ensureNutJS(): Promise<any> {
    if (this._nutjs) return this._nutjs;

    try {
      this._nutjs = await import('@nut-tree-fork/nut-js');
      return this._nutjs;
    } catch {
      throw new Error(
        `${DESKTOP_ERRORS.REQUIRES_NATIVE}: @nut-tree-fork/nut-js is not installed. Install it with: pnpm add @nut-tree-fork/nut-js`,
      );
    }
  }

  // ─── Perceive (read-only) ──────────────────────────────────────────────────

  async screenshot(options?: DesktopScreenshotOptions): Promise<DesktopScreenshotResult> {
    const start = Date.now();
    const nutjs = await this.ensureNutJS();

    const region = options?.region;
    const format = options?.format ?? 'png';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const screenObj: any = nutjs.screen;

    let img: any;
    if (region) {
      img = await screenObj.grabRegion(new nutjs.Region(region.x, region.y, region.width, region.height));
    } else {
      img = await screenObj.capture();
    }

    const data = await img.toBase64();

    return {
      data,
      mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
      width: img.width ?? 0,
      height: img.height ?? 0,
      sizeBytes: Math.floor(data.length * 3 / 4),
    };
  }

  async getTree(options?: DesktopTreeOptions): Promise<AccessibilityTree> {
    // NutJS doesn't have direct accessibility tree support
    // Fall back to window listing
    const windows = await this.listWindows();
    return {
      root: {
        id: 'root',
        role: 'desktop',
        name: 'Desktop',
        children: windows.map((w, i) => ({
          id: w.windowId || String(i),
          role: 'window' as const,
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

  async query(options: DesktopQueryOptions): Promise<DesktopElement[]> {
    const windows = await this.listWindows();
    const elements: DesktopElement[] = [];

    for (const w of windows) {
      if (options.role && options.role !== 'window') continue;
      if (options.name && !w.title.toLowerCase().includes(options.name.toLowerCase()) && !w.appName.toLowerCase().includes(options.name.toLowerCase())) continue;
      if (options.limit && elements.length >= options.limit) break;

      elements.push({
        id: w.windowId,
        role: 'window',
        name: w.title || w.appName,
        value: w.title,
        bounds: w.bounds,
        visible: true,
        enabled: true,
        focused: w.focused,
      });
    }

    return elements;
  }

  async read(options: DesktopReadOptions): Promise<ElementContent> {
    const windows = await this.listWindows();
    const element = windows.find(w => w.windowId === options.elementId);

    if (!element) {
      return {
        elementId: options.elementId,
        role: 'unknown',
        name: '',
        properties: {},
      };
    }

    return {
      elementId: options.elementId,
      text: element.title,
      value: element.title,
      role: 'window',
      name: element.appName,
      properties: {
        pid: String(element.pid),
        focused: String(element.focused),
      },
    };
  }

  // ─── Actuate (mutation) ───────────────────────────────────────────────────

  async click(options: DesktopClickOptions): Promise<DesktopActionResult> {
    const start = Date.now();
    const nutjs = await this.ensureNutJS();

    try {
      if (options.x !== undefined && options.y !== undefined) {
        await nutjs.mouse.moveTo(new nutjs.Point(options.x, options.y));
        await nutjs.mouse.leftClick();
      } else {
        // Click on element by focusing then pressing Enter
        if (options.elementId) {
          await this.focus({ elementId: options.elementId });
        }
        await nutjs.keyboard.type(nutjs.Key.Enter);
      }

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async type(options: DesktopTypeOptions): Promise<DesktopActionResult> {
    const start = Date.now();
    const nutjs = await this.ensureNutJS();

    try {
      if (options.elementId) {
        await this.focus({ elementId: options.elementId });
      }

      if (options.clear !== false) {
        await nutjs.keyboard.pressKey(nutjs.Key.LeftControl, nutjs.Key.A);
        await nutjs.keyboard.pressKey(nutjs.Key.Delete);
      }

      if (options.delay) {
        for (const char of options.text) {
          await nutjs.keyboard.type(char);
          await new Promise(resolve => setTimeout(resolve, options.delay));
        }
      } else {
        await nutjs.keyboard.type(options.text);
      }

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async scroll(options: DesktopScrollOptions): Promise<DesktopActionResult> {
    const start = Date.now();
    const nutjs = await this.ensureNutJS();
    const amount = options.amount ?? 300;
    const direction = options.direction ?? 'down';

    try {
      const scrollAmount = direction === 'up' || direction === 'left' ? -amount : amount;
      if (direction === 'up' || direction === 'down') {
        await nutjs.mouse.scrollDown(scrollAmount);
      } else {
        await nutjs.mouse.scrollRight(scrollAmount);
      }

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async launchApp(options: DesktopLaunchOptions): Promise<DesktopActionResult> {
    const start = Date.now();

    try {
      const { execFile } = await import('node:child_process');
      const platform = this.platform;

      await new Promise<void>((resolve, reject) => {
        if (platform === ('win32' as DesktopPlatform)) {
          execFile('cmd', ['/c', 'start', '""', options.app, ...(options.args ?? [])], { windowsHide: true }, (err: Error | null) => {
            if (err) reject(err); else resolve();
          });
        } else if (platform === ('darwin' as DesktopPlatform)) {
          execFile('open', ['-a', options.app, ...(options.args ?? [])], { windowsHide: true }, (err: Error | null) => {
            if (err) reject(err); else resolve();
          });
        } else {
          execFile(options.app, options.args ?? [], { windowsHide: true }, (err: Error | null) => {
            if (err) reject(err); else resolve();
          });
        }
      });

      if (options.waitForReady) {
        await new Promise(resolve => setTimeout(resolve, options.timeoutMs ?? 5000));
      }

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async focus(options: DesktopFocusOptions): Promise<DesktopActionResult> {
    const start = Date.now();

    try {
      const appName = options.appName ?? '';
      if (appName) {
        const { execFile } = await import('node:child_process');
        await new Promise<void>((resolve, reject) => {
          if (this.platform === ('win32' as DesktopPlatform)) {
            execFile('powershell', ['-NoProfile', '-Command', `$shell = New-Object -ComObject WScript.Shell; $shell.AppActivate("${appName.replace(/"/g, '\\"')}")`], { windowsHide: true }, (err: Error | null) => {
              if (err) reject(err); else resolve();
            });
          } else if (this.platform === ('darwin' as DesktopPlatform)) {
            execFile('osascript', ['-e', `tell application "${appName}" to activate`], { windowsHide: true }, (err: Error | null) => {
              if (err) reject(err); else resolve();
            });
          } else {
            resolve();
          }
        });
      }

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async pressKey(options: DesktopKeyOptions): Promise<DesktopActionResult> {
    const start = Date.now();
    const nutjs = await this.ensureNutJS();

    try {
      const keyMap: Record<string, any> = {
        enter: nutjs.Key.Enter,
        tab: nutjs.Key.Tab,
        escape: nutjs.Key.Escape,
        backspace: nutjs.Key.Backspace,
        delete: nutjs.Key.Delete,
        up: nutjs.Key.Up,
        down: nutjs.Key.Down,
        left: nutjs.Key.Left,
        right: nutjs.Key.Right,
        home: nutjs.Key.Home,
        end: nutjs.Key.End,
        space: nutjs.Key.Space,
      };

      const mappedKey = keyMap[options.key.toLowerCase()] ?? options.key;
      const modifiers = (options.modifiers ?? []).map(m => {
        const modMap: Record<string, any> = {
          ctrl: nutjs.Key.LeftControl,
          alt: nutjs.Key.LeftAlt,
          shift: nutjs.Key.LeftShift,
          meta: nutjs.Key.LeftSuper,
        };
        return modMap[m.toLowerCase()];
      }).filter(Boolean);

      const count = options.count ?? 1;
      for (let i = 0; i < count; i++) {
        if (modifiers.length > 0) {
          await nutjs.keyboard.pressKey(...modifiers, mappedKey);
          await nutjs.keyboard.releaseKey(mappedKey, ...modifiers.reverse());
        } else {
          await nutjs.keyboard.pressKey(mappedKey);
          await nutjs.keyboard.releaseKey(mappedKey);
        }
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
      const nutjs = await this.ensureNutJS();
      const windows = await nutjs.getWindows();
      this._windows = windows.map((w: any, i: number) => ({
        title: w.title ?? '',
        appName: w.owner?.name ?? '',
        pid: w.owner?.processId ?? i,
        windowId: String(w.id ?? i),
        bounds: w.bounds ? { x: w.bounds.x, y: w.bounds.y, width: w.bounds.width, height: w.bounds.height } : { x: 0, y: 0, width: 0, height: 0 },
        focused: i === 0,
      }));
      return this._windows;
    } catch {
      return [];
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    this._currentWindowId = null;
    this._windows = [];
    this._nutjs = null;
  }
}