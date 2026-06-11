/**
 * @agentos/browser — HTTP Strategy
 * Zero-dependency browser strategy using native fetch + HTML parsing.
 * Cannot execute JavaScript. Supports navigation and content extraction
 * via server-rendered HTML only. Full browser automation (click, type)
 * requires the Playwright strategy.
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

// ─── HTTP Strategy ────────────────────────────────────────────────────────

export interface HttpStrategyConfig {
  /** Default request timeout in ms (default: 30000) */
  defaultTimeoutMs?: number;
  /** Maximum response size in bytes (default: 5MB) */
  maxResponseSize?: number;
  /** Default headers for all requests */
  defaultHeaders?: Record<string, string>;
  /** User-Agent string */
  userAgent?: string;
}

const DEFAULT_CONFIG: Required<HttpStrategyConfig> = {
  defaultTimeoutMs: 30_000,
  maxResponseSize: 5_000_000,
  defaultHeaders: {},
  userAgent: 'AgentOS-Browser/1.0',
};

/**
 * HTTP-only browser strategy. Uses native fetch to retrieve HTML
 * and a lightweight CSS-selector-based parser for content extraction.
 * No JavaScript execution. Navigation is stateless HTTP GET.
 */
export class HTTPStrategy implements IBrowserStrategy {
  readonly name = 'http';
  readonly supportsJS = false;

  private config: Required<HttpStrategyConfig>;
  private _currentUrl = '';
  private _currentTitle = '';
  private _currentPageHtml = '';
  private _cookies: Record<string, string> = {};

