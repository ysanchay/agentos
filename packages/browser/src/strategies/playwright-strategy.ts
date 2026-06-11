/**
 * @agentos/browser — Playwright Strategy
 * Full browser automation using playwright-core (optional dependency).
 * Provides JS execution, real screenshots, click/type/scroll/hover/select.
 * Falls back gracefully when Playwright is not installed.
 */

import type {
  IBrowserStrategy,
  NavigateOptions,
  PageState,
  ScreenshotOptions,
  ScreenshotResult,
  ExtractOptions,
  ExtractResult,
  ExtractedElement,
  QueryOptions,
  ElementInfo,
  ClickOptions,
  TypeOptions,
  ScrollOptions,
  HoverOptions,
  SelectOptions,
  ActionResult,
  WaitCondition,
  WaitResult,
  AuthOptions,
  AuthResult,
  DownloadOptions,
  DownloadResult,
  NetworkPattern,
  NetworkHandler,
  DialogAction,
  GeolocationOptions,
  TabInfo,
  DragDropOptions,
  FileUploadOptions,
} from '../types.js';
import { BROWSER_ERRORS } from '../types.js';

// ─── Playwright Strategy Config ────────────────────────────────────────────

export interface PlaywrightStrategyConfig {
  /** Browser type to launch (default: 'chromium') */
  browserType?: 'chromium' | 'firefox' | 'webkit';
  /** Whether to run headless (default: true) */
  headless?: boolean;
  /** Maximum number of browser contexts (default: 5) */
  maxContexts?: number;
  /** Default navigation timeout in ms (default: 30000) */
  defaultTimeoutMs?: number;
  /** Default wait timeout in ms (default: 5000) */
  defaultWaitTimeoutMs?: number;
  /** Extra launch arguments for the browser */
  launchArgs?: string[];
  /** Executable path (if browser is installed elsewhere) */
  executablePath?: string;
}

const DEFAULT_CONFIG: Required<PlaywrightStrategyConfig> = {
  browserType: 'chromium',
  headless: true,
  maxContexts: 5,
  defaultTimeoutMs: 30_000,
  defaultWaitTimeoutMs: 5_000,
  launchArgs: [],
  executablePath: '',
};

// ─── Playwright Strategy ───────────────────────────────────────────────────

/**
 * Full browser automation strategy using Playwright.
 * Requires playwright-core to be installed (optional peer dependency).
 * Supports JavaScript rendering, real screenshots, and all interaction capabilities.
 */
export class PlaywrightStrategy implements IBrowserStrategy {
  readonly name = 'playwright';
  readonly supportsJS = true;

  private config: Required<PlaywrightStrategyConfig>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _browser: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _context: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _page: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _playwrightModule: any = null;

  // Track state for queries
  private _currentUrl = '';
  private _currentTitle = '';

  // Track network interceptions for cleanup
  private _interceptions = new Map<string, { pattern: NetworkPattern; handler: NetworkHandler }>();

  // Track frame navigation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _currentFrame: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _mainFrame: any = null;

