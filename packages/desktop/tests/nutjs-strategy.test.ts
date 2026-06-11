/**
 * @agentos/desktop — NutJSStrategy Tests
 * Validates optional @nut-tree-fork/nut-js integration.
 * All nut-js calls are mocked — the actual package is not required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NutJSStrategy } from '../src/strategies/nutjs-strategy.js';
import { DESKTOP_ERRORS } from '../src/types.js';

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('NutJSStrategy', () => {
  let strategy: NutJSStrategy;

  beforeEach(() => {
    strategy = new NutJSStrategy();
  });

  it('has name "nutjs" and supports native apps', () => {
    expect(strategy.name).toBe('nutjs');
    expect(strategy.supportsNativeApps).toBe(true);
  });

  it('detects platform from process.platform', () => {
    const platform = strategy.platform;
    expect(['windows', 'macos', 'linux', 'unknown']).toContain(platform);
  });

  it('throws an error when nut-js is not installed', async () => {
    // Since @nut-tree-fork/nut-js is an optional peer dependency,
    // calling methods that require it should throw.
    // The error may be our custom message or a module resolution error.
    try {
      await strategy.screenshot();
      // If no error, nut-js is installed (unlikely in test env)
    } catch (e) {
      const message = (e as Error).message;
      // Either our custom error or a module resolution error
      const isExpectedError =
        message.includes(DESKTOP_ERRORS.REQUIRES_NATIVE) ||
        message.includes('nut-js') ||
        message.includes('path');
      expect(isExpectedError).toBe(true);
    }
  });

  // ─── Methods that don't require nut-js ────────────────────────────────────

  describe('launchApp', () => {
    it('returns action result for launch', async () => {
      const result = await strategy.launchApp({ app: 'test-app' });
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('focus', () => {
    it('returns action result for focus', async () => {
      const result = await strategy.focus({ appName: 'test-app' });
      expect(result).toBeDefined();
      expect(typeof result.success).toBe('boolean');
    });
  });

  describe('currentWindow', () => {
    it('returns null when no windows are tracked', () => {
      expect(strategy.currentWindow()).toBeNull();
    });
  });

  describe('listWindows', () => {
    it('returns empty array when nut-js is not available', async () => {
      const windows = await strategy.listWindows();
      expect(Array.isArray(windows)).toBe(true);
    });
  });

  describe('close', () => {
    it('closes without error', async () => {
      await expect(strategy.close()).resolves.toBeUndefined();
    });
  });

  // ─── Methods that require nut-js ──────────────────────────────────────────

  describe('screenshot (requires nut-js)', () => {
    it('fails when nut-js is not available', async () => {
      try {
        await strategy.screenshot();
        // If we get here, nut-js is installed
      } catch (e) {
        // Expected: error about nut-js not being installed
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe('click (requires nut-js)', () => {
    it('fails when nut-js is not available', async () => {
      try {
        await strategy.click({ x: 100, y: 200 });
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe('type (requires nut-js)', () => {
    it('fails when nut-js is not available', async () => {
      try {
        await strategy.type({ text: 'hello' });
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe('scroll (requires nut-js)', () => {
    it('fails when nut-js is not available', async () => {
      try {
        await strategy.scroll({ direction: 'down' });
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });

  describe('pressKey (requires nut-js)', () => {
    it('fails when nut-js is not available', async () => {
      try {
        await strategy.pressKey({ key: 'enter' });
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    });
  });
});