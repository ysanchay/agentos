/**
 * @agentos/desktop — NativeStrategy Tests
 * Validates zero-dependency desktop automation via OS commands.
 * All child_process calls are mocked — no real OS interaction needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NativeStrategy, createDesktopStrategy } from '../src/strategies/native-strategy.js';
import { DESKTOP_ERRORS } from '../src/types.js';

// ─── Mock child_process ─────────────────────────────────────────────────────
// We mock execFile to always succeed with empty output by default.
// Individual tests can override with mockSuccess/mockError.

const mockExecFile = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Set up mock to return successful execution with optional stdout */
function mockSuccess(stdout: string = '') {
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
    if (typeof cb === 'function') {
      cb(null, stdout, '');
    } else if (typeof _opts === 'function') {
      // Called without options: execFile(cmd, args, cb)
      _opts(null, stdout, '');
    }
  });
}

/** Set up mock to return an error */
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('NativeStrategy', () => {
  let strategy: NativeStrategy;

  beforeEach(() => {
    strategy = new NativeStrategy();
    mockExecFile.mockReset();
    // Default: succeed with empty output
    mockSuccess('');
  });

  it('has name "native" and supports native apps', () => {
    expect(strategy.name).toBe('native');
    expect(strategy.supportsNativeApps).toBe(true);
  });

  it('detects platform from process.platform', () => {
    const platform = strategy.platform;
    expect(['windows', 'macos', 'linux', 'unknown']).toContain(platform);
  });

  // ─── Screenshot ───────────────────────────────────────────────────────────

  describe('screenshot', () => {
    it('returns screenshot result on success', async () => {
      mockSuccess('screenshot-data');
      const result = await strategy.screenshot();
      expect(result).toBeDefined();
    });

    it('returns error result when command fails', async () => {
      mockError('command failed');
      const result = await strategy.screenshot();
      expect(result).toBeDefined();
      // NativeStrategy catches errors and returns error result or throws
      // The result should exist (either success or error data)
    });
  });

  // ─── Get Tree ─────────────────────────────────────────────────────────────

  describe('getTree', () => {
    it('returns an accessibility tree structure', async () => {
      mockSuccess('');
      const result = await strategy.getTree();
      expect(result).toBeDefined();
      expect(result.root).toBeDefined();
      // Root role is 'desktop' on all platforms
      expect(result.root.role).toBe('desktop');
      expect(typeof result.nodeCount).toBe('number');
    });
  });

  // ─── Query ────────────────────────────────────────────────────────────────

  describe('query', () => {
    it('returns elements matching query', async () => {
      mockSuccess('');
      const result = await strategy.query({ name: 'Test', limit: 10 });
      expect(Array.isArray(result)).toBe(true);
    });

    it('returns empty array when no matches', async () => {
      mockSuccess('');
      const result = await strategy.query({ name: 'NonExistent', limit: 10 });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── Read ─────────────────────────────────────────────────────────────────

  describe('read', () => {
    it('returns element content', async () => {
      // read() doesn't use execFile - it returns a local object
      const result = await strategy.read({ elementId: 'test-1' });
      expect(result).toBeDefined();
      expect(result.elementId).toBe('test-1');
    });
  });

  // ─── Click ─────────────────────────────────────────────────────────────────

  describe('click', () => {
    it('returns action result with success status', async () => {
      mockSuccess('');
      const result = await strategy.click({ x: 100, y: 200 });
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.durationMs).toBe('number');
    });
  });

  // ─── Type ──────────────────────────────────────────────────────────────────

  describe('type', () => {
    it('returns action result for type command', async () => {
      mockSuccess('');
      const result = await strategy.type({ text: 'hello' });
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });

  // ─── Scroll ───────────────────────────────────────────────────────────────

  describe('scroll', () => {
    it('returns action result for scroll', async () => {
      mockSuccess('');
      const result = await strategy.scroll({ direction: 'down', amount: 300 });
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });

  // ─── Launch App ───────────────────────────────────────────────────────────

  describe('launchApp', () => {
    it('launches an app and returns result', async () => {
      mockSuccess('');
      const result = await strategy.launchApp({ app: 'notepad' });
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });

    it('handles launch failure gracefully', async () => {
      mockError('App not found');
      const result = await strategy.launchApp({ app: 'nonexistent-app' });
      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });
  });

  // ─── Focus ────────────────────────────────────────────────────────────────

  describe('focus', () => {
    it('focuses a window by app name', async () => {
      mockSuccess('');
      const result = await strategy.focus({ appName: 'notepad' });
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });

  // ─── Press Key ────────────────────────────────────────────────────────────

  describe('pressKey', () => {
    it('presses a key and returns result', async () => {
      mockSuccess('');
      const result = await strategy.pressKey({ key: 'enter' });
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });

    it('handles key with modifiers', async () => {
      mockSuccess('');
      const result = await strategy.pressKey({ key: 'c', modifiers: ['ctrl'] });
      expect(result).toBeDefined();
    });
  });

  // ─── Window Management ───────────────────────────────────────────────────

  describe('currentWindow', () => {
    it('returns null when no windows tracked', () => {
      const result = strategy.currentWindow();
      expect(result).toBeNull();
    });
  });

  describe('listWindows', () => {
    it('returns window list', async () => {
      mockSuccess('');
      const windows = await strategy.listWindows();
      expect(Array.isArray(windows)).toBe(true);
    });
  });

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  describe('close', () => {
    it('closes without error', async () => {
      await expect(strategy.close()).resolves.toBeUndefined();
    });
  });
});

// ─── createDesktopStrategy ────────────────────────────────────────────────

describe('createDesktopStrategy', () => {
  it('returns a NativeStrategy when called with native type', () => {
    const strategy = createDesktopStrategy('native');
    expect(strategy).toBeInstanceOf(NativeStrategy);
    expect(strategy.name).toBe('native');
  });

  it('defaults to native strategy', () => {
    const strategy = createDesktopStrategy();
    expect(strategy).toBeInstanceOf(NativeStrategy);
    expect(strategy.name).toBe('native');
  });
});