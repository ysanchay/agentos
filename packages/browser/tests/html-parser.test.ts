/**
 * @agentos/browser — HTML Parser Tests
 * Tests the internal HTML selector parser through the HTTP strategy.
 * Uses a technique: navigate to a data URL or mock fetch to feed HTML
 * to the parser, then test extraction/query/wait operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HTTPStrategy } from '../src/strategies/http-strategy.js';

// ─── Mock fetch for controlled HTML content ────────────────────────────────

let mockFetchResponse: { status: number; url: string; headers: Record<string, string>; body: string } | null = null;

function mockFetch(url: string, options?: RequestInit): Promise<Response> {
  if (!mockFetchResponse) {
    return Promise.resolve(new Response('Not found', { status: 404, statusText: 'Not Found' }));
  }

  const resp = mockFetchResponse;
  return Promise.resolve(new Response(resp.body, {
    status: resp.status,
    statusText: 'OK',
    headers: new Headers(resp.headers),
  }));
}

// Store original fetch
const originalFetch = globalThis.fetch;

describe('HTTPStrategy - HTML Parser', () => {
  let strategy: HTTPStrategy;

  beforeEach(() => {
    strategy = new HTTPStrategy();
    // @ts-ignore - override fetch for testing
    globalThis.fetch = mockFetch;
    mockFetchResponse = null;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // ─── Navigation ────────────────────────────────────────────────────────

  it('should navigate and extract title', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: { 'content-type': 'text/html' },
      body: '<html><head><title>Test Page</title></head><body><h1>Hello</h1></body></html>',
    };

    const state = await strategy.goto('https://example.com');
    expect(state.url).toBe('https://example.com');
    expect(state.title).toBe('Test Page');
    expect(state.statusCode).toBe(200);
  });

  // ─── Tag Selectors ──────────────────────────────────────────────────────

  it('should extract by tag selector', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><h1>Title</h1><p>Paragraph 1</p><p>Paragraph 2</p></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: 'p' });
    expect(result.count).toBe(2);
    expect(result.elements[0]!.text).toContain('Paragraph 1');
    expect(result.elements[1]!.text).toContain('Paragraph 2');
  });

  it('should extract h1 tag', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><h1>Main Title</h1></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: 'h1' });
    expect(result.count).toBe(1);
    expect(result.elements[0]!.text).toContain('Main Title');
  });

  // ─── Class Selectors ────────────────────────────────────────────────────

  it('should extract by class selector', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><div class="card">Card 1</div><div class="card">Card 2</div><div class="other">Other</div></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: '.card' });
    expect(result.count).toBe(2);
    expect(result.elements[0]!.text).toContain('Card 1');
    expect(result.elements[1]!.text).toContain('Card 2');
  });

  it('should extract by tag.class selector', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><span class="badge">Badge</span><div class="badge">Div Badge</div></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: 'span.badge' });
    expect(result.count).toBe(1);
    expect(result.elements[0]!.text).toContain('Badge');
  });

  // ─── ID Selectors ───────────────────────────────────────────────────────

  it('should extract by ID selector', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><div id="main">Main Content</div><div id="sidebar">Sidebar</div></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: '#main' });
    expect(result.count).toBe(1);
    expect(result.elements[0]!.text).toContain('Main Content');
  });

  // ─── Attribute Selectors ────────────────────────────────────────────────

  it('should extract by attribute selector', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><a href="https://link1.com">Link 1</a><a href="https://link2.com">Link 2</a><span>No link</span></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: '[href]' });
    expect(result.count).toBe(2);
  });

  it('should extract by attribute=value selector', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><input type="text" /><input type="submit" /></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: '[type="text"]' });
    expect(result.count).toBe(1);
  });

  // ─── Descendant Selectors ───────────────────────────────────────────────

  it('should extract by descendant selector', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><div class="container"><p>Inside</p></div><p>Outside</p></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: 'div p' });
    expect(result.count).toBe(1);
    expect(result.elements[0]!.text).toContain('Inside');
  });

  // ─── Wildcard Selector ──────────────────────────────────────────────────

  it('should extract with wildcard selector', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><div>A</div><span>B</span><p>C</p></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: '*' });
    // Should find all elements (html, body, div, span, p + potentially more)
    expect(result.count).toBeGreaterThanOrEqual(3);
  });

  // ─── Query ──────────────────────────────────────────────────────────────

  it('should query elements with tag info', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><a href="/home">Home</a><a href="/about">About</a></body></html>',
    };
    await strategy.goto('https://example.com');

    const results = await strategy.query({ selector: 'a' });
    expect(results).toHaveLength(2);
    expect(results[0]!.tag).toBe('a');
    expect(results[0]!.text).toContain('Home');
    expect(results[0]!.attributes['href']).toBe('/home');
  });

  it('should respect query limit', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><p>1</p><p>2</p><p>3</p><p>4</p><p>5</p></body></html>',
    };
    await strategy.goto('https://example.com');

    const results = await strategy.query({ selector: 'p', limit: 2 });
    expect(results).toHaveLength(2);
  });

  // ─── Wait Conditions ────────────────────────────────────────────────────

  it('should find selector that exists', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><h1 class="title">Title</h1></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.wait({ type: 'selector', selector: 'h1.title' });
    expect(result.success).toBe(true);
  });

  it('should not find selector that does not exist', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><h1>Title</h1></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.wait({ type: 'selector', selector: '.nonexistent' });
    expect(result.success).toBe(false);
  });

  it('should find text in page', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><p>Welcome to our website</p></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.wait({ type: 'text', text: 'Welcome' });
    expect(result.success).toBe(true);
  });

  // ─── Extract Properties ─────────────────────────────────────────────────

  it('should extract href attribute', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><a href="https://link.com">Click</a></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: 'a', properties: ['text', 'href'] });
    expect(result.count).toBe(1);
    expect(result.elements[0]!.text).toContain('Click');
    expect(result.elements[0]!.attributes!['href']).toBe('https://link.com');
  });

  it('should extract text only by default', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><p>Hello World</p></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: 'p' });
    expect(result.count).toBe(1);
    expect(result.elements[0]!.text).toContain('Hello World');
  });

  // ─── Script/Style Skipping ──────────────────────────────────────────────

  it('should skip script and style content', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><head><style>body{color:red}</style></head><body><p>Visible</p><script>var x = 1;</script></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: 'p' });
    expect(result.count).toBe(1);
    expect(result.elements[0]!.text).toContain('Visible');
  });

  // ─── Nested Content ────────────────────────────────────────────────────

  it('should extract text from nested elements', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><div><p>Nested paragraph</p></div></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: 'div' });
    expect(result.count).toBe(1);
    expect(result.elements[0]!.text).toContain('Nested paragraph');
  });

  // ─── Self-Closing Tags ──────────────────────────────────────────────────

  it('should handle self-closing tags', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><img src="test.png" alt="Test" /><br/><p>After</p></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: 'img' });
    expect(result.count).toBe(1);
    expect(result.elements[0]!.attributes!['src']).toBe('test.png');
    expect(result.elements[0]!.attributes!['alt']).toBe('Test');
  });

  // ─── Reload ────────────────────────────────────────────────────────────

  it('should reload the current page', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><head><title>Reloaded</title></head><body>Content</body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.reload();
    expect(result.title).toBe('Reloaded');
    expect(result.statusCode).toBe(200);
  });

  // ─── Current State ─────────────────────────────────────────────────────

  it('should track current URL and title', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com/page',
      headers: {},
      body: '<html><head><title>Page Title</title></head><body>Content</body></html>',
    };
    await strategy.goto('https://example.com/page');

    expect(strategy.currentUrl()).toBe('https://example.com/page');
    expect(strategy.currentTitle()).toBe('Page Title');
  });

  // ─── Close ──────────────────────────────────────────────────────────────

  it('should clear state on close', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><head><title>Title</title></head><body>Content</body></html>',
    };
    await strategy.goto('https://example.com');
    expect(strategy.currentUrl()).toBeTruthy();

    await strategy.close();
    expect(strategy.currentUrl()).toBe('');
    expect(strategy.currentTitle()).toBe('');
  });

  // ─── Multiple Selectors (comma-separated) ───────────────────────────────

  it('should handle comma-separated selectors (OR)', async () => {
    mockFetchResponse = {
      status: 200,
      url: 'https://example.com',
      headers: {},
      body: '<html><body><h1>Title</h1><p>Para</p></body></html>',
    };
    await strategy.goto('https://example.com');

    const result = await strategy.extract({ selector: 'h1, p' });
    expect(result.count).toBe(2);
  });
});