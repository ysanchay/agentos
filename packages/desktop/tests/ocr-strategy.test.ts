/**
 * @agentos/desktop — OCR Strategy Tests
 * Tests the OCR fallback strategy with mocked PowerShell execution.
 * Validates that methods which require native access throw DESKTOP_ERRORS.REQUIRES_NATIVE,
 * and that screenshot/read work with mocked execFile.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OCRStrategy } from '../src/strategies/ocr-strategy.js';
import { DESKTOP_ERRORS } from '../src/types.js';

// ─── Mock child_process ─────────────────────────────────────────────────────

const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
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

describe('OCRStrategy', () => {
  let strategy: OCRStrategy;

  beforeEach(() => {
    strategy = new OCRStrategy();
    mockExecFile.mockReset();
    mockSuccess('');
  });

  it('should have name "ocr"', () => {
    expect(strategy.name).toBe('ocr');
  });

  it('should not support native apps', () => {
    expect(strategy.supportsNativeApps).toBe(false);
  });

  it('should report platform as "unknown"', () => {
    expect(strategy.platform).toBe('unknown');
  });

  it('should accept custom config', () => {
    const custom = new OCRStrategy({
      defaultTimeoutMs: 20_000,
      powershellPath: 'pwsh',
    });
    expect(custom.name).toBe('ocr');
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

  // ─── getTree throws REQUIRES_NATIVE ────────────────────────────────────────

  describe('getTree', () => {
    it('throws DESKTOP_ERRORS.REQUIRES_NATIVE', async () => {
      await expect(strategy.getTree()).rejects.toThrow(DESKTOP_ERRORS.REQUIRES_NATIVE);
    });
  });

  // ─── Query returns empty (no tree access) ─────────────────────────────────

  describe('query', () => {
    it('returns empty array (OCR cannot query elements)', async () => {
      const result = await strategy.query({ name: 'Test' });
      expect(result).toEqual([]);
    });
  });

  // ─── Read returns minimal content ─────────────────────────────────────────

  describe('read', () => {
    it('returns minimal element content via OCR fallback', async () => {
      const result = await strategy.read({ elementId: 'el-1' });
      expect(result).toBeDefined();
      expect(result.elementId).toBe('el-1');
      expect(result.role).toBe('unknown');
      expect(result.name).toBe('');
      expect(result.properties.strategy).toBe('ocr');
    });
  });

  // ─── Click ─────────────────────────────────────────────────────────────────

  describe('click', () => {
    it('returns success for coordinate-based click', async () => {
      mockSuccess('clicked');
      const result = await strategy.click({ x: 100, y: 200 });
      expect(result.success).toBe(true);
    });

    it('returns REQUIRES_NATIVE error for element-based click without coordinates', async () => {
      const result = await strategy.click({ elementId: 'el-1' });
      expect(result.success).toBe(false);
      expect(result.error).toContain(DESKTOP_ERRORS.REQUIRES_NATIVE);
    });

    it('returns failure when PowerShell execution fails', async () => {
      mockError('Click failed');
      const result = await strategy.click({ x: 100, y: 200 });
      expect(result.success).toBe(false);
    });
  });

  // ─── Type ──────────────────────────────────────────────────────────────────

  describe('type', () => {
    it('returns success for type via SendKeys', async () => {
      mockSuccess('typed');
      const result = await strategy.type({ text: 'hello' });
      expect(result.success).toBe(true);
    });

    it('returns failure when PowerShell execution fails', async () => {
      mockError('Type failed');
      const result = await strategy.type({ text: 'hello' });
      expect(result.success).toBe(false);
    });
  });

  // ─── Scroll ───────────────────────────────────────────────────────────────

  describe('scroll', () => {
    it('returns success for scroll via SendKeys', async () => {
      mockSuccess('scrolled');
      const result = await strategy.scroll({ direction: 'down', amount: 300 });
      expect(result.success).toBe(true);
    });

    it('returns failure when PowerShell execution fails', async () => {
      mockError('Scroll failed');
      const result = await strategy.scroll({ direction: 'down' });
      expect(result.success).toBe(false);
    });
  });

  // ─── Launch App ───────────────────────────────────────────────────────────

  describe('launchApp', () => {
    it('returns success when app launches', async () => {
      mockSuccess('launched');
      const result = await strategy.launchApp({ app: 'notepad' });
      expect(result.success).toBe(true);
    });

    it('returns failure when PowerShell execution fails', async () => {
      mockError('App not found');
      const result = await strategy.launchApp({ app: 'nonexistent' });
      expect(result.success).toBe(false);
    });
  });

  // ─── Focus ─────────────────────────────────────────────────────────────────

  describe('focus', () => {
    it('returns success for focus by appName', async () => {
      mockSuccess('focused');
      const result = await strategy.focus({ appName: 'notepad' });
      expect(result.success).toBe(true);
    });

    it('returns REQUIRES_NATIVE error for focus without appName', async () => {
      const result = await strategy.focus({ elementId: 'el-1' });
      expect(result.success).toBe(false);
      expect(result.error).toContain(DESKTOP_ERRORS.REQUIRES_NATIVE);
    });

    it('returns failure when PowerShell execution fails', async () => {
      mockError('Focus failed');
      const result = await strategy.focus({ appName: 'notepad' });
      expect(result.success).toBe(false);
    });
  });

  // ─── Press Key ─────────────────────────────────────────────────────────────

  describe('pressKey', () => {
    it('returns success for key press', async () => {
      mockSuccess('key_pressed');
      const result = await strategy.pressKey({ key: 'enter' });
      expect(result.success).toBe(true);
    });

    it('handles key with modifiers', async () => {
      mockSuccess('key_pressed');
      const result = await strategy.pressKey({ key: 'c', modifiers: ['ctrl'] });
      expect(result.success).toBe(true);
    });

    it('returns failure when PowerShell execution fails', async () => {
      mockError('Key failed');
      const result = await strategy.pressKey({ key: 'enter' });
      expect(result.success).toBe(false);
    });
  });

  // ─── Current Window / List Windows ────────────────────────────────────────

  describe('currentWindow', () => {
    it('returns null when no windows tracked', () => {
      const result = strategy.currentWindow();
      expect(result).toBeNull();
    });
  });

  describe('listWindows', () => {
    it('returns window list from PowerShell output', async () => {
      const windowsJson = JSON.stringify([
        { title: 'Notepad', appName: 'notepad', pid: 1234, windowId: 'hwnd1', focused: false },
      ]);
      mockSuccess(windowsJson);
      const windows = await strategy.listWindows();
      expect(Array.isArray(windows)).toBe(true);
      expect(windows.length).toBe(1);
      expect(windows[0]!.title).toBe('Notepad');
    });

    it('returns empty array when PowerShell fails', async () => {
      mockError('List failed');
      const windows = await strategy.listWindows();
      expect(windows).toEqual([]);
    });
  });

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  describe('close', () => {
    it('closes without error', async () => {
      await expect(strategy.close()).resolves.toBeUndefined();
    });
  });
});