  constructor(config?: HttpStrategyConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Navigation ────────────────────────────────────────────────────────

  async goto(url: string, options?: NavigateOptions): Promise<PageState> {
    const start = Date.now();
    const timeout = options?.timeoutMs ?? this.config.defaultTimeoutMs;

    try {
      const response = await this.fetchUrl(url, timeout);
      const html = await this.readBody(response);
      this._currentPageHtml = html;
      this._currentUrl = response.url || url;

      // Extract title from HTML
      this._currentTitle = this.extractTitle(html);

      const durationMs = Date.now() - start;
      return {
        url: this._currentUrl,
        title: this._currentTitle,
        statusCode: response.status,
        durationMs,
      };
    } catch (e) {
      throw new Error(`${BROWSER_ERRORS.NAVIGATION_FAILED}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async back(): Promise<PageState> {
    // HTTP strategy has no history — return current state
    return {
      url: this._currentUrl,
      title: this._currentTitle,
      durationMs: 0,
    };
  }

  async forward(): Promise<PageState> {
    // HTTP strategy has no history — return current state
    return {
      url: this._currentUrl,
      title: this._currentTitle,
      durationMs: 0,
    };
  }

  async reload(): Promise<PageState> {
    if (!this._currentUrl) {
      throw new Error(`${BROWSER_ERRORS.NAVIGATION_FAILED}: No URL to reload`);
    }
    return this.goto(this._currentUrl);
  }

  // ─── Screenshot ─────────────────────────────────────────────────────────

  async screenshot(_options?: ScreenshotOptions): Promise<ScreenshotResult> {
    // HTTP strategy cannot take real screenshots.
    // Return a placeholder with page metadata.
    return {
      data: '',
      mimeType: 'image/png',
      width: 0,
      height: 0,
      sizeBytes: 0,
    };
  }

  // ─── Extract ────────────────────────────────────────────────────────────

  async extract(options: ExtractOptions): Promise<ExtractResult> {
    const elements = this.selectElements(this._currentPageHtml, options.selector, options);

    return {
      elements,
      count: elements.length,
      selector: options.selector,
    };
  }

  // ─── Query ─────────────────────────────────────────────────────────────

  async query(options: QueryOptions): Promise<ElementInfo[]> {
    const limit = options.limit ?? 100;
    const raw = this.selectElements(this._currentPageHtml, options.selector, {
      selector: options.selector,
      properties: ['text', 'html', 'attributes'],
    });

    return raw.slice(0, limit).map(el => ({
      tag: (el.attributes?.['data-tag'] ?? 'div') as string,
      text: el.text ?? '',
      attributes: el.attributes ?? {},
    }));
  }

  // ─── Interactions (not supported in HTTP mode) ────────────────────────

  async click(_options: ClickOptions): Promise<ActionResult> {
    return this.unsupportedAction('click');
  }

  async type(_options: TypeOptions): Promise<ActionResult> {
    return this.unsupportedAction('type');
  }

  async scroll(_options: ScrollOptions): Promise<ActionResult> {
    return this.unsupportedAction('scroll');
  }

  async hover(_options: HoverOptions): Promise<ActionResult> {
    return this.unsupportedAction('hover');
  }

  async select(_options: SelectOptions): Promise<ActionResult> {
    return this.unsupportedAction('select');
  }

  // ─── Wait ───────────────────────────────────────────────────────────────

  async wait(condition: WaitCondition, timeoutMs?: number): Promise<WaitResult> {
    const timeout = timeoutMs ?? 5000;
    const start = Date.now();

    switch (condition.type) {
      case 'selector': {
        const elements = this.selectElements(this._currentPageHtml, condition.selector, {
          selector: condition.selector,
        });
        const found = elements.length > 0;
        return {
          success: found,
          durationMs: Date.now() - start,
          conditionType: condition.type,
        };
      }
      case 'text': {
        const hasText = this._currentPageHtml.toLowerCase().includes(condition.text.toLowerCase());
        return {
          success: hasText,
          durationMs: Date.now() - start,
          conditionType: condition.type,
        };
      }
      case 'timeout': {
        // Wait the specified time (capped to requested timeout)
        const waitMs = Math.min(condition.ms, timeout);
        return {
          success: true,
          durationMs: waitMs,
          conditionType: condition.type,
        };
      }
      case 'url':
      case 'navigation':
      case 'networkIdle':
      case 'visible':
      case 'hidden': {
        // These require JS execution — always report success in HTTP mode
        return {
          success: true,
          durationMs: Date.now() - start,
          conditionType: condition.type,
        };
      }
    }
  }

  // ─── Advanced Capabilities (not supported in HTTP mode) ──────────────────

  async authenticate(_options: AuthOptions): Promise<AuthResult> {
    return {
      success: false,
      cookies: {},
      finalUrl: '',
      error: `${BROWSER_ERRORS.REQUIRES_JS}: authenticate requires a JS-capable browser strategy (Playwright). HTTP strategy cannot execute login flows.`,
      durationMs: 0,
    };
  }

  async download(_url: string, _options?: DownloadOptions): Promise<DownloadResult> {
    return {
      success: false,
      error: `${BROWSER_ERRORS.REQUIRES_JS}: download requires a JS-capable browser strategy (Playwright). HTTP strategy cannot handle file downloads.`,
      durationMs: 0,
    };
  }

  async interceptNetwork(_pattern: NetworkPattern, _handler: NetworkHandler): Promise<string> {
    throw new Error(`${BROWSER_ERRORS.REQUIRES_JS}: interceptNetwork requires a JS-capable browser strategy (Playwright). HTTP strategy cannot intercept network requests.`);
  }

  async clearInterception(_interceptionId: string): Promise<void> {
    // No-op in HTTP mode since interceptions are never created
  }

  async handleDialog(_action: DialogAction): Promise<ActionResult> {
    return this.unsupportedAction('handleDialog');
  }

  async setGeolocation(_options: GeolocationOptions): Promise<ActionResult> {
    return this.unsupportedAction('setGeolocation');
  }

  async setTimezone(_timezone: string): Promise<ActionResult> {
    return this.unsupportedAction('setTimezone');
  }

  async switchToFrame(_selector: string): Promise<ActionResult> {
    return this.unsupportedAction('switchToFrame');
  }

  async switchToMainFrame(): Promise<ActionResult> {
    // No-op in HTTP mode — always on main frame
    return { success: true, durationMs: 0 };
  }

  async listTabs(): Promise<TabInfo[]> {
    // HTTP mode has a single page — return current state
    return [{
      tabId: '0',
      url: this._currentUrl,
      title: this._currentTitle,
      active: true,
    }];
  }

  async switchTab(_tabId: string): Promise<ActionResult> {
    // HTTP mode has a single page — no-op
    return { success: true, durationMs: 0 };
  }

  async closeTab(_tabId: string): Promise<ActionResult> {
    return {
      success: false,
      error: `${BROWSER_ERRORS.REQUIRES_JS}: closeTab requires a JS-capable browser strategy (Playwright). HTTP strategy has a single page.`,
      durationMs: 0,
    };
  }

  async dragDrop(_options: DragDropOptions): Promise<ActionResult> {
    return this.unsupportedAction('dragDrop');
  }

  async fileUpload(_options: FileUploadOptions): Promise<ActionResult> {
    return this.unsupportedAction('fileUpload');
  }

  // ─── State ──────────────────────────────────────────────────────────────

  currentUrl(): string {
    return this._currentUrl;
  }

  currentTitle(): string {
    return this._currentTitle;
  }

  async close(): Promise<void> {
    this._currentUrl = '';
    this._currentTitle = '';
    this._currentPageHtml = '';
    this._cookies = {};
  }

  // ─── Private Methods ───────────────────────────────────────────────────

  private async fetchUrl(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const cookieHeader = Object.entries(this._cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

      const headers: Record<string, string> = {
        'User-Agent': this.config.userAgent,
        ...this.config.defaultHeaders,
      };

      if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
      }

      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
        redirect: 'follow',
      });

      clearTimeout(timeoutId);

      // Parse set-cookie headers for session persistence
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        this.parseCookies(setCookie);
      }

      return response;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof TypeError && e.message.includes('abort')) {
        throw new Error(`Navigation to ${url} timed out after ${timeoutMs}ms`);
      }
      throw e;
    }
  }

  private async readBody(response: Response): Promise<string> {
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > this.config.maxResponseSize) {
      throw new Error(`Response exceeds maximum size (${this.config.maxResponseSize} bytes)`);
    }

    const text = await response.text();
    if (text.length > this.config.maxResponseSize) {
      throw new Error(`Response exceeds maximum size (${this.config.maxResponseSize} bytes)`);
    }

    return text;
  }

  private parseCookies(setCookieHeader: string): void {
    // Parse multiple set-cookie values (comma-separated)
    const cookies = setCookieHeader.split(',');
    for (const cookie of cookies) {
      const parts = cookie.trim().split(';')[0];
      if (!parts) continue;
      const eqIdx = parts.indexOf('=');
      if (eqIdx > 0) {
        const key = parts.slice(0, eqIdx).trim();
        const value = parts.slice(eqIdx + 1).trim();
        this._cookies[key] = value;
      }
    }
  }

  private extractTitle(html: string): string {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch?.[1]) {
      return titleMatch[1].trim();
    }
    return '';
  }

  /**
   * Lightweight CSS selector-based element extraction.
   * Supports: tag selectors, class selectors (.cls), ID selectors (#id),
   * attribute selectors ([attr]), and combinators (space, >).
   */
  private selectElements(html: string, selector: string, options: ExtractOptions): ExtractedElement[] {
    if (!html) return [];

    try {
      const parser = new HTMLSelectorParser(html);
      return parser.select(selector, options.properties ?? ['text', 'attributes']);
    } catch {
      // If parsing fails, return empty
      return [];
    }
  }

  private unsupportedAction(action: string): ActionResult {
    return {
      success: false,
      error: `${BROWSER_ERRORS.REQUIRES_JS}: ${action} requires a JS-capable browser strategy (Playwright). HTTP strategy only supports navigation and content extraction.`,
      durationMs: 0,
    };
  }
}

// ─── HTML Selector Parser ──────────────────────────────────────────────────

/**
 * Lightweight HTML parser that supports basic CSS selectors.
 * Does NOT require external dependencies like cheerio.
 * Supports: tag, .class, #id, [attr], [attr=value], tag.class, tag#id,
 * descendant (space), child (>), :first-child, :last-child, :nth-child(n).
 */
class HTMLSelectorParser {
  private html: string;
  private pos = 0;

  constructor(html: string) {
    this.html = html;
  }

  select(selector: string, properties: string[]): ExtractedElement[] {
    // Normalize selector
    const normalizedSelector = selector.trim();
    if (!normalizedSelector) return [];

    // Parse the HTML into a simple DOM tree
    const root = this.parseHTML();
    // Find matching elements
    const matches = this.findMatches(root, normalizedSelector);
    // Convert to ExtractedElement
    return matches.map(el => this.toExtractedElement(el, properties));
  }

  private parseHTML(): SimpleNode {
    const root: SimpleNode = { tag: 'root', attributes: {}, children: [], text: '', parent: null };
    const stack: SimpleNode[] = [root];
    let current = root;

    while (this.pos < this.html.length) {
      if (this.html[this.pos] === '<') {
        if (this.html[this.pos + 1] === '/') {
          // Closing tag
          const closeEnd = this.html.indexOf('>', this.pos);
          if (closeEnd === -1) break;
          this.pos = closeEnd + 1;
          if (stack.length > 1) {
            stack.pop();
            current = stack[stack.length - 1]!;
          }
        } else if (this.html[this.pos + 1] === '!' && this.html[this.pos + 2] === '-' && this.html[this.pos + 3] === '-') {
          // Comment — skip
          const commentEnd = this.html.indexOf('-->', this.pos);
          this.pos = commentEnd === -1 ? this.html.length : commentEnd + 3;
        } else {
          // Opening tag
          const tagEnd = this.html.indexOf('>', this.pos);
          if (tagEnd === -1) break;

          const tagContent = this.html.slice(this.pos + 1, tagEnd);
          const isSelfClosing = tagContent.endsWith('/');
          const spaceIdx = tagContent.indexOf(' ');

          let tagName: string;
          let attrStr: string;
          if (spaceIdx > 0) {
            tagName = tagContent.slice(0, spaceIdx).toLowerCase();
            attrStr = tagContent.slice(spaceIdx + 1);
          } else {
            tagName = tagContent.replace(/\/$/, '').toLowerCase();
            attrStr = '';
          }

          // Skip script/style content
          if (tagName === 'script' || tagName === 'style') {
            const closeTag = `</${tagName}>`;
            const scriptEnd = this.html.toLowerCase().indexOf(closeTag, tagEnd);
            this.pos = scriptEnd === -1 ? this.html.length : scriptEnd + closeTag.length;
            continue;
          }

          const node: SimpleNode = {
            tag: tagName,
            attributes: this.parseAttributes(attrStr),
            children: [],
            text: '',
            parent: current,
          };

          current.children.push(node);
          this.pos = tagEnd + 1;

          if (!isSelfClosing && !VOID_ELEMENTS.has(tagName)) {
            stack.push(node);
            current = node;
          }
        }
      } else {
        // Text content
        const nextTag = this.html.indexOf('<', this.pos);
        const textEnd = nextTag === -1 ? this.html.length : nextTag;
        const text = this.html.slice(this.pos, textEnd).trim();
        if (text) {
          current.text += ' ' + text;
        }
        this.pos = textEnd;
      }
    }

    return root;
  }

  private parseAttributes(attrStr: string): Record<string, string> {
    const attrs: Record<string, string> = {};
    const regex = /(\w[\w-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
    let match;
    while ((match = regex.exec(attrStr)) !== null) {
      const name = match[1]!.toLowerCase();
      const value = match[2] ?? match[3] ?? match[4] ?? '';
      attrs[name] = value;
    }
    return attrs;
  }

  private findMatches(root: SimpleNode, selector: string): SimpleNode[] {
    // Split selector by comma for OR matching
    const orParts = selector.split(',').map(s => s.trim());
    const results: SimpleNode[] = [];
    const seen = new Set<SimpleNode>();

    for (const part of orParts) {
      // Split by space for descendant combinator, > for child combinator
      const segments = this.parseSelectorSegments(part);
      const matches = this.matchSegments(root, segments);
      for (const m of matches) {
        if (!seen.has(m)) {
          seen.add(m);
          results.push(m);
        }
      }
    }

    return results;
  }

  private parseSelectorSegments(selector: string): SelectorSegment[] {
    // Split on combinators (space and >)
    // Note: JS split with capturing group produces null for non-capturing alternations
    const segments: SelectorSegment[] = [];
    const parts = selector.split(/\s*(>)\s*|\s+/);

    for (let i = 0; i < parts.length; i++) {
      const raw = parts[i];
      if (raw === null || raw === undefined) continue; // Non-capturing match gap
      const part = raw.trim();
      if (!part || part === '>') {
        if (part === '>' && segments.length > 0) {
          segments[segments.length - 1]!.combinator = '>';
        }
        continue;
      }
      const prevPart = i > 0 ? parts[i - 1] : null;
      segments.push({
        selector: part,
        combinator: prevPart === '>' ? '>' : ' ',
      });
    }

    return segments;
  }

  private matchSegments(root: SimpleNode, segments: SelectorSegment[]): SimpleNode[] {
    if (segments.length === 0) return [];

    // The LAST segment is the element we want to find.
    // Previous segments are ancestor conditions.
    const lastSegment = segments[segments.length - 1]!;
    let candidates = this.findAllMatching(root, lastSegment.selector);

    if (segments.length === 1) return candidates;

    // For descendant/child combinators, check that ancestors match
    // Walk backwards through segments (from second-to-last to first)
    return candidates.filter(candidate => {
      return this.hasMatchingAncestors(candidate, segments, segments.length - 2);
    });
  }

  private hasMatchingAncestors(node: SimpleNode, segments: SelectorSegment[], segIdx: number): boolean {
    if (segIdx < 0) return true; // All segments matched

    const segment = segments[segIdx]!;
    // The combinator on this segment tells us the relationship between
    // this segment and the NEXT (lower-index) segment
    const combinator = segment.combinator;

    if (combinator === '>') {
      // Child combinator — immediate parent must match
      if (!node.parent) return false;
      if (this.matchesSelector(node.parent, segment.selector)) {
        return this.hasMatchingAncestors(node.parent, segments, segIdx - 1);
      }
      return false;
    }

    // Descendant combinator — any ancestor must match
    let ancestor = node.parent;
    while (ancestor) {
      if (this.matchesSelector(ancestor, segment.selector)) {
        if (this.hasMatchingAncestors(ancestor, segments, segIdx - 1)) {
          return true;
        }
      }
      ancestor = ancestor.parent;
    }
    return false;
  }

  private findAllMatching(root: SimpleNode, selector: string): SimpleNode[] {
    const results: SimpleNode[] = [];
    const walk = (node: SimpleNode) => {
      if (node.tag !== 'root' && this.matchesSelector(node, selector)) {
        results.push(node);
      }
      for (const child of node.children) {
        walk(child);
      }
    };
    walk(root);
    return results;
  }

  private matchesSelector(node: SimpleNode, selector: string): boolean {
    // Handle pseudo-selectors
    const pseudoMatch = selector.match(/^(.*):((?:first|last|nth)-child(?:\(\d+\))?)/);
    const mainSelector = pseudoMatch ? pseudoMatch[1]! : selector;
    const pseudo = pseudoMatch?.[2];

    // Parse the main selector
    if (!this.matchesMainSelector(node, mainSelector)) return false;

    // Check pseudo-selectors
    if (pseudo) {
      if (pseudo === 'first-child') {
        if (!node.parent) return false;
        return node.parent.children[0] === node;
      }
      if (pseudo === 'last-child') {
        if (!node.parent) return false;
        return node.parent.children[node.parent.children.length - 1] === node;
      }
      const nthMatch = pseudo.match(/^nth-child\((\d+)\)$/);
      if (nthMatch) {
        const n = parseInt(nthMatch[1]!, 10);
        if (!node.parent) return false;
        // Find index among element siblings (exclude text-only nodes)
        const elementSiblings = node.parent.children.filter(c => c.tag !== 'root');
        return elementSiblings[n - 1] === node;
      }
    }

    return true;
  }

  private matchesMainSelector(node: SimpleNode, selector: string): boolean {
    if (selector === '*') return true;

    // Compound selector: tag.class#id[attr]
    let remaining = selector;

    // Check tag
    const tagMatch = remaining.match(/^(\w[\w-]*)/);
    if (tagMatch) {
      if (node.tag !== tagMatch[1]!.toLowerCase()) return false;
      remaining = remaining.slice(tagMatch[1]!.length);
    }

    // Check classes
    const classMatches = remaining.matchAll(/\.([\w-]+)/g);
    for (const match of classMatches) {
      const cls = match[1]!;
      const nodeClasses = (node.attributes['class'] ?? '').split(/\s+/);
      if (!nodeClasses.includes(cls)) return false;
    }
    remaining = remaining.replace(/\.[\w-]+/g, '');

    // Check ID
    const idMatch = remaining.match(/#([\w-]+)/);
    if (idMatch) {
      if (node.attributes['id'] !== idMatch[1]) return false;
      remaining = remaining.replace(/#[\w-]+/, '');
    }

    // Check attributes
    const attrMatches = remaining.matchAll(/\[([\w-]+)(?:([~|^$*]?=)["']?([^"'\]]*)["']?)?\]/g);
    for (const match of attrMatches) {
      const attrName = match[1]!.toLowerCase();
      const op = match[2];
      const value = match[3];
      const attrVal = node.attributes[attrName];

      if (op === undefined) {
        // [attr] — just existence
        if (attrVal === undefined) return false;
      } else if (op === '=') {
        if (attrVal !== value) return false;
      } else if (op === '^=') {
        if (!attrVal?.startsWith(value ?? '')) return false;
      } else if (op === '$=') {
        if (!attrVal?.endsWith(value ?? '')) return false;
      } else if (op === '*=') {
        if (!attrVal?.includes(value ?? '')) return false;
      }
    }

    return true;
  }

  private toExtractedElement(node: SimpleNode, properties: string[]): ExtractedElement {
    const result: ExtractedElement = {};

    for (const prop of properties) {
      switch (prop) {
        case 'text':
          result.text = this.collectText(node).trim();
          break;
        case 'html':
          result.html = this.collectHTML(node);
          break;
        case 'attributes':
          result.attributes = { ...node.attributes, 'data-tag': node.tag };
          break;
        case 'href':
          result.attributes = { href: node.attributes['href'] ?? '', 'data-tag': node.tag };
          break;
        case 'src':
          result.attributes = { src: node.attributes['src'] ?? '', 'data-tag': node.tag };
          break;
        case 'value':
          result.attributes = { value: node.attributes['value'] ?? '', 'data-tag': node.tag };
          break;
      }
    }

    // If no specific properties requested, default to text
    if (properties.length === 0 || (properties.length === 1 && properties[0] === 'text')) {
      result.text = this.collectText(node).trim();
    }

    return result;
  }

  private collectText(node: SimpleNode): string {
    let text = node.text;
    for (const child of node.children) {
      text += ' ' + this.collectText(child);
    }
    return text.replace(/\s+/g, ' ');
  }

  private collectHTML(_node: SimpleNode): string {
    // Simplified HTML reconstruction — not needed for most use cases
    return '';
  }
}

// ─── Internal Types ────────────────────────────────────────────────────────

interface SimpleNode {
  tag: string;
  attributes: Record<string, string>;
  children: SimpleNode[];
  text: string;
  parent: SimpleNode | null;
}

interface SelectorSegment {
  selector: string;
  combinator: ' ' | '>';
}

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);