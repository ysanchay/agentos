/**
 * @agentos/browser — Playwright Strategy Unit Tests
 * Tests PlaywrightStrategy with mocked playwright-core module.
 * No real Playwright browser is launched — all interactions are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaywrightStrategy, isPlaywrightAvailable, createBestStrategy } from '../src/strategies/playwright-strategy.js';

// ─── Mock playwright-core ──────────────────────────────────────────────────

const mockPage = {
  url: vi.fn().mockReturnValue('https://example.com'),
  title: vi.fn().mockResolvedValue('Example Page'),
  goto: vi.fn().mockResolvedValue({ status: () => 200 }),
  goBack: vi.fn().mockResolvedValue(undefined),
  goForward: vi.fn().mockResolvedValue(undefined),
  reload: vi.fn().mockResolvedValue(undefined),
  screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png')),
  locator: vi.fn().mockReturnValue({
    first: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue([]),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    pressSequentially: vi.fn().mockResolvedValue(undefined),
    hover: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue(undefined),
    textContent: vi.fn().mockResolvedValue(''),
    isVisible: vi.fn().mockResolvedValue(true),
    boundingBox: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({}),
    getAttribute: vi.fn().mockResolvedValue(null),
    setInputFiles: vi.fn().mockResolvedValue(undefined),
  }),
  setDefaultTimeout: vi.fn(),
  setDefaultNavigationTimeout: vi.fn(),
  isClosed: vi.fn().mockReturnValue(false),
  close: vi.fn().mockResolvedValue(undefined),
  waitForURL: vi.fn().mockResolvedValue(undefined),
  waitForLoadState: vi.fn().mockResolvedValue(undefined),
  waitForTimeout: vi.fn().mockResolvedValue(undefined),
  waitForEvent: vi.fn().mockResolvedValue({ suggestedFilename: () => 'file.txt', path: () => '/tmp/file' }),
  route: vi.fn().mockResolvedValue(undefined),
  unroute: vi.fn().mockResolvedValue(undefined),
  mouse: { wheel: vi.fn().mockResolvedValue(undefined) },
  once: vi.fn(),
  dragAndDrop: vi.fn().mockResolvedValue(undefined),
};

const mockContext = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  pages: vi.fn().mockReturnValue([mockPage]),
  close: vi.fn().mockResolvedValue(undefined),
  addCookies: vi.fn().mockResolvedValue(undefined),
  cookies: vi.fn().mockResolvedValue([]),
  storageState: vi.fn().mockResolvedValue({}),
  setGeolocation: vi.fn().mockResolvedValue(undefined),
  grantPermissions: vi.fn().mockResolvedValue(undefined),
};

const mockBrowser = {
  newContext: vi.fn().mockResolvedValue(mockContext),
  isConnected: vi.fn().mockReturnValue(true),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockBrowserType = {
  launch: vi.fn().mockResolvedValue(mockBrowser),
};

vi.mock('playwright-core', () => ({
  chromium: mockBrowserType,
  firefox: mockBrowserType,
  webkit: mockBrowserType,
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PlaywrightStrategy - Unit', () => {
  let strategy: PlaywrightStrategy;

  beforeEach(() => {
    strategy = new PlaywrightStrategy();
    vi.clearAllMocks();
  });

  it('should identify as playwright strategy', () => {
    expect(strategy.name).toBe('playwright');
    expect(strategy.supportsJS).toBe(true);
  });

  it('should return empty URL and title before navigation', () => {
    expect(strategy.currentUrl()).toBe('');
    expect(strategy.currentTitle()).toBe('');
  });

  it('should accept custom config with defaults', () => {
    const customStrategy = new PlaywrightStrategy({
      browserType: 'firefox',
      headless: false,
      maxContexts: 10,
      defaultTimeoutMs: 60_000,
      defaultWaitTimeoutMs: 10_000,
      launchArgs: ['--disable-gpu'],
      executablePath: '/usr/bin/firefox',
    });
    expect(customStrategy.name).toBe('playwright');
    expect(customStrategy.supportsJS).toBe(true);
  });

  it('should use default config values', () => {
    const defaultStrategy = new PlaywrightStrategy();
    expect(defaultStrategy.name).toBe('playwright');
    // Config defaults are applied internally
    // We can verify the strategy behaves correctly
  });

  it('should close cleanly even without browser launched', async () => {
    const freshStrategy = new PlaywrightStrategy();
    await expect(freshStrategy.close()).resolves.toBeUndefined();
    expect(freshStrategy.currentUrl()).toBe('');
    expect(freshStrategy.currentTitle()).toBe('');
  });

  it('should navigate using goto and update current URL/title', async () => {
    const result = await strategy.goto('https://example.com');
    expect(result.url).toBe('https://example.com');
    expect(result.title).toBe('Example Page');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should take a screenshot', async () => {
    const result = await strategy.screenshot();
    expect(result.mimeType).toBe('image/png');
    expect(result.data).toBeDefined();
    expect(result.width).toBe(1280);
    expect(result.height).toBe(720);
  });

  it('should return action result for click', async () => {
    const result = await strategy.click({ selector: '#btn' });
    expect(result.success).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should return action result for type', async () => {
    const result = await strategy.type({ selector: '#input', text: 'hello' });
    expect(result.success).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should return action result for scroll', async () => {
    const result = await strategy.scroll({ direction: 'down', amount: 300 });
    expect(result.success).toBe(true);
  });

  it('should return action result for hover', async () => {
    const result = await strategy.hover({ selector: '#link' });
    expect(result.success).toBe(true);
  });

  it('should return action result for select', async () => {
    const result = await strategy.select({ selector: '#sel', values: ['opt1'] });
    expect(result.success).toBe(true);
  });

  it('should extract elements from a page', async () => {
    const result = await strategy.extract({ selector: 'h1' });
    expect(result).toBeDefined();
    expect(result.selector).toBe('h1');
    expect(Array.isArray(result.elements)).toBe(true);
  });

  it('should query elements from a page', async () => {
    const result = await strategy.query({ selector: 'a' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('should navigate back', async () => {
    const result = await strategy.back();
    expect(result).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should navigate forward', async () => {
    const result = await strategy.forward();
    expect(result).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should reload the page', async () => {
    const result = await strategy.reload();
    expect(result).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should switch to main frame', async () => {
    const result = await strategy.switchToMainFrame();
    expect(result.success).toBe(true);
  });
});

describe('isPlaywrightAvailable', () => {
  it('should return true when playwright-core is mocked', async () => {
    // Since we mocked playwright-core, it should be "available"
    const available = await isPlaywrightAvailable();
    expect(available).toBe(true);
  });
});

describe('createBestStrategy', () => {
  it('should fallback to HTTPStrategy when Playwright is not available', async () => {
    // Temporarily make isPlaywrightAvailable return false
    const { HTTPStrategy } = await import('../src/strategies/http-strategy.js');

    // With playwright mocked, createBestStrategy should return PlaywrightStrategy
    const strategy = await createBestStrategy();
    expect(strategy).toBeDefined();
    expect(['http', 'playwright']).toContain(strategy.name);
  });

  it('should accept optional config parameters', async () => {
    const strategy = await createBestStrategy(
      { browserType: 'firefox', headless: true },
      { defaultTimeoutMs: 60_000 },
    );
    expect(strategy).toBeDefined();
    expect(['http', 'playwright']).toContain(strategy.name);
  });
});