  constructor(config?: PlaywrightStrategyConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Lazy Playwright Loading ──────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async ensurePlaywright(): Promise<any> {
    if (this._playwrightModule) return this._playwrightModule;

    try {
      this._playwrightModule = await import('playwright-core');
      return this._playwrightModule;
    } catch {
      throw new Error(
        `${BROWSER_ERRORS.REQUIRES_JS}: playwright-core is not installed. Install it with: pnpm add playwright-core`,
      );
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async ensureBrowser(): Promise<any> {
    if (this._browser && this._browser.isConnected()) return this._browser;

    const pw = await this.ensurePlaywright();
    const browserType = pw[this.config.browserType];

    const launchOptions: Record<string, unknown> = {
      headless: this.config.headless,
      args: this.config.launchArgs,
    };

    if (this.config.executablePath) {
      launchOptions['executablePath'] = this.config.executablePath;
    }

    this._browser = await browserType.launch(launchOptions);
    return this._browser;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async ensureContext(): Promise<any> {
    if (this._context) return this._context;

    const browser = await this.ensureBrowser();
    this._context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'AgentOS-Browser/1.0 (Playwright)',
    });
    return this._context;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async ensurePage(): Promise<any> {
    if (this._page && !this._page.isClosed()) return this._page;

    const context = await this.ensureContext();
    this._page = await context.newPage();
    this._page.setDefaultTimeout(this.config.defaultTimeoutMs);
    this._page.setDefaultNavigationTimeout(this.config.defaultTimeoutMs);
    return this._page;
  }

  // ─── Navigation ────────────────────────────────────────────────────────

  async goto(url: string, options?: NavigateOptions): Promise<PageState> {
    const start = Date.now();
    const page = await this.ensurePage();

    const waitUntil = options?.waitUntil ?? 'domcontentloaded';
    const timeout = options?.timeoutMs ?? this.config.defaultTimeoutMs;

    const response = await page.goto(url, {
      waitUntil: waitUntil as 'load' | 'domcontentloaded' | 'networkidle' | 'commit',
      timeout,
      referer: options?.referrer,
    });

    this._currentUrl = page.url();
    this._currentTitle = await page.title();

    const durationMs = Date.now() - start;
    return {
      url: this._currentUrl,
      title: this._currentTitle,
      statusCode: response?.status(),
      durationMs,
    };
  }

  async back(): Promise<PageState> {
    const start = Date.now();
    const page = await this.ensurePage();
    await page.goBack();
    this._currentUrl = page.url();
    this._currentTitle = await page.title();
    return {
      url: this._currentUrl,
      title: this._currentTitle,
      durationMs: Date.now() - start,
    };
  }

  async forward(): Promise<PageState> {
    const start = Date.now();
    const page = await this.ensurePage();
    await page.goForward();
    this._currentUrl = page.url();
    this._currentTitle = await page.title();
    return {
      url: this._currentUrl,
      title: this._currentTitle,
      durationMs: Date.now() - start,
    };
  }

  async reload(): Promise<PageState> {
    const start = Date.now();
    const page = await this.ensurePage();
    await page.reload();
    this._currentUrl = page.url();
    this._currentTitle = await page.title();
    return {
      url: this._currentUrl,
      title: this._currentTitle,
      durationMs: Date.now() - start,
    };
  }

  // ─── Screenshot ────────────────────────────────────────────────────────

  async screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult> {
    const page = await this.ensurePage();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const screenshotOpts: any = {
      type: options?.format === 'jpeg' ? 'jpeg' : 'png',
      fullPage: options?.fullPage ?? false,
    };

    if (options?.quality !== undefined && options.format === 'jpeg') {
      screenshotOpts['quality'] = options.quality;
    }

    if (options?.clipSelector) {
      const element = await page.locator(options.clipSelector).first();
      const box = await element.boundingBox();
      if (box) {
        screenshotOpts['clip'] = { x: box.x, y: box.y, width: box.width, height: box.height };
      }
    }

    const buffer = await page.screenshot(screenshotOpts);

    return {
      data: buffer.toString('base64'),
      mimeType: options?.format === 'jpeg' ? 'image/jpeg' : 'image/png',
      width: 1280,
      height: 720,
      sizeBytes: buffer.length,
    };
  }

  // ─── Extract ────────────────────────────────────────────────────────────

  async extract(options: ExtractOptions): Promise<ExtractResult> {
    const page = await this.ensurePage();
    const selector = options.selector;
    const properties = options.properties ?? ['text'];

    const elements = await page.locator(selector).all();
    const results: ExtractedElement[] = [];

    for (let i = 0; i < Math.min(elements.length, 100); i++) {
      const el = elements[i]!;
      const extracted = await this.extractElement(el, properties);
      results.push(extracted);
    }

    return {
      elements: results,
      count: results.length,
      selector,
    };
  }

  // ─── Query ──────────────────────────────────────────────────────────────

  async query(options: QueryOptions): Promise<ElementInfo[]> {
    const page = await this.ensurePage();
    const limit = options.limit ?? 100;
    const selector = options.selector;

    const elements = await page.locator(selector).all();
    const results: ElementInfo[] = [];

    for (let i = 0; i < Math.min(elements.length, limit); i++) {
      const el = elements[i]!;
      const tag = await el.evaluate((e: Element) => e.tagName.toLowerCase()).catch(() => 'unknown');
      const text = await el.textContent().catch(() => '');
      const visible = await el.isVisible().catch(() => false);
      const bounds = await el.boundingBox().catch(() => undefined);

      // Extract all attributes
      const attrs = await el.evaluate((e: Element) => {
        const result: Record<string, string> = {};
        for (const attr of Array.from(e.attributes)) {
          result[attr.name] = attr.value;
        }
        return result;
      }).catch(() => ({} as Record<string, string>));

      results.push({
        tag,
        text: (text ?? '').trim().slice(0, 500),
        attributes: attrs,
        bounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : undefined,
        visible,
      });
    }

    return results;
  }

  // ─── Interactions ──────────────────────────────────────────────────────

  async click(options: ClickOptions): Promise<ActionResult> {
    const start = Date.now();
    const page = await this.ensurePage();

    try {
      const el = page.locator(options.selector).first();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const clickOpts: any = {};
      if (options.button) clickOpts['button'] = options.button;
      if (options.clickCount) clickOpts['clickCount'] = options.clickCount;
      if (options.delay) clickOpts['delay'] = options.delay;
      if (options.modifiers) clickOpts['modifiers'] = options.modifiers;

      if (options.waitForNavigation) {
        const navTimeout = options.navigationTimeoutMs ?? this.config.defaultTimeoutMs;
        await Promise.all([
          page.waitForURL('**', { timeout: navTimeout }).catch(() => {}),
          el.click(clickOpts),
        ]);
      } else {
        await el.click(clickOpts);
      }

      this._currentUrl = page.url();
      this._currentTitle = await page.title();

      return {
        success: true,
        url: this._currentUrl,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
    }
  }

  async type(options: TypeOptions): Promise<ActionResult> {
    const start = Date.now();
    const page = await this.ensurePage();

    try {
      const el = page.locator(options.selector).first();

      if (options.clear !== false) {
        await el.fill('');
      }

      if (options.delay) {
        await el.pressSequentially(options.text, { delay: options.delay });
      } else {
        await el.fill(options.text);
      }

      return {
        success: true,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
    }
  }

  async scroll(options: ScrollOptions): Promise<ActionResult> {
    const start = Date.now();
    const page = await this.ensurePage();

    try {
      const amount = options.amount ?? 300;
      const direction = options.direction ?? 'down';
      const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
      const deltaY = direction === 'up' ? -amount : direction === 'down' ? amount : 0;

      if (options.selector) {
        await page.locator(options.selector).first().evaluate(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (el: any, args: any) => el.scrollBy(args[0], args[1]),
          [deltaX, deltaY],
        );
      } else {
        await page.mouse.wheel(deltaX, deltaY);
      }

      return {
        success: true,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
    }
  }

  async hover(options: HoverOptions): Promise<ActionResult> {
    const start = Date.now();
    const page = await this.ensurePage();

    try {
      await page.locator(options.selector).first().hover();
      return {
        success: true,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
    }
  }

  async select(options: SelectOptions): Promise<ActionResult> {
    const start = Date.now();
    const page = await this.ensurePage();

    try {
      await page.locator(options.selector).first().selectOption(options.values);
      return {
        success: true,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
    }
  }

  // ─── Wait ───────────────────────────────────────────────────────────────

  async wait(condition: WaitCondition, timeoutMs?: number): Promise<WaitResult> {
    const start = Date.now();
    const timeout = timeoutMs ?? this.config.defaultWaitTimeoutMs;
    const page = await this.ensurePage();

    try {
      switch (condition.type) {
        case 'selector': {
          await page.locator(condition.selector).first().waitFor({ state: 'visible', timeout });
          return { success: true, durationMs: Date.now() - start, conditionType: condition.type };
        }
        case 'url': {
          await page.waitForURL(condition.urlPattern, { timeout });
          return { success: true, durationMs: Date.now() - start, conditionType: condition.type };
        }
        case 'navigation': {
          await page.waitForURL('**', { timeout });
          return { success: true, durationMs: Date.now() - start, conditionType: condition.type };
        }
        case 'text': {
          const sel = condition.selector ?? 'body';
          await page.locator(sel).first().waitFor({ state: 'visible', timeout });
          const text = await page.locator(sel).first().textContent({ timeout });
          if (text?.toLowerCase().includes(condition.text.toLowerCase())) {
            return { success: true, durationMs: Date.now() - start, conditionType: condition.type };
          }
          return { success: false, durationMs: Date.now() - start, conditionType: condition.type };
        }
        case 'networkIdle': {
          await page.waitForLoadState('networkidle', { timeout });
          return { success: true, durationMs: Date.now() - start, conditionType: condition.type };
        }
        case 'visible': {
          await page.locator(condition.selector).first().waitFor({ state: 'visible', timeout });
          return { success: true, durationMs: Date.now() - start, conditionType: condition.type };
        }
        case 'hidden': {
          await page.locator(condition.selector).first().waitFor({ state: 'hidden', timeout });
          return { success: true, durationMs: Date.now() - start, conditionType: condition.type };
        }
        case 'timeout': {
          await page.waitForTimeout(condition.ms);
          return { success: true, durationMs: Date.now() - start, conditionType: condition.type };
        }
      }
    } catch {
      return { success: false, durationMs: Date.now() - start, conditionType: condition.type };
    }
  }

  // ─── Advanced Capabilities ───────────────────────────────────────────────

  async authenticate(options: AuthOptions): Promise<AuthResult> {
    const start = Date.now();
    const page = await this.ensurePage();
    const timeout = options.timeoutMs ?? 15_000;

    try {
      // Set cookies if provided
      if (options.cookies && this._context) {
        const cookies = Object.entries(options.cookies).map(([name, value]) => ({
          name,
          value,
          domain: new URL(options.loginUrl).hostname,
          path: '/',
        }));
        await this._context.addCookies(cookies);
      }

      // Navigate to login page
      await page.goto(options.loginUrl, { timeout, waitUntil: 'networkidle' });

      // Fill username
      await page.locator(options.usernameSelector).first().fill(options.username);

      // Fill password
      await page.locator(options.passwordSelector).first().fill(options.password);

      // Fill extra fields
      if (options.extraFields) {
        for (const [selector, value] of Object.entries(options.extraFields)) {
          await page.locator(selector).first().fill(value);
        }
      }

      // Click submit
      if (options.submitSelector) {
        await page.locator(options.submitSelector).first().click();
      } else {
        // Try to find a submit button
        const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
        await submitBtn.click();
      }

      // Wait for navigation or success indicator
      if (options.successSelector) {
        await page.locator(options.successSelector).first().waitFor({ state: 'visible', timeout });
      } else {
        await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
      }

      // Extract cookies
      let cookies: Record<string, string> = {};
      if (this._context) {
        const contextCookies = await this._context.cookies();
        cookies = Object.fromEntries(contextCookies.map((c: any) => [c.name, c.value]));
      }

      // Extract storage state
      let storageState: string | undefined;
      if (this._context) {
        const state = await this._context.storageState();
        storageState = JSON.stringify(state);
      }

      this._currentUrl = page.url();
      this._currentTitle = await page.title();

      return {
        success: true,
        cookies,
        storageState,
        finalUrl: this._currentUrl,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        cookies: {},
        finalUrl: page.url(),
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
    }
  }

  async download(url: string, options?: DownloadOptions): Promise<DownloadResult> {
    const start = Date.now();
    const page = await this.ensurePage();
    const timeout = options?.timeoutMs ?? 60_000;

    try {
      const downloadDir = options?.downloadDir;

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout }),
        page.goto(url, { timeout, waitUntil: 'commit' }),
      ]);

      const filename = download.suggestedFilename();
      const filePath = await download.path();

      // If a download directory is specified, save the file there
      if (downloadDir && filePath) {
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const destPath = path.join(downloadDir, options?.suggestedFilename ?? filename);
        await fs.mkdir(downloadDir, { recursive: true });
        await fs.copyFile(filePath, destPath);
      }

      // Get file size if possible
      let sizeBytes: number | undefined;
      if (filePath) {
        try {
          const fs = await import('node:fs/promises');
          const stat = await fs.stat(filePath);
          sizeBytes = stat.size;
        } catch {
          sizeBytes = undefined;
        }
      }

      return {
        success: true,
        filePath: filePath ?? undefined,
        filename: filename || undefined,
        sizeBytes,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
    }
  }

  async interceptNetwork(pattern: NetworkPattern, handler: NetworkHandler): Promise<string> {
    const page = await this.ensurePage();
    const interceptionId = `int-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const urlMatch = (url: string) => {
      switch (pattern.type) {
        case 'url':
          return url.includes(pattern.pattern);
        case 'method':
          return true; // Method matching is done in the handler
        case 'resourceType':
          return true; // Resource type matching is done by Playwright
        default:
          return true;
      }
    };

    await page.route('**/*', async (route: any) => {
      const request = route.request();
      const reqUrl = request.url();
      const reqMethod = request.method();

      // Check pattern match
      let matches = false;
      switch (pattern.type) {
        case 'url':
          matches = reqUrl.includes(pattern.pattern);
          break;
        case 'method':
          matches = reqMethod === pattern.method.toUpperCase();
          break;
        case 'resourceType':
          matches = request.resourceType() === pattern.resourceType;
          break;
      }

      if (!matches) {
        await route.continue();
        return;
      }

      // Apply action
      switch (handler.action.type) {
        case 'block':
          await route.abort();
          break;
        case 'mock':
          await route.fulfill({
            status: handler.action.status,
            body: handler.action.body ?? '',
            headers: handler.action.headers ?? {},
          });
          break;
        case 'modify':
          await route.continue({
            headers: handler.action.headers,
            postData: handler.action.body,
          });
          break;
        case 'log':
          await route.continue();
          break;
      }
    });

    // Store the interception ID for later removal
    // We track route handlers internally for cleanup
    this._interceptions.set(interceptionId, { pattern, handler });
    return interceptionId;
  }

  async clearInterception(interceptionId: string): Promise<void> {
    const interception = this._interceptions.get(interceptionId);
    if (!interception) {
      throw new Error(`${BROWSER_ERRORS.INTERCEPTION_NOT_FOUND}: No interception found with id ${interceptionId}`);
    }
    this._interceptions.delete(interceptionId);

    // Unroute all handlers (Playwright doesn't support removing individual routes)
    const page = await this.ensurePage();
    await page.unroute('**/*');
  }

  async handleDialog(action: DialogAction): Promise<ActionResult> {
    const start = Date.now();
    const page = await this.ensurePage();

    try {
      // Set up a one-time dialog handler
      page.once('dialog', async (dialog: any) => {
        if (action.action === 'accept') {
          await dialog.accept(action.inputText);
        } else {
          await dialog.dismiss();
        }
      });

      return {
        success: true,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
    }
  }

  async setGeolocation(options: GeolocationOptions): Promise<ActionResult> {
    const start = Date.now();

    try {
      const context = await this.ensureContext();
      await context.setGeolocation({
        latitude: options.latitude,
        longitude: options.longitude,
        accuracy: options.accuracy,
      });

      // Grant geolocation permissions
      await context.grantPermissions(['geolocation']);

      return {
        success: true,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
    }
  }

  async setTimezone(timezone: string): Promise<ActionResult> {
    const start = Date.now();

    try {
      // Timezone must be set at context creation, so we need to recreate
      // the context with the new timezone
      if (this._context) {
        await this._context.close();
      }

      const browser = await this.ensureBrowser();
      const pw = await this.ensurePlaywright();
      const browserType = pw[this.config.browserType];

      this._context = await browser.newContext({
        timezoneId: timezone,
        viewport: { width: 1280, height: 720 },
        userAgent: 'AgentOS-Browser/1.0 (Playwright)',
      });

      // Create a new page in the new context
      this._page = await this._context.newPage();
      this._page.setDefaultTimeout(this.config.defaultTimeoutMs);
      this._page.setDefaultNavigationTimeout(this.config.defaultTimeoutMs);

      return {
        success: true,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
    }
  }

  async switchToFrame(selector: string): Promise<ActionResult> {
    const start = Date.now();
    const page = await this.ensurePage();

    try {
      // Store the main frame for later restoration
      this._mainFrame = this._currentFrame;
      this._currentFrame = page.frameLocator(selector).first();

      return {
        success: true,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
    }
  }

  async switchToMainFrame(): Promise<ActionResult> {
    this._currentFrame = null;
    return {
      success: true,
      durationMs: 0,
    };
  }

  async listTabs(): Promise<TabInfo[]> {
    const context = await this.ensureContext();
    const pages = context.pages();

    return pages.map((page: any, index: number) => ({
      tabId: String(index),
      url: page.url(),
      title: page.title().catch(() : string => ''),
      active: !page.isClosed(),
    }));
  }

  async switchTab(tabId: string): Promise<ActionResult> {
    const start = Date.now();
    const context = await this.ensureContext();
    const pages = context.pages();
    const index = parseInt(tabId, 10);

    if (isNaN(index) || index < 0 || index >= pages.length) {
      return {
        success: false,
        error: `${BROWSER_ERRORS.TAB_NOT_FOUND}: Tab ${tabId} not found`,
        durationMs: Date.now() - start,
      };
    }

    this._page = pages[index]!;
    this._page.setDefaultTimeout(this.config.defaultTimeoutMs);
    this._page.setDefaultNavigationTimeout(this.config.defaultTimeoutMs);
    this._currentUrl = this._page.url();
    this._currentTitle = await this._page.title().catch((): string => '');

    return {
      success: true,
      url: this._currentUrl,
      durationMs: Date.now() - start,
    };
  }

  async closeTab(tabId: string): Promise<ActionResult> {
    const start = Date.now();
    const context = await this.ensureContext();
    const pages = context.pages();
    const index = parseInt(tabId, 10);

    if (isNaN(index) || index < 0 || index >= pages.length) {
      return {
        success: false,
        error: `${BROWSER_ERRORS.TAB_NOT_FOUND}: Tab ${tabId} not found`,
        durationMs: Date.now() - start,
      };
    }

    // Don't close the last tab
    if (pages.length <= 1) {
      return {
        success: false,
        error: `${BROWSER_ERRORS.TAB_FAILED}: Cannot close the last tab`,
        durationMs: Date.now() - start,
      };
    }

    const closing = pages[index]!;
    const isActive = this._page === closing;
    await closing.close();

    // If we closed the active tab, switch to the first remaining tab
    if (isActive) {
      const remaining = context.pages();
      this._page = remaining[0]!;
      this._currentUrl = this._page.url();
      this._currentTitle = await this._page.title().catch((): string => '');
    }

    return {
      success: true,
      durationMs: Date.now() - start,
    };
  }

  async dragDrop(options: DragDropOptions): Promise<ActionResult> {
    const start = Date.now();
    const page = await this.ensurePage();

    try {
      const fromEl = page.locator(options.fromSelector).first();
      const toEl = page.locator(options.toSelector).first();

      // Ensure both elements are visible
      await fromEl.waitFor({ state: 'visible', timeout: this.config.defaultTimeoutMs });
      await toEl.waitFor({ state: 'visible', timeout: this.config.defaultTimeoutMs });

      // Use Playwright's dragAndDrop
      await page.dragAndDrop(options.fromSelector, options.toSelector, {
        delay: options.delayMs,
      });

      return {
        success: true,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
    }
  }

  async fileUpload(options: FileUploadOptions): Promise<ActionResult> {
    const start = Date.now();
    const page = await this.ensurePage();

    try {
      const input = page.locator(options.selector).first();
      await input.setInputFiles(options.files);

      return {
        success: true,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - start,
      };
    }
  }

  // ─── State ──────────────────────────────────────────────────────────────

  currentUrl(): string {
    return this._currentUrl;
  }

  currentTitle(): string {
    return this._currentTitle;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────

  async close(): Promise<void> {
    try {
      if (this._page && !this._page.isClosed()) {
        await this._page.close();
      }
      if (this._context) {
        await this._context.close();
      }
      if (this._browser && this._browser.isConnected()) {
        await this._browser.close();
      }
    } catch {
      // Best-effort close
    } finally {
      this._page = null;
      this._context = null;
      this._browser = null;
      this._currentUrl = '';
      this._currentTitle = '';
      this._interceptions.clear();
      this._currentFrame = null;
      this._mainFrame = null;
    }
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async extractElement(el: any, properties: string[]): Promise<ExtractedElement> {
    const result: ExtractedElement = {};

    for (const prop of properties) {
      switch (prop) {
        case 'text': {
          result.text = (await el.textContent().catch(() : string => ''))?.trim() ?? '';
          break;
        }
        case 'html': {
          result.html = await el.evaluate((e: Element) => e.innerHTML).catch(() => '');
          break;
        }
        case 'attributes': {
          const attrs = await el.evaluate((e: Element) => {
            const res: Record<string, string> = {};
            for (const attr of Array.from(e.attributes)) {
              res[attr.name] = attr.value;
            }
            return res;
          }).catch(() => ({} as Record<string, string>));
          result.attributes = attrs;
          break;
        }
        case 'href': {
          const href = await el.getAttribute('href').catch(() : string | null => null);
          result.attributes = { ...result.attributes, href: href ?? '' };
          break;
        }
        case 'src': {
          const src = await el.getAttribute('src').catch(() : string | null => null);
          result.attributes = { ...result.attributes, src: src ?? '' };
          break;
        }
        case 'value': {
          const value = await el.getAttribute('value').catch(() : string | null => null);
          result.attributes = { ...result.attributes, value: value ?? '' };
          break;
        }
      }
    }

    // Default to text if no properties specified
    if (properties.length === 0 || (properties.length === 1 && properties[0] === 'text')) {
      result.text = (await el.textContent().catch(() : string => ''))?.trim() ?? '';
    }

    return result;
  }
}

/**
 * Detect whether Playwright is available for import.
 * Returns true if playwright-core can be imported, false otherwise.
 */
export async function isPlaywrightAvailable(): Promise<boolean> {
  try {
    await import('playwright-core');
    return true;
  } catch {
    return false;
  }
}

/**
 * Create the best available browser strategy.
 * If Playwright is installed, returns PlaywrightStrategy.
 * Otherwise, returns HTTPStrategy.
 */
export async function createBestStrategy(
  playwrightConfig?: PlaywrightStrategyConfig,
  httpConfig?: import('../strategies/http-strategy.js').HttpStrategyConfig,
): Promise<IBrowserStrategy> {
  if (await isPlaywrightAvailable()) {
    return new PlaywrightStrategy(playwrightConfig);
  }
  const { HTTPStrategy } = await import('../strategies/http-strategy.js');
  return new HTTPStrategy(httpConfig);
}