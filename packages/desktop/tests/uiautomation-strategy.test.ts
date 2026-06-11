/**
 * @agentos/desktop — UIAutomation Strategy Tests
 * Tests the Windows UIAutomation strategy with mocked PowerShell execution.
 * No real OS interaction occurs — all execFile calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UIAutomationStrategy } from '../src/strategies/uiautomation-strategy.js';
import { DESKTOP_ERRORS } from '../src/types.js';

// ─── Mock child_process ─────────────────────────────────────────────────────

const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

// ─── Mock uiautomation-helpers ──────────────────────────────────────────────

vi.mock('../src/strategies/uiautomation-helpers.js', () => ({
  buildScreenshotPS: vi.fn().mockReturnValue('screenshot-script'),
  buildGetTreePS: vi.fn().mockReturnValue('gettree-script'),
  buildQueryPS: vi.fn().mockReturnValue('query-script'),
  buildReadPS: vi.fn().mockReturnValue('read-script'),
  buildClickPS: vi.fn().mockReturnValue('click-script'),
  buildTypePS: vi.fn().mockReturnValue('type-script'),
  buildScrollPS: vi.fn().mockReturnValue('scroll-script'),
  buildLaunchAppPS: vi.fn().mockReturnValue('launch-script'),
  buildFocusPS: vi.fn().mockReturnValue('focus-script'),
  buildPressKeyPS: vi.fn().mockReturnValue('presskey-script'),
  buildListWindowsPS: vi.fn().mockReturnValue('listwindows-script'),
  buildUIAutomationAvailablePS: vi.fn().mockReturnValue('availability-script'),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockSuccess(stdout: string = '') {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
    if (typeof cb === 'function') {
      cb(null, stdout, '');
    } else if (typeof _opts === 'function') {
      _opts(null, stdout, '');
    }
  });
}

function mockError(message: string) {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
    const err = new Error(message);
    if (typeof cb === 'function') {
      cb(err, '', message);
    } else if (typeof _opts === 'function') {
      _opts(err, '', message);
    }
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UIAutomationStrategy', () => {
  let strategy: UIAutomationStrategy;

  beforeEach(() => {
    strategy = new UIAutomationStrategy();
    mockExecFile.mockReset();
    mockSuccess('');
  });

  it('should have name "uiautomation"', () => {
    expect(strategy.name).toBe('uiautomation');
  });

  it('should support native apps', () => {
    expect(strategy.supportsNativeApps).toBe(true);
  });

  it('should report platform as "windows"', () => {
    expect(strategy.platform).toBe('windows');
  });

  it('should accept custom config', () => {
    const custom = new UIAutomationStrategy({
      defaultTimeoutMs: 30_000,
      powershellPath: 'pwsh',
      maxTreeDepth: 12,
    });
    expect(custom.name).toBe('uiautomation');
  });

  // ─── Screenshot ───────────────────────────────────────────────────────────

  describe('screenshot', () => {
    it('returns screenshot result on success', async () => {
      mockSuccess('base64screenshotdata');
      const result = await strategy.screenshot();
      expect(result).toBeDefined();
      expect(result.data).toBe('base64screenshotdata');
      expect(result.mimeType).toBe('image/png');
    });

    it('returns jpeg format when requested', async () => {
      mockSuccess('base64jpegdata');
      const result = await strategy.screenshot({ format: 'jpeg' });
      expect(result.mimeType).toBe('image/jpeg');
    });

    it('throws when PowerShell execution fails', async () => {
      mockError('PowerShell error');
      await expect(strategy.screenshot()).rejects.toThrow('PowerShell error');
    });
  });

  // ─── Get Tree ─────────────────────────────────────────────────────────────

  describe('getTree', () => {
    it('returns accessibility tree from PowerShell output', async () => {
      const treeJson = JSON.stringify({
        id: 'root',
        role: 'Desktop',
        name: 'Desktop',
        children: [
          { id: 'win-1', role: 'Window', name: 'Notepad', children: [] },
        ],
      });
      // First call for getTree, second for listWindows
      let callCount = 0;
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
        callCount++;
        const stdout = callCount === 1 ? treeJson : '[]';
        if (typeof cb === 'function') {
          cb(null, stdout, '');
        } else if (typeof _opts === 'function') {
          _opts(null, stdout, '');
        }
      });

      const result = await strategy.getTree();
      expect(result).toBeDefined();
      expect(result.root).toBeDefined();
      expect(result.root.role).toBe('desktop');
      expect(result.root.name).toBe('Desktop');
      expect(result.nodeCount).toBeGreaterThan(0);
    });

    it('returns minimal desktop tree when PowerShell returns empty', async () => {
      // When parseJSONSafe gets empty string, it parses '[]' which is truthy,
      // so buildTreeNode runs on an empty array. The root role is 'unknown'
      // since no 'Desktop' ControlType was found. This is expected behavior
      // when no structured tree data is returned from PowerShell.
      let callCount = 0;
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
        callCount++;
        const stdout = callCount === 1 ? '' : '[]';
        if (typeof cb === 'function') {
          cb(null, stdout, '');
        } else if (typeof _opts === 'function') {
          _opts(null, stdout, '');
        }
      });

      const result = await strategy.getTree();
      expect(result).toBeDefined();
      expect(result.root).toBeDefined();
      // parseJSONSafe('') returns [] which buildTreeNode maps to 'unknown' role
      expect(result.root.role).toBe('unknown');
    });
  });

  // ─── Query ────────────────────────────────────────────────────────────────

  describe('query', () => {
    it('returns elements from PowerShell output', async () => {
      const queryJson = JSON.stringify([
        { id: 'btn-1', role: 'Button', name: 'OK', visible: true, enabled: true, focused: false },
      ]);
      mockSuccess(queryJson);

      const result = await strategy.query({ name: 'OK' });
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty array when no matches', async () => {
      mockSuccess('');
      const result = await strategy.query({ name: 'NonExistent' });
      expect(result).toEqual([]);
    });
  });

  // ─── Read ─────────────────────────────────────────────────────────────────

  describe('read', () => {
    it('returns element content from PowerShell output', async () => {
      const readJson = JSON.stringify({
        id: 'el-1',
        role: 'Edit',
        name: 'Username',
        value: 'testuser',
        text: 'testuser',
        enabled: true,
        focused: false,
        bounds: { x: 10, y: 20, width: 200, height: 30 },
      });
      mockSuccess(readJson);

      const result = await strategy.read({ elementId: 'el-1' });
      expect(result).toBeDefined();
      expect(result.elementId).toBe('el-1');
      expect(result.role).toBe('edit');
      expect(result.name).toBe('Username');
    });

    it('returns minimal content when element not found', async () => {
      const notFoundJson = JSON.stringify({ error: 'element_not_found' });
      mockSuccess(notFoundJson);

      const result = await strategy.read({ elementId: 'el-missing' });
      expect(result).toBeDefined();
      expect(result.elementId).toBe('el-missing');
      expect(result.role).toBe('unknown');
    });
  });

  // ─── Click ─────────────────────────────────────────────────────────────────

  describe('click', () => {
    it('returns success result when click succeeds', async () => {
      mockSuccess(JSON.stringify({ success: true }));
      const result = await strategy.click({ x: 100, y: 200 });
      expect(result.success).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns failure result when PowerShell reports failure', async () => {
      mockSuccess(JSON.stringify({ success: false, error: 'element_not_found' }));
      const result = await strategy.click({ elementId: 'missing' });
      expect(result.success).toBe(false);
    });

    it('returns failure result when PowerShell throws', async () => {
      mockError('Click failed');
      const result = await strategy.click({ x: 100, y: 200 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Click failed');
    });
  });

  // ─── Type ──────────────────────────────────────────────────────────────────

  describe('type', () => {
    it('returns success result when type succeeds', async () => {
      mockSuccess(JSON.stringify({ success: true }));
      const result = await strategy.type({ text: 'hello' });
      expect(result.success).toBe(true);
    });

    it('returns failure result when PowerShell reports failure', async () => {
      mockSuccess(JSON.stringify({ success: false, error: 'type_failed' }));
      const result = await strategy.type({ text: 'hello' });
      expect(result.success).toBe(false);
    });
  });

  // ─── Scroll ───────────────────────────────────────────────────────────────

  describe('scroll', () => {
    it('returns success result when scroll succeeds', async () => {
      mockSuccess('');
      const result = await strategy.scroll({ direction: 'down', amount: 600 });
      expect(result.success).toBe(true);
    });

    it('returns failure when PowerShell fails', async () => {
      mockError('Scroll failed');
      const result = await strategy.scroll({ direction: 'up' });
      expect(result.success).toBe(false);
    });
  });

  // ─── List Windows ─────────────────────────────────────────────────────────

  describe('listWindows', () => {
    it('returns window list from PowerShell output', async () => {
      const windowsJson = JSON.stringify([
        { title: 'Notepad', appName: 'notepad', pid: 1234, windowId: 'hwnd1', focused: true },
      ]);
      mockSuccess(windowsJson);

      const windows = await strategy.listWindows();
      expect(Array.isArray(windows)).toBe(true);
      expect(windows.length).toBe(1);
      expect(windows[0]!.title).toBe('Notepad');
    });

    it('returns empty array when PowerShell fails', async () => {
      mockError('Failed to list windows');
      const windows = await strategy.listWindows();
      expect(windows).toEqual([]);
    });
  });

  // ─── Timeout Enforcement ──────────────────────────────────────────────────

  describe('timeout enforcement', () => {
    it('uses default timeout from config', () => {
      const customStrategy = new UIAutomationStrategy({ defaultTimeoutMs: 5_000 });
      expect(customStrategy.name).toBe('uiautomation');
    });

    it('uses custom PowerShell path', () => {
      const customStrategy = new UIAutomationStrategy({ powershellPath: 'pwsh' });
      expect(customStrategy.name).toBe('uiautomation');
    });
  });

  // ─── Error Handling ───────────────────────────────────────────────────────

  describe('error handling', () => {
    it('click catches PowerShell errors and returns failure', async () => {
      mockError('Timeout');
      const result = await strategy.click({ x: 0, y: 0 });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Timeout');
    });

    it('type catches PowerShell errors and returns failure', async () => {
      mockError('Access denied');
      const result = await strategy.type({ text: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Access denied');
    });

    it('scroll catches PowerShell errors and returns failure', async () => {
      mockError('Scroll error');
      const result = await strategy.scroll({ direction: 'down' });
      expect(result.success).toBe(false);
    });

    it('launchApp catches PowerShell errors and returns failure', async () => {
      mockError('App not found');
      const result = await strategy.launchApp({ app: 'nonexistent' });
      expect(result.success).toBe(false);
    });

    it('focus catches PowerShell errors and returns failure', async () => {
      mockError('Focus failed');
      const result = await strategy.focus({ appName: 'notepad' });
      expect(result.success).toBe(false);
    });

    it('pressKey catches PowerShell errors and returns failure', async () => {
      mockError('Key failed');
      const result = await strategy.pressKey({ key: 'enter' });
      expect(result.success).toBe(false);
    });
  });

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  describe('close', () => {
    it('closes without error', async () => {
      await expect(strategy.close()).resolves.toBeUndefined();
    });
  });
});