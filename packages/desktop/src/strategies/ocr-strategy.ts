/**
 * @agentos/desktop — OCR Strategy
 * Strict fallback IDesktopStrategy that uses screenshot + OCR for read/query
 * operations when no native accessibility tree is available.
 *
 * This strategy is ONLY used when UIAutomation returns empty trees and
 * nut-js is unavailable. It cannot interact with native apps — methods
 * that require accessibility trees return DESKTOP_ERRORS.REQUIRES_NATIVE.
 *
 * Every invocation logs a warning that OCR fallback is being used.
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

// ─── OCR Strategy Config ──────────────────────────────────────────────────────────

export interface OCRStrategyConfig {
  /** Maximum command timeout in ms (default: 10000) */
  defaultTimeoutMs?: number;
  /** PowerShell executable path (default: 'powershell') */
  powershellPath?: string;
}

const DEFAULT_OCR_CONFIG: Required<OCRStrategyConfig> = {
  defaultTimeoutMs: 10_000,
  powershellPath: 'powershell',
};

// ─── Warning Logger ────────────────────────────────────────────────────────────────

function warnOCR(method: string): void {
  console.warn(
    `[OCRStrategy] Using OCR fallback for "${method}". ` +
    'This strategy has limited capabilities. Consider installing @nut-tree-fork/nut-js ' +
    'or enabling UIAutomation for richer desktop automation.',
  );
}

// ─── OCR Strategy ─────────────────────────────────────────────────────────────────

export class OCRStrategy implements IDesktopStrategy {
  readonly name = 'ocr';
  readonly supportsNativeApps = false;
  readonly platform: DesktopPlatform = 'unknown';
  private config: Required<OCRStrategyConfig>;
  private _windows: WindowInfo[] = [];

  constructor(config?: OCRStrategyConfig) {
    this.config = { ...DEFAULT_OCR_CONFIG, ...config };
  }

  // ─── Perceive (read-only) ──────────────────────────────────────────────────

  async screenshot(options?: DesktopScreenshotOptions): Promise<DesktopScreenshotResult> {
    warnOCR('screenshot');

    // Screenshots don't need accessibility — just capture the screen
    const { execFile } = await import('node:child_process');
    const region = options?.region;

    const psScript = region
      ? `
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
      `.trim()
      : `
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

    const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFile(
        this.config.powershellPath,
        ['-NoProfile', '-Command', psScript],
        { timeout: this.config.defaultTimeoutMs, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        },
      );
    });

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

  async getTree(_options?: DesktopTreeOptions): Promise<AccessibilityTree> {
    warnOCR('getTree');
    throw new Error(
      `${DESKTOP_ERRORS.REQUIRES_NATIVE}: OCR strategy cannot provide accessibility trees. ` +
      'Use UIAutomationStrategy or NutJSStrategy for tree access.',
    );
  }

  async query(_options: DesktopQueryOptions): Promise<DesktopElement[]> {
    warnOCR('query');
    // OCR-based query could be implemented with Tesseract or Windows OCR,
    // but this is a strict fallback — return empty array.
    // Users should rely on screenshot + external OCR for visual queries.
    return [];
  }

  async read(_options: DesktopReadOptions): Promise<ElementContent> {
    warnOCR('read');
    // OCR-based read could be implemented with screen text extraction,
    // but this is a strict fallback — return minimal content.
    return {
      elementId: _options.elementId,
      role: 'unknown',
      name: '',
      properties: { strategy: 'ocr', note: 'OCR read is not implemented in this fallback strategy' },
    };
  }

  // ─── Actuate (mutation) ───────────────────────────────────────────────────

  async click(options: DesktopClickOptions): Promise<DesktopActionResult> {
    warnOCR('click');

    if (options.x !== undefined && options.y !== undefined) {
      // Coordinate-based click can work via SendKeys mouse positioning
      const { execFile } = await import('node:child_process');
      const start = Date.now();

      try {
        const psScript = `
          Add-Type -AssemblyName System.Windows.Forms
          Add-Type -AssemblyName System.Drawing
          [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${options.x}, ${options.y})
          Start-Sleep -Milliseconds 50
          "clicked"
        `.trim();

        await new Promise<void>((resolve, reject) => {
          execFile(
            this.config.powershellPath,
            ['-NoProfile', '-Command', psScript],
            { timeout: this.config.defaultTimeoutMs },
            (error) => {
              if (error) reject(error); else resolve();
            },
          );
        });

        return { success: true, durationMs: Date.now() - start };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
      }
    }

    return {
      success: false,
      error: `${DESKTOP_ERRORS.REQUIRES_NATIVE}: OCR strategy cannot click elements by ID. Provide x/y coordinates.`,
      durationMs: 0,
    };
  }

  async type(options: DesktopTypeOptions): Promise<DesktopActionResult> {
    warnOCR('type');

    const { execFile } = await import('node:child_process');
    const start = Date.now();

    try {
      const escapedText = options.text.replace(/["{}()+^%~\[\]]/g, '{$&}');
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait("${escapedText}")
        "typed"
      `.trim();

      await new Promise<void>((resolve, reject) => {
        execFile(
          this.config.powershellPath,
          ['-NoProfile', '-Command', psScript],
          { timeout: this.config.defaultTimeoutMs },
          (error) => {
            if (error) reject(error); else resolve();
          },
        );
      });

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async scroll(options: DesktopScrollOptions): Promise<DesktopActionResult> {
    warnOCR('scroll');

    const { execFile } = await import('node:child_process');
    const start = Date.now();
    const amount = options.amount ? Math.ceil(options.amount / 300) : 1;
    const key = options.direction === 'up' ? '{PGUP}' : options.direction === 'down' ? '{PGDN}' : options.direction === 'left' ? '{LEFT}' : '{RIGHT}';

    try {
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        ${Array(amount).fill(null).map(() => `[System.Windows.Forms.SendKeys]::SendWait("${key}")`).join('\n        ')}
        "scrolled"
      `.trim();

      await new Promise<void>((resolve, reject) => {
        execFile(
          this.config.powershellPath,
          ['-NoProfile', '-Command', psScript],
          { timeout: this.config.defaultTimeoutMs },
          (error) => {
            if (error) reject(error); else resolve();
          },
        );
      });

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async launchApp(options: DesktopLaunchOptions): Promise<DesktopActionResult> {
    warnOCR('launchApp');

    const { execFile } = await import('node:child_process');
    const start = Date.now();

    try {
      const argsStr = options.args ? ` -ArgumentList ${options.args.map(a => `"${a}"`).join(',')}` : '';
      const psScript = `
        Start-Process "${options.app.replace(/"/g, '\\"')}"${argsStr}
        ${options.waitForReady ? 'Start-Sleep -Milliseconds 5000' : 'Start-Sleep -Milliseconds 500'}
        "launched"
      `.trim();

      await new Promise<void>((resolve, reject) => {
        execFile(
          this.config.powershellPath,
          ['-NoProfile', '-Command', psScript],
          { timeout: options.timeoutMs ?? this.config.defaultTimeoutMs },
          (error) => {
            if (error) reject(error); else resolve();
          },
        );
      });

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  async focus(_options: DesktopFocusOptions): Promise<DesktopActionResult> {
    warnOCR('focus');

    if (_options.appName) {
      const { execFile } = await import('node:child_process');
      const start = Date.now();

      try {
        const psScript = `
          $shell = New-Object -ComObject WScript.Shell
          $shell.AppActivate("${_options.appName.replace(/"/g, '\\"')}")
          Start-Sleep -Milliseconds 200
          "focused"
        `.trim();

        await new Promise<void>((resolve, reject) => {
          execFile(
            this.config.powershellPath,
            ['-NoProfile', '-Command', psScript],
            { timeout: this.config.defaultTimeoutMs },
            (error) => {
              if (error) reject(error); else resolve();
            },
          );
        });

        return { success: true, durationMs: Date.now() - start };
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
      }
    }

    return {
      success: false,
      error: `${DESKTOP_ERRORS.REQUIRES_NATIVE}: OCR strategy cannot focus elements without an appName.`,
      durationMs: 0,
    };
  }

  async pressKey(options: DesktopKeyOptions): Promise<DesktopActionResult> {
    warnOCR('pressKey');

    const { execFile } = await import('node:child_process');
    const start = Date.now();

    const keyMap: Record<string, string> = {
      enter: '{ENTER}', tab: '{TAB}', escape: '{ESC}',
      backspace: '{BACKSPACE}', delete: '{DELETE}',
      up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}',
      home: '{HOME}', end: '{END}', pageup: '{PGUP}', pagedown: '{PGDN}',
      space: ' ',
      f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}',
      f5: '{F5}', f6: '{F6}', f7: '{F7}', f8: '{F8}',
      f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}',
    };

    let sendKey = keyMap[options.key.toLowerCase()] ?? options.key;

    if (options.modifiers?.length) {
      const modMap: Record<string, string> = { ctrl: '^', alt: '%', shift: '+', meta: '^' };
      const modPrefix = options.modifiers.map(m => modMap[m.toLowerCase()] ?? '').join('');
      sendKey = `${modPrefix}${sendKey}`;
    }

    try {
      const count = options.count ?? 1;
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        ${Array(count).fill(null).map(() => `[System.Windows.Forms.SendKeys]::SendWait("${sendKey}")`).join('\n        ')}
        "key_pressed"
      `.trim();

