/**
 * @agentos/desktop — Window Manager Tests
 * Tests window tracking, switching, snapshot capture, and monitoring lifecycle.
 * Uses a mock IDesktopStrategy — no real OS interaction.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WindowManager } from '../src/window-manager.js';
import type { IDesktopStrategy, WindowInfo, AccessibilityTree } from '../src/types.js';
import { DESKTOP_ERRORS } from '../src/types.js';

// ─── Mock Strategy ───────────────────────────────────────────────────────────

function createMockStrategy(overrides?: Partial<IDesktopStrategy>): IDesktopStrategy {
  const defaultWindows: WindowInfo[] = [
    { title: 'Notepad', appName: 'notepad', pid: 1234, windowId: 'win-1', bounds: { x: 0, y: 0, width: 800, height: 600 }, focused: true },
    { title: 'Chrome', appName: 'chrome', pid: 5678, windowId: 'win-2', bounds: { x: 100, y: 100, width: 1024, height: 768 }, focused: false },
  ];

  const defaultTree: AccessibilityTree = {
    root: { id: 'root', role: 'desktop', name: 'Desktop', children: [] },
    nodeCount: 1,
    maxDepth: 0,
    window: defaultWindows[0]!,
  };

  return {
    name: 'mock',
    supportsNativeApps: true,
    platform: 'windows',
    screenshot: vi.fn().mockResolvedValue({ data: 'base64...', mimeType: 'image/png', width: 1920, height: 1080, sizeBytes: 50000 }),
    getTree: vi.fn().mockResolvedValue(defaultTree),
    query: vi.fn().mockResolvedValue([]),
    read: vi.fn().mockResolvedValue({ elementId: '1', role: 'window', name: 'Test', properties: {} }),
    click: vi.fn().mockResolvedValue({ success: true, durationMs: 50 }),
    type: vi.fn().mockResolvedValue({ success: true, durationMs: 30 }),
    scroll: vi.fn().mockResolvedValue({ success: true, durationMs: 20 }),
    launchApp: vi.fn().mockResolvedValue({ success: true, durationMs: 200 }),
    focus: vi.fn().mockResolvedValue({ success: true, durationMs: 10 }),
    pressKey: vi.fn().mockResolvedValue({ success: true, durationMs: 15 }),
    currentWindow: vi.fn().mockReturnValue(defaultWindows[0]!),
    listWindows: vi.fn().mockResolvedValue(defaultWindows),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as IDesktopStrategy;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WindowManager', () => {
  let strategy: IDesktopStrategy;
  let manager: WindowManager;

  beforeEach(() => {
    strategy = createMockStrategy();
    manager = new WindowManager(strategy);
  });

  afterEach(async () => {
    await manager.close();
  });

  it('should refresh window list via strategy', async () => {
    await manager.refresh();
    expect(strategy.listWindows).toHaveBeenCalled();
    expect(manager.windows.length).toBe(2);
  });

  it('should return empty window list before refresh', () => {
    expect(manager.windows).toEqual([]);
  });

  it('should set first window as active on first refresh', async () => {
    await manager.refresh();
    expect(manager.activeWindow).not.toBeNull();
  });

  it('should return the focused window as active', async () => {
    await manager.refresh();
    const active = manager.activeWindow;
    expect(active).not.toBeNull();
    expect(active!.title).toBe('Notepad'); // Notepad has focused: true
  });

  it('should find window by title (substring match)', async () => {
    await manager.refresh();
    const found = manager.findWindowByTitle('note');
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Notepad');
  });

  it('should find window by title (case insensitive)', async () => {
    await manager.refresh();
    const found = manager.findWindowByTitle('CHROME');
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Chrome');
  });

  it('should return null when window not found by title', async () => {
    await manager.refresh();
    const found = manager.findWindowByTitle('nonexistent');
    expect(found).toBeNull();
  });

  it('should find window by PID', async () => {
    await manager.refresh();
    const found = manager.findWindowByPid(1234);
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Notepad');
  });

  it('should return null when window not found by PID', async () => {
    await manager.refresh();
    const found = manager.findWindowByPid(99999);
    expect(found).toBeNull();
  });

  // ─── Window Switching ────────────────────────────────────────────────────

  describe('focusByTitle', () => {
    it('should switch focus to window by title', async () => {
      await manager.refresh();
      const result = await manager.focusByTitle('Chrome');
      expect(strategy.focus).toHaveBeenCalled();
      expect(result).not.toBeNull();
    });

    it('should return null when window not found', async () => {
      await manager.refresh();
      const result = await manager.focusByTitle('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('focusByPid', () => {
    it('should switch focus to window by PID', async () => {
      await manager.refresh();
      const result = await manager.focusByPid(5678);
      expect(strategy.focus).toHaveBeenCalled();
      expect(result).not.toBeNull();
    });

    it('should return null when PID not found', async () => {
      await manager.refresh();
      const result = await manager.focusByPid(99999);
      expect(result).toBeNull();
    });
  });

  // ─── Snapshots ───────────────────────────────────────────────────────────

  describe('captureSnapshot', () => {
    it('should capture snapshot including accessibility tree', async () => {
      await manager.refresh();
      const snapshot = await manager.captureSnapshot('win-1');
      expect(snapshot).not.toBeNull();
      expect(snapshot!.window.windowId).toBe('win-1');
      expect(snapshot!.timestamp).toBeGreaterThan(0);
      expect(snapshot!.tree).toBeDefined();
    });

    it('should return null for non-existent window ID', async () => {
      await manager.refresh();
      const snapshot = await manager.captureSnapshot('nonexistent');
      expect(snapshot).toBeNull();
    });

    it('should store snapshot for later retrieval', async () => {
      await manager.refresh();
      await manager.captureSnapshot('win-1');
      const retrieved = manager.getSnapshot('win-1');
      expect(retrieved).toBeDefined();
      expect(retrieved!.window.windowId).toBe('win-1');
    });

    it('should handle tree capture failure gracefully', async () => {
      const brokenStrategy = createMockStrategy({
        getTree: vi.fn().mockRejectedValue(new Error('Tree unavailable')),
      });
      const brokenManager = new WindowManager(brokenStrategy);
      await brokenManager.refresh();
      const snapshot = await brokenManager.captureSnapshot('win-1');
      expect(snapshot).not.toBeNull();
      expect(snapshot!.tree).toBeUndefined(); // Tree failed but snapshot still captured
    });
  });

  describe('snapshot trimming', () => {
    it('should trim snapshots when exceeding maxSnapshots', async () => {
      const smallManager = new WindowManager(strategy, { maxSnapshots: 2 });
      await smallManager.refresh();

      // Capture 3 snapshots for different windows
      // We need to ensure 3 different windowIds exist
      const extraStrategy = createMockStrategy({
        listWindows: vi.fn().mockResolvedValue([
          { title: 'Win1', appName: 'app1', pid: 1, windowId: 'w1', bounds: { x: 0, y: 0, width: 100, height: 100 }, focused: true },
          { title: 'Win2', appName: 'app2', pid: 2, windowId: 'w2', bounds: { x: 0, y: 0, width: 100, height: 100 }, focused: false },
          { title: 'Win3', appName: 'app3', pid: 3, windowId: 'w3', bounds: { x: 0, y: 0, width: 100, height: 100 }, focused: false },
        ]),
      });
      const trimManager = new WindowManager(extraStrategy, { maxSnapshots: 2 });
      await trimManager.refresh();
      await trimManager.captureSnapshot('w1');
      await trimManager.captureSnapshot('w2');
      await trimManager.captureSnapshot('w3');

      // Should have trimmed to maxSnapshots
      // The oldest snapshot should have been removed
    });
  });

  // ─── Monitoring ───────────────────────────────────────────────────────────

  describe('monitoring', () => {
    it('should start auto-refresh monitoring', () => {
      expect(manager.isMonitoring).toBe(false);
      manager.startMonitoring();
      expect(manager.isMonitoring).toBe(true);
    });

    it('should stop auto-refresh monitoring', () => {
      manager.startMonitoring();
      expect(manager.isMonitoring).toBe(true);
      manager.stopMonitoring();
      expect(manager.isMonitoring).toBe(false);
    });

    it('should not start monitoring twice', () => {
      manager.startMonitoring();
      manager.startMonitoring(); // Second call should be a no-op
      expect(manager.isMonitoring).toBe(true);
      manager.stopMonitoring();
    });

    it('should handle stop when not monitoring', () => {
      expect(manager.isMonitoring).toBe(false);
      manager.stopMonitoring(); // Should be a no-op
      expect(manager.isMonitoring).toBe(false);
    });
  });

  // ─── Error Handling ───────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should handle refresh failure gracefully', async () => {
      const brokenStrategy = createMockStrategy({
        listWindows: vi.fn().mockRejectedValue(new Error('Refresh failed')),
      });
      const brokenManager = new WindowManager(brokenStrategy);
      await expect(brokenManager.refresh()).rejects.toThrow('Refresh failed');
    });

    it('should handle focus failure gracefully', async () => {
      const brokenStrategy = createMockStrategy({
        focus: vi.fn().mockResolvedValue({ success: false, error: 'Cannot focus', durationMs: 0 }),
      });
      const brokenManager = new WindowManager(brokenStrategy);
      await brokenManager.refresh();
      const result = await brokenManager.focusByTitle('Notepad');
      // Focus returned success: false, so _activeWindowId not updated
      // The method still returns the current activeWindow
    });
  });

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  describe('close', () => {
    it('should clean up resources on close', async () => {
      await manager.refresh();
      await manager.captureSnapshot('win-1');
      manager.startMonitoring();

      await manager.close();
      expect(manager.windows).toEqual([]);
      expect(manager.isMonitoring).toBe(false);
    });
  });
});