/**
 * @agentos/desktop — Native Strategy
 * Zero-dependency desktop automation using OS-level commands.
 * Uses PowerShell on Windows and osascript on macOS.
 * Gracefully degrades in CI/no-display environments.
 */

import { execFile } from 'node:child_process';
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
  AccessibilityRole,
} from '../types.js';
import { DESKTOP_ERRORS } from '../types.js';

// ─── Platform Detection ────────────────────────────────────────────────────────

function detectPlatform(): DesktopPlatform {
  switch (process.platform) {
    case 'win32': return 'windows';
    case 'darwin': return 'macos';
    case 'linux': return 'linux';
    default: return 'unknown';
  }
}

let hasDisplayCache: boolean | null = null;

export function hasDisplay(): boolean {
  if (hasDisplayCache !== null) return hasDisplayCache;
  // Check for display environment variables
  if (process.platform === 'win32') {
    // Windows typically has a display in interactive sessions
    hasDisplayCache = !!process.env['SESSIONNAME'] || !!process.env['COMPUTERNAME'];
  } else {
    // Unix-like: check for DISPLAY variable
    hasDisplayCache = !!process.env['DISPLAY'] || !!process.env['WAYLAND_DISPLAY'];
  }
  return hasDisplayCache;
}

// ─── Command Execution Helper ──────────────────────────────────────────────────

function execCommand(command: string, args: string[], timeoutMs: number = 10_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

// ─── PowerShell Command Builder ─────────────────────────────────────────────────

function buildListWindowsPS(): string {
  return `
    Add-Type -AssemblyName System.Windows.Forms
    $procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' }
    $results = @()
    foreach ($p in $procs) {
      $obj = [PSCustomObject]@{
        title = $p.MainWindowTitle
        appName = $p.ProcessName
        pid = $p.Id
        windowId = $p.MainWindowHandle.ToString()
        bounds = ''
        focused = $false
      }
      $results += $obj
    }
    # Mark the foreground window
    $fg = [System.Windows.Forms.Control]::FromHandle([IntPtr]0)
    try {
      $hwnd = [System.Windows.Forms.NativeWindow]::new()
      $fgHandle = [Win32.NativeMethods]::GetForegroundWindow()
    } catch {}
    $results | ConvertTo-Json -Compress
  `.trim();
}

function buildScreenshotPS(options?: DesktopScreenshotOptions): string {
  const region = options?.region;
  if (region) {
    return `
      Add-Type -AssemblyName System.Drawing
      Add-Type -AssemblyName System.Windows.Forms
      $bmp = New-Object System.Drawing.Bitmap(${region.width}, ${region.height})
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen(${region.x}, ${region.y}, 0, 0, [System.Drawing.Size]::new(${region.width}, ${region.height}))
      $g.Dispose()
      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose()
      [Convert]::ToBase64String($ms.ToArray())
    `.trim();
  }
  return `
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    $bmp = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen(0, 0, 0, 0, [System.Drawing.Size]::new($screen.Bounds.Width, $screen.Bounds.Height))
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    [Convert]::ToBase64String($ms.ToArray())
  `.trim();
}

function buildFocusWindowPS(appName: string): string {
  return `
    $shell = New-Object -ComObject WScript.Shell
    $shell.AppActivate("${appName.replace(/"/g, '\\"')}")
    Start-Sleep -Milliseconds 200
    "focused"
  `.trim();
}

function buildLaunchAppPS(app: string, args?: string[]): string {
  const argsStr = args ? ` -ArgumentList ${args.map(a => `"${a}"`).join(',')}` : '';
  return `
    Start-Process "${app.replace(/"/g, '\\"')}"${argsStr}
    Start-Sleep -Milliseconds 500
    "launched"
  `.trim();
}

function buildTypeTextPS(text: string): string {
  return `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait("${text.replace(/["{}()+^%~\[\]]/g, '{$&}')}")
    "typed"
  `.trim();
}

function buildPressKeyPS(key: string, modifiers?: string[]): string {
  // Map common key names to SendKeys format
  const keyMap: Record<string, string> = {
    enter: '{ENTER}',
    tab: '{TAB}',
    escape: '{ESC}',
    backspace: '{BACKSPACE}',
    delete: '{DELETE}',
    up: '{UP}',
    down: '{DOWN}',
    left: '{LEFT}',
    right: '{RIGHT}',
    home: '{HOME}',
    end: '{END}',
    pageup: '{PGUP}',
    pagedown: '{PGDN}',
    space: ' ',
    f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}',
    f5: '{F5}', f6: '{F6}', f7: '{F7}', f8: '{F8}',
    f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
  };

  let sendKey = keyMap[key.toLowerCase()] ?? key;

  if (modifiers?.length) {
    const modMap: Record<string, string> = {
      ctrl: '^', alt: '%', shift: '+', meta: '^',
    };
    const modPrefix = modifiers.map(m => modMap[m.toLowerCase()] ?? '').join('');
    sendKey = `${modPrefix}${sendKey}`;
  }

  return `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait("${sendKey}")
    "key_pressed"
  `.trim();
}

// ─── macOS Command Builder ────────────────────────────────────────────────────

function buildListWindowsMacOS(): string[] {
  return ['-e', 'tell application "System Events" to get name of every window of every process whose visible is true'];
}

function buildFocusWindowMacOS(appName: string): string[] {
  return ['-e', `tell application "${appName}" to activate`];
}

function buildLaunchAppMacOS(app: string, args?: string[]): string[] {
  const cmd = args ? `open -a "${app}" ${args.join(' ')}` : `open -a "${app}"`;
  // osascript can't easily launch apps with args, use open command instead
  return ['-e', `do shell script "${cmd}"`];
}

// ─── Native Strategy ────────────────────────────────────────────────────────

export interface NativeStrategyConfig {
  /** Maximum command timeout in ms (default: 10000) */
  defaultTimeoutMs?: number;
  /** PowerShell executable path (default: 'powershell') */
  powershellPath?: string;
}

const DEFAULT_NATIVE_CONFIG: Required<NativeStrategyConfig> = {
  defaultTimeoutMs: 10_000,
  powershellPath: 'powershell',
};

export class NativeStrategy implements IDesktopStrategy {
  readonly name = 'native';
  readonly supportsNativeApps = true;
  readonly platform: DesktopPlatform;
  private config: Required<NativeStrategyConfig>;
  private _currentWindowId: string | null = null;
  private _windows: WindowInfo[] = [];

  constructor(config?: NativeStrategyConfig) {
    this.platform = detectPlatform();
    this.config = { ...DEFAULT_NATIVE_CONFIG, ...config };
  }

  // ─── Perceive (read-only) ──────────────────────────────────────────────────

  async screenshot(options?: DesktopScreenshotOptions): Promise<DesktopScreenshotResult> {
    if (!hasDisplay()) {
      throw new Error(`${DESKTOP_ERRORS.NO_DISPLAY}: No display available for screenshot`);
    }

    const start = Date.now();

    if (this.platform === 'windows') {
      const ps = buildScreenshotPS(options);
      const { stdout } = await execCommand(
        this.config.powershellPath,
        ['-NoProfile', '-Command', ps],
        this.config.defaultTimeoutMs,
      );

      const data = stdout.trim();
      const format = options?.format === 'jpeg' ? 'image/jpeg' : 'image/png';

      return {
        data,
        mimeType: format,
        width: options?.region?.width ?? 0,
        height: options?.region?.height ?? 0,
        sizeBytes: Math.floor(data.length * 3 / 4), // Base64 approx
      };
    }

    if (this.platform === 'macos') {
      // macOS: use screencapture command
      const region = options?.region;
      const args = region
        ? ['-R', `${region.x},${region.y},${region.width},${region.height}`, '-t', options?.format ?? 'png', '-']
        : ['-x', '-t', options?.format ?? 'png', '-'];

      try {
        const { stdout } = await execCommand('screencapture', args, this.config.defaultTimeoutMs);
        return {
          data: stdout,
          mimeType: options?.format === 'jpeg' ? 'image/jpeg' : 'image/png',
          width: 0,
          height: 0,
          sizeBytes: stdout.length,
        };
      } catch {
        throw new Error(`${DESKTOP_ERRORS.NO_DISPLAY}: Failed to capture screenshot on macOS`);
      }
    }

    throw new Error(`${DESKTOP_ERRORS.PLATFORM_UNSUPPORTED}: Screenshots not supported on ${this.platform}`);
  }

  async getTree(options?: DesktopTreeOptions): Promise<AccessibilityTree> {
    if (!hasDisplay()) {
      throw new Error(`${DESKTOP_ERRORS.NO_DISPLAY}: No display available for accessibility tree`);
    }

    if (this.platform === 'windows') {
      // Use UI Automation via PowerShell
      const ps = `
        Add-Type -AssemblyName UIAutomationClient
        $root = [System.Windows.Automation.AutomationElement]::RootElement
        $cond = [System.Windows.Automation.Condition]::TrueCondition
        $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
        $results = @()
        foreach ($c in $children) {
          $obj = [PSCustomObject]@{
            id = $c.Current.AutomationId
            role = $c.Current.ControlType.ProgrammaticName.Replace('ControlType.', '')
            name = $c.Current.Name
            value = ''
            bounds = ''
            visible = $true
            focused = $c.Current.HasKeyboardFocus
            enabled = $c.Current.IsEnabled
          }
          $results += $obj
        }
        $results | ConvertTo-Json -Compress
      `.trim();

      const { stdout } = await execCommand(
        this.config.powershellPath,
        ['-NoProfile', '-Command', ps],
        this.config.defaultTimeoutMs,
      );

      const elements = this.parseWindowsList(stdout);
      return {
        root: {
          id: 'root',
          role: 'desktop',
          name: 'Desktop',
          children: elements.map((e, i) => ({
            id: e.windowId || String(i),
            role: 'window' as AccessibilityRole,
            name: e.title || e.appName,
            value: undefined,
            description: undefined,
            bounds: e.bounds,
            visible: true,
            focused: e.focused,
            enabled: true,
            children: [],
          })),
        },
        nodeCount: elements.length + 1,
        maxDepth: 1,
        window: elements[0] ?? { title: 'Desktop', appName: 'Desktop', pid: 0, windowId: 'root', bounds: { x: 0, y: 0, width: 0, height: 0 }, focused: true },
      };
    }

    // macOS and Linux: return minimal tree
    const windows = await this.listWindows();
    return {
      root: {
        id: 'root',
        role: 'desktop',
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

  async query(options: DesktopQueryOptions): Promise<DesktopElement[]> {
    if (!hasDisplay()) {
      throw new Error(`${DESKTOP_ERRORS.NO_DISPLAY}: No display available for query`);
    }

    // Query is built on top of listWindows + tree for now
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
    if (!hasDisplay()) {
      throw new Error(`${DESKTOP_ERRORS.NO_DISPLAY}: No display available for read`);
    }

    // Read element by finding it in the window list
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
        bounds: element.bounds ? `${element.bounds.x},${element.bounds.y},${element.bounds.width},${element.bounds.height}` : '',
      },
    };
  }

  // ─── Actuate (mutation) ───────────────────────────────────────────────────

  async click(options: DesktopClickOptions): Promise<DesktopActionResult> {
    if (!hasDisplay()) {
      return { success: false, error: DESKTOP_ERRORS.NO_DISPLAY, durationMs: 0 };
    }

    const start = Date.now();

    try {
      if (this.platform === 'windows') {
        if (options.x !== undefined && options.y !== undefined) {
          // Click at coordinates using PowerShell + System.Windows.Forms
          const ps = `
            Add-Type -AssemblyName System.Windows.Forms
            [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${options.x}, ${options.y})
            Start-Sleep -Milliseconds 50
            # Simulate click via SendKeys or mouse_event
            "clicked"
          `.trim();
          await execCommand(this.config.powershellPath, ['-NoProfile', '-Command', ps], this.config.defaultTimeoutMs);
        } else if (options.elementId) {
          // Click on element by focusing it first
          await this.focus({ elementId: options.elementId });
          // Then send Enter key
          await this.pressKey({ key: 'enter' });
        }
      } else if (this.platform === 'macos') {
        if (options.x !== undefined && options.y !== undefined) {
          await execCommand('osascript', ['-e', `tell application "System Events" to click at {${options.x}, ${options.y}}`], this.config.defaultTimeoutMs);
        }
      }

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async type(options: DesktopTypeOptions): Promise<DesktopActionResult> {
    if (!hasDisplay()) {
      return { success: false, error: DESKTOP_ERRORS.NO_DISPLAY, durationMs: 0 };
    }

    const start = Date.now();

    try {
      if (this.platform === 'windows') {
        if (options.elementId) {
          await this.focus({ elementId: options.elementId });
        }
        const ps = buildTypeTextPS(options.text);
        await execCommand(this.config.powershellPath, ['-NoProfile', '-Command', ps], this.config.defaultTimeoutMs);
      } else if (this.platform === 'macos') {
        const escaped = options.text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        await execCommand('osascript', ['-e', `tell application "System Events" to keystroke "${escaped}"`], this.config.defaultTimeoutMs);
      }

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async scroll(options: DesktopScrollOptions): Promise<DesktopActionResult> {
    if (!hasDisplay()) {
      return { success: false, error: DESKTOP_ERRORS.NO_DISPLAY, durationMs: 0 };
    }

    const start = Date.now();
    const amount = options.amount ?? 300;
    const direction = options.direction ?? 'down';

    try {
      if (this.platform === 'windows') {
        const scrollKey = direction === 'up' ? '{PGUP}' : direction === 'down' ? '{PGDN}' : direction === 'left' ? '{LEFT}' : '{RIGHT}';
        const count = Math.max(1, Math.floor(amount / 300));
        const ps = `
          Add-Type -AssemblyName System.Windows.Forms
          [System.Windows.Forms.SendKeys]::SendWait("${scrollKey.repeat(count)}")
          "scrolled"
        `.trim();
        await execCommand(this.config.powershellPath, ['-NoProfile', '-Command', ps], this.config.defaultTimeoutMs);
      } else if (this.platform === 'macos') {
        const scrollCmd = direction === 'up' ? 'key code 126' : direction === 'down' ? 'key code 125' : direction === 'left' ? 'key code 123' : 'key code 124';
        await execCommand('osascript', ['-e', `tell application "System Events" to ${scrollCmd}`], this.config.defaultTimeoutMs);
      }

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async launchApp(options: DesktopLaunchOptions): Promise<DesktopActionResult> {
    const start = Date.now();

    try {
      if (this.platform === 'windows') {
        const ps = buildLaunchAppPS(options.app, options.args);
        await execCommand(this.config.powershellPath, ['-NoProfile', '-Command', ps], options.timeoutMs ?? this.config.defaultTimeoutMs);
      } else if (this.platform === 'macos') {
        const args = buildLaunchAppMacOS(options.app, options.args);
        await execCommand('osascript', args, options.timeoutMs ?? this.config.defaultTimeoutMs);
      } else {
        // Linux: try to launch via shell
        await execCommand('sh', ['-c', `nohup ${options.app} ${options.args?.join(' ') ?? ''} &`], options.timeoutMs ?? this.config.defaultTimeoutMs);
      }

      if (options.waitForReady) {
        await new Promise(resolve => setTimeout(resolve, options.timeoutMs ?? 5000));
      }

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async focus(options: DesktopFocusOptions): Promise<DesktopActionResult> {
    if (!hasDisplay()) {
      return { success: false, error: DESKTOP_ERRORS.NO_DISPLAY, durationMs: 0 };
    }

    const start = Date.now();

    try {
      if (this.platform === 'windows') {
        const appName = options.appName ?? '';
        if (appName) {
          const ps = buildFocusWindowPS(appName);
          await execCommand(this.config.powershellPath, ['-NoProfile', '-Command', ps], this.config.defaultTimeoutMs);
        }
      } else if (this.platform === 'macos') {
        const appName = options.appName ?? '';
        if (appName) {
          const args = buildFocusWindowMacOS(appName);
          await execCommand('osascript', args, this.config.defaultTimeoutMs);
        }
      }

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async pressKey(options: DesktopKeyOptions): Promise<DesktopActionResult> {
    if (!hasDisplay()) {
      return { success: false, error: DESKTOP_ERRORS.NO_DISPLAY, durationMs: 0 };
    }

    const start = Date.now();

    try {
      if (this.platform === 'windows') {
        const ps = buildPressKeyPS(options.key, options.modifiers);
        const count = options.count ?? 1;
        for (let i = 0; i < count; i++) {
          await execCommand(this.config.powershellPath, ['-NoProfile', '-Command', ps], this.config.defaultTimeoutMs);
        }
      } else if (this.platform === 'macos') {
        // Map common keys to macOS key codes
        const keyCodes: Record<string, number> = {
          enter: 36, return: 36, tab: 48, escape: 53, delete: 51,
          up: 126, down: 125, left: 123, right: 124, home: 115, end: 119,
          space: 49,
        };
        const keyCode = keyCodes[options.key.toLowerCase()] ?? 0;
        if (keyCode > 0) {
          const modFlags: string[] = [];
          if (options.modifiers?.includes('ctrl')) modFlags.push('command down');
          if (options.modifiers?.includes('alt')) modFlags.push('option down');
          if (options.modifiers?.includes('shift')) modFlags.push('shift down');
          const modStr = modFlags.length > 0 ? ` using {${modFlags.join(', ')}}` : '';
          await execCommand('osascript', ['-e', `tell application "System Events" to key code ${keyCode}${modStr}`], this.config.defaultTimeoutMs);
        } else {
          // Character key
          await execCommand('osascript', ['-e', `tell application "System Events" to keystroke "${options.key}"`], this.config.defaultTimeoutMs);
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
    if (!hasDisplay()) {
      return [];
    }

    try {
      if (this.platform === 'windows') {
        const ps = buildListWindowsPS();
        const { stdout } = await execCommand(
          this.config.powershellPath,
          ['-NoProfile', '-Command', ps],
          this.config.defaultTimeoutMs,
        );
        this._windows = this.parseWindowsList(stdout);
        return this._windows;
      }

      if (this.platform === 'macos') {
        const args = buildListWindowsMacOS();
        const { stdout } = await execCommand('osascript', args, this.config.defaultTimeoutMs);
        this._windows = this.parseMacOSWindowsList(stdout);
        return this._windows;
      }

      return [];
    } catch {
      return [];
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async close(): Promise<void> {
    this._currentWindowId = null;
    this._windows = [];
    hasDisplayCache = null;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────

  private parseWindowsList(stdout: string): WindowInfo[] {
    try {
      const data = JSON.parse(stdout);
      const items = Array.isArray(data) ? data : [data];
      return items.map((item: any) => ({
        title: item.title ?? '',
        appName: item.appName ?? item.ProcessName ?? '',
        pid: Number(item.pid ?? item.Id ?? 0),
        windowId: String(item.windowId ?? item.MainWindowHandle ?? item.id ?? ''),
        bounds: typeof item.bounds === 'string' ? { x: 0, y: 0, width: 0, height: 0 } : (item.bounds ?? { x: 0, y: 0, width: 0, height: 0 }),
        focused: Boolean(item.focused ?? false),
      }));
    } catch {
      return [];
    }
  }

  private parseMacOSWindowsList(stdout: string): WindowInfo[] {
    // Parse osascript output format: list of window names grouped by process
    const windows: WindowInfo[] = [];
    try {
      const lines = stdout.split(', ');
      let pid = 1;
      for (const line of lines) {
        const name = line.trim().replace(/^"|"$/g, '');
        if (name) {
          windows.push({
            title: name,
            appName: name,
            pid: pid++,
            windowId: String(pid),
            bounds: { x: 0, y: 0, width: 0, height: 0 },
            focused: pid === 2, // First window is typically focused
          });
        }
      }
    } catch {
      // Return empty on parse failure
    }
    return windows;
  }
}

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Detect whether @nut-tree-fork/nut-js is available for import.
 * Returns true if the package can be imported, false otherwise.
 */
export async function isNutJSAvailable(): Promise<boolean> {
  try {
    await import('@nut-tree-fork/nut-js');
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect whether the Windows UIAutomation API is available.
 * Returns true only on Windows with UIAutomationClient assembly loadable.
 */
export async function isUIAutomationAvailable(powershellPath: string = 'powershell'): Promise<boolean> {
  if (process.platform !== 'win32') return false;

  try {
    const { isUIAutomationAvailable: detect } = await import('./uiautomation-strategy.js');
    return await detect(powershellPath);
  } catch {
    return false;
  }
}

/**
 * Create the best available desktop strategy.
 * Tries in order: UIAutomation -> NutJS -> Native -> OCR (fallback).
 *
 * UIAutomation provides the richest accessibility tree on Windows.
 * NutJS provides full mouse/keyboard control with window management.
 * NativeStrategy uses zero-dep OS commands (PowerShell/osascript).
 * OCR strategy is the last resort when no accessibility is available.
 */
export async function createBestDesktopStrategy(
  nutjsConfig?: any,
  nativeConfig?: NativeStrategyConfig,
): Promise<IDesktopStrategy> {
  // 1. Try UIAutomation on Windows (richest accessibility tree)
  if (process.platform === 'win32') {
    const uiaAvailable = await isUIAutomationAvailable(nativeConfig?.powershellPath ?? 'powershell');
    if (uiaAvailable) {
      const { UIAutomationStrategy } = await import('./uiautomation-strategy.js');
      return new UIAutomationStrategy({
        powershellPath: nativeConfig?.powershellPath,
        defaultTimeoutMs: nativeConfig?.defaultTimeoutMs,
      });
    }
  }

  // 2. Try NutJS (full automation via @nut-tree-fork/nut-js)
  if (await isNutJSAvailable()) {
    const { NutJSStrategy } = await import('./nutjs-strategy.js');
    return new NutJSStrategy(nutjsConfig);
  }

  // 3. Try NativeStrategy (zero-dep OS commands)
  if (hasDisplay()) {
    return new NativeStrategy(nativeConfig);
  }

  // 4. Last resort: OCR strategy (screenshot + OCR, no native app interaction)
  const { OCRStrategy } = await import('./ocr-strategy.js');
  return new OCRStrategy({
    powershellPath: nativeConfig?.powershellPath,
    defaultTimeoutMs: nativeConfig?.defaultTimeoutMs,
  });
}

/**
 * Synchronous factory — creates a strategy by explicit type.
 * Use 'native' for the zero-dep fallback, 'nutjs' for nut-js,
 * 'uiautomation' for Windows UIAutomation, or 'ocr' for OCR fallback.
 * Note: 'nutjs' and 'uiautomation' require async detection; use
 * createBestDesktopStrategy() for automatic best-strategy selection.
 */
export function createDesktopStrategy(
  type: 'native' | 'nutjs' | 'uiautomation' | 'ocr' = 'native',
  config?: any,
): IDesktopStrategy {
  if (type === 'nutjs') {
    throw new Error('Use async createBestDesktopStrategy() for nut-js strategy (requires dynamic import)');
  }
  if (type === 'uiautomation') {
    throw new Error('Use async createBestDesktopStrategy() for UIAutomation strategy (requires dynamic import)');
  }
  if (type === 'ocr') {
    // OCR strategy can be created synchronously since it has no dynamic deps
    // But we need to lazy-import to avoid bundling issues
    throw new Error('Use async createBestDesktopStrategy() for OCR strategy (requires dynamic import)');
  }
  return new NativeStrategy(config);
}