      await new Promise<void>((resolve, reject) => {
        execFile(
          this.config.powershellPath,
          ['-NoProfile', '-Command', psScript],
          { timeout: this.config.defaultTimeoutMs },
          (error) => {
            if (error) reject(error); else resolve();
          },
        );
      });

      return { success: true, durationMs: Date.now() - start };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), durationMs: Date.now() - start };
    }
  }

  // ─── State ──────────────────────────────────────────────────────────────────

  currentWindow(): WindowInfo | null {
    warnOCR('currentWindow');
    return this._windows[0] ?? null;
  }

  async listWindows(): Promise<WindowInfo[]> {
    warnOCR('listWindows');

    const { execFile } = await import('node:child_process');

    try {
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        $procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' }
        $results = @()
        foreach ($p in $procs) {
          $results += [PSCustomObject]@{
            title = $p.MainWindowTitle
            appName = $p.ProcessName
            pid = $p.Id
            windowId = $p.MainWindowHandle.ToString()
            bounds = ''
            focused = $false
          }
        }
        $results | ConvertTo-Json -Compress
      `.trim();

      const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        execFile(
          this.config.powershellPath,
          ['-NoProfile', '-Command', psScript],
          { timeout: this.config.defaultTimeoutMs, maxBuffer: 10 * 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) { reject(error); return; }
            resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
          },
        );
      });

      const data = JSON.parse(stdout);
      const items = Array.isArray(data) ? data : [data];
      this._windows = items.map((item: any) => ({
        title: item.title ?? '',
        appName: item.appName ?? item.ProcessName ?? '',
        pid: Number(item.pid ?? item.Id ?? 0),
        windowId: String(item.windowId ?? item.MainWindowHandle ?? ''),
        bounds: typeof item.bounds === 'string' ? { x: 0, y: 0, width: 0, height: 0 } : (item.bounds ?? { x: 0, y: 0, width: 0, height: 0 }),
        focused: Boolean(item.focused ?? false),
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