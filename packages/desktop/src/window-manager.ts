/**
 * @agentos/desktop — Window Manager
 * Manages desktop window lifecycle: tracking, switching, process monitoring.
 * Works with any IDesktopStrategy to provide window-level orchestration.
 */

import type { IDesktopStrategy, WindowInfo, AccessibilityTree } from './types.js';
import { DESKTOP_ERRORS } from './types.js';

// ─── Window Manager Config ───────────────────────────────────────────────────

export interface WindowManagerConfig {
  /** How often to refresh the window list in ms (default: 5000) */
  refreshIntervalMs?: number;
  /** Maximum number of window snapshots to keep (default: 50) */
  maxSnapshots?: number;
}

const DEFAULT_CONFIG: Required<WindowManagerConfig> = {
  refreshIntervalMs: 5_000,
  maxSnapshots: 50,
};

// ─── Window Snapshot ────────────────────────────────────────────────────────

export interface WindowSnapshot {
  /** Window info at time of snapshot */
  window: WindowInfo;
  /** Accessibility tree snapshot (if captured) */
  tree?: AccessibilityTree;
  /** When this snapshot was taken */
  timestamp: number;
}

// ─── Window Manager ─────────────────────────────────────────────────────────

/**
 * Manages desktop window lifecycle: tracking active windows,
 * switching focus by title/PID/accessibility ID, and process monitoring.
 */
export class WindowManager {
  private strategy: IDesktopStrategy;
  private config: Required<WindowManagerConfig>;
  private snapshots = new Map<string, WindowSnapshot>();
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private _windows: WindowInfo[] = [];
  private _activeWindowId: string | null = null;

  constructor(strategy: IDesktopStrategy, config?: WindowManagerConfig) {
    this.strategy = strategy;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Window Tracking ─────────────────────────────────────────────────────────

  /** Refresh the window list from the current strategy */
  async refresh(): Promise<void> {
    this._windows = await this.strategy.listWindows();
    if (this._windows.length > 0 && !this._activeWindowId) {
      this._activeWindowId = this._windows[0]!.windowId;
    }
  }

  /** Get the current window list */
  get windows(): WindowInfo[] {
    return this._windows;
  }

  /** Get the active (focused) window */
  get activeWindow(): WindowInfo | null {
    return this._windows.find(w => w.focused) ?? this._windows[0] ?? null;
  }

  /** Find a window by title (substring match) */
  findWindowByTitle(title: string): WindowInfo | null {
    const lower = title.toLowerCase();
    return this._windows.find(w => w.title.toLowerCase().includes(lower)) ?? null;
  }

  /** Find a window by PID */
  findWindowByPid(pid: number): WindowInfo | null {
    return this._windows.find(w => w.pid === pid) ?? null;
  }

  // ─── Window Switching ────────────────────────────────────────────────────────

  /** Switch focus to a window by title */
  async focusByTitle(title: string): Promise<WindowInfo | null> {
    const window = this.findWindowByTitle(title);
    if (!window) return null;

    const result = await this.strategy.focus({ appName: window.appName, windowId: window.windowId });
    if (result.success) {
      this._activeWindowId = window.windowId;
      await this.refresh();
    }
    return this.activeWindow;
  }

  /** Switch focus to a window by PID */
  async focusByPid(pid: number): Promise<WindowInfo | null> {
    const window = this.findWindowByPid(pid);
    if (!window) return null;

    const result = await this.strategy.focus({ appName: window.appName, windowId: window.windowId });
    if (result.success) {
      this._activeWindowId = window.windowId;
      await this.refresh();
    }
    return this.activeWindow;
  }

  // ─── Window Snapshots ──────────────────────────────────────────────────────

  /** Capture a snapshot of a window including its accessibility tree */
  async captureSnapshot(windowId: string): Promise<WindowSnapshot | null> {
    const window = this._windows.find(w => w.windowId === windowId);
    if (!window) return null;

    const timestamp = Date.now();
    let tree: AccessibilityTree | undefined;
    try {
      tree = await this.strategy.getTree({ windowId });
    } catch {
      // Tree capture may fail for some windows
    }

    const snapshot: WindowSnapshot = { window, tree, timestamp };
    this.snapshots.set(windowId, snapshot);

    // Trim snapshots if over limit
    if (this.snapshots.size > this.config.maxSnapshots) {
      const oldest = Array.from(this.snapshots.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      for (let i = 0; i < oldest.length - this.config.maxSnapshots; i++) {
        this.snapshots.delete(oldest[i]![0]);
      }
    }

    return snapshot;
  }

  /** Get the latest snapshot for a window */
  getSnapshot(windowId: string): WindowSnapshot | undefined {
    return this.snapshots.get(windowId);
  }

  // ─── Process Monitoring ─────────────────────────────────────────────────────

  /** Start periodic window list refresh */
  startMonitoring(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => {
      this.refresh().catch(() => {});
    }, this.config.refreshIntervalMs);
  }

  /** Stop periodic window list refresh */
  stopMonitoring(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** Check if monitoring is active */
  get isMonitoring(): boolean {
    return this.refreshTimer !== null;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /** Clean up resources */
  async close(): Promise<void> {
    this.stopMonitoring();
    this.snapshots.clear();
    this._windows = [];
    this._activeWindowId = null;
  }
}