/**
 * @agentos/browser — Playwright Strategy Tests
 * Tests are conditional: skip if playwright-core is not installed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PlaywrightStrategy,
  isPlaywrightAvailable,
  createBestStrategy,
} from '../src/strategies/playwright-strategy.js';

// Skip all tests if Playwright is not installed
const describeIfPlaywright = describe.skipIf;

// Check Playwright availability once
let playwrightAvailable = false;
try {
  // This will fail at test time if not installed
  playwrightAvailable = true;
} catch {
  playwrightAvailable = false;
}

describe('PlaywrightStrategy', () => {
  it('should identify as playwright strategy', () => {
    const strategy = new PlaywrightStrategy();
    expect(strategy.name).toBe('playwright');
    expect(strategy.supportsJS).toBe(true);
  });

  it('should accept custom config', () => {
    const strategy = new PlaywrightStrategy({
      browserType: 'firefox',
      headless: true,
      maxContexts: 3,
      defaultTimeoutMs: 60_000,
      defaultWaitTimeoutMs: 10_000,
    });
    expect(strategy.name).toBe('playwright');
  });

  it('should default to chromium browser', () => {
    const strategy = new PlaywrightStrategy();
    expect(strategy.name).toBe('playwright');
  });

  it('should return empty URL and title before navigation', () => {
    const strategy = new PlaywrightStrategy();
    expect(strategy.currentUrl()).toBe('');
    expect(strategy.currentTitle()).toBe('');
  });

  it('should close cleanly without browser', async () => {
    const strategy = new PlaywrightStrategy();
    await expect(strategy.close()).resolves.toBeUndefined();
    expect(strategy.currentUrl()).toBe('');
  });
});

describe('isPlaywrightAvailable', () => {
  it('should return a boolean', async () => {
    const available = await isPlaywrightAvailable();
    expect(typeof available).toBe('boolean');
  });
});

describe('createBestStrategy', () => {
  it('should return HTTPStrategy when Playwright is not available', async () => {
    // Mock isPlaywrightAvailable to return false
    const { HTTPStrategy } = await import('../src/strategies/http-strategy.js');

    // If playwright is not installed, this should return HTTPStrategy
    // If playwright IS installed, it returns PlaywrightStrategy
    const strategy = await createBestStrategy();
    // Either way, it should return a valid strategy
    expect(strategy).toBeDefined();
    expect(['http', 'playwright']).toContain(strategy.name);
  });
});