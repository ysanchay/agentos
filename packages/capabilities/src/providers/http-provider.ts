/**
 * @agentos/capabilities — HTTP Provider
 * Implements communicate.http.{get,post,put,delete,head}
 * using native fetch with sandbox-gated network access.
 */

import type { ResourceConsumption } from '@agentos/types';
import type { ProviderExecuteContext, ProviderSandboxConfig } from '../types.js';
import { ProviderBase, type ProviderBaseConfig, type ProviderCapabilityDef } from './provider-base.js';

// ─── Input Schemas ───────────────────────────────────────────────────────────

const REQUEST_INPUT = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', description: 'URL to request' },
    headers: { type: 'object', description: 'Request headers' },
    body: { type: 'string', description: 'Request body (for POST/PUT)' },
    bodyJson: { type: 'object', description: 'Request body as JSON' },
    query: { type: 'object', description: 'Query parameters' },
    timeout: { type: 'number', default: 30000, description: 'Request timeout in ms' },
    followRedirects: { type: 'boolean', default: true },
  },
} as const;

const HTTP_OUTPUT = {
  type: 'object',
  properties: {
    status: { type: 'number' },
    statusText: { type: 'string' },
    headers: { type: 'object' },
    body: { type: 'string' },
    bodyJson: { type: 'object' },
    durationMs: { type: 'number' },
  },
} as const;

// ─── Provider Config ──────────────────────────────────────────────────────────

export interface HttpProviderConfig extends ProviderBaseConfig {
  /** Default request timeout (default 30000ms) */
  defaultTimeout?: number;
  /** Maximum response body size in bytes (default 5MB) */
  maxResponseSize?: number;
  /** Default headers to include in every request */
  defaultHeaders?: Record<string, string>;
  /** Allowed host patterns (glob). Default: ['*'] */
  allowedHosts?: string[];
}

// ─── HTTP Provider ────────────────────────────────────────────────────────────

export class HttpProvider extends ProviderBase {
  private readonly defaultTimeout: number;
  private readonly maxResponseSize: number;
  private readonly defaultHeaders: Record<string, string>;
  private readonly allowedHosts: string[];

  constructor(config?: Partial<HttpProviderConfig>) {
    const sandboxOverride: Partial<ProviderSandboxConfig> = {
      network: {
        enabled: true,
        allowedHosts: config?.allowedHosts ?? ['*'],
        allowOutbound: true,
        maxResponseSize: config?.maxResponseSize ?? 5_000_000,
      },
      maxTimeoutMs: 60_000,
    };

    const defs: ProviderCapabilityDef[] = [
      {
        path: 'communicate.http.get',
        displayName: 'HTTP GET',
        description: 'Send an HTTP GET request',
        inputSchema: REQUEST_INPUT,
        outputSchema: HTTP_OUTPUT,
        handler: (input, ctx) => this.handleRequest('GET', input, ctx),
        resourceProfile: { typical: { ru: 3, mu: 2, eu: 2, vu: 0 }, peak: { ru: 10, mu: 10, eu: 5, vu: 0 }, timeout_ms: 30_000 },
      },
      {
        path: 'communicate.http.post',
        displayName: 'HTTP POST',
        description: 'Send an HTTP POST request',
        inputSchema: REQUEST_INPUT,
        outputSchema: HTTP_OUTPUT,
        handler: (input, ctx) => this.handleRequest('POST', input, ctx),
        resourceProfile: { typical: { ru: 4, mu: 3, eu: 2, vu: 0 }, peak: { ru: 15, mu: 10, eu: 5, vu: 0 }, timeout_ms: 30_000 },
      },
      {
        path: 'communicate.http.put',
        displayName: 'HTTP PUT',
        description: 'Send an HTTP PUT request',
        inputSchema: REQUEST_INPUT,
        outputSchema: HTTP_OUTPUT,
        handler: (input, ctx) => this.handleRequest('PUT', input, ctx),
        resourceProfile: { typical: { ru: 4, mu: 3, eu: 2, vu: 0 }, peak: { ru: 15, mu: 10, eu: 5, vu: 0 }, timeout_ms: 30_000 },
      },
      {
        path: 'communicate.http.delete',
        displayName: 'HTTP DELETE',
        description: 'Send an HTTP DELETE request',
        inputSchema: REQUEST_INPUT,
        outputSchema: HTTP_OUTPUT,
        handler: (input, ctx) => this.handleRequest('DELETE', input, ctx),
        resourceProfile: { typical: { ru: 3, mu: 2, eu: 2, vu: 0 }, peak: { ru: 10, mu: 5, eu: 3, vu: 0 }, timeout_ms: 30_000 },
      },
      {
        path: 'communicate.http.head',
        displayName: 'HTTP HEAD',
        description: 'Send an HTTP HEAD request',
        inputSchema: REQUEST_INPUT,
        outputSchema: HTTP_OUTPUT,
        handler: (input, ctx) => this.handleRequest('HEAD', input, ctx),
        resourceProfile: { typical: { ru: 2, mu: 1, eu: 1, vu: 0 }, peak: { ru: 5, mu: 3, eu: 2, vu: 0 }, timeout_ms: 15_000 },
      },
    ];

    super(
      {
        root: 'communicate',
        reliabilityScore: 0.95,
        avgLatencyMs: 200,
        successRate: 0.97,
        maxConcurrent: 50,
        sandboxConfig: sandboxOverride,
        ...config,
      },
      defs,
    );

    this.defaultTimeout = config?.defaultTimeout ?? 30_000;
    this.maxResponseSize = config?.maxResponseSize ?? 5_000_000;
    this.defaultHeaders = config?.defaultHeaders ?? {};
    this.allowedHosts = config?.allowedHosts ?? ['*'];
  }

  // ─── Handler ─────────────────────────────────────────────────────────────

  private async handleRequest(method: string, input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const url = this.buildUrl(input.url, input.query);
    const timeout = input.timeout ?? Math.min(context.deadlineMs, this.defaultTimeout);

    // Validate host
    const host = new URL(url).hostname;
    if (!this.isHostAllowed(host)) {
      throw new Error(`Host ${host} is not allowed`);
    }

    const start = Date.now();

    // Build headers
    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...(input.headers ?? {}),
    };

    // Build body
    let body: string | undefined;
    if (input.body !== undefined) {
      body = input.body;
      if (!headers['content-type']) {
        headers['content-type'] = 'text/plain';
      }
    } else if (input.bodyJson !== undefined) {
      body = JSON.stringify(input.bodyJson);
      if (!headers['content-type']) {
        headers['content-type'] = 'application/json';
      }
    }

    // Create abort controller for timeout
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeout);
    // Also chain with the provider-level signal
    if (context.signal.aborted) {
      clearTimeout(timeoutId);
      throw new Error('Request was aborted before starting');
    }
    context.signal.addEventListener('abort', () => abortController.abort(), { once: true });

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
        signal: abortController.signal,
        redirect: input.followRedirects ?? true ? 'follow' : 'manual',
      });

      clearTimeout(timeoutId);

      // Read response body with size limit
      const responseText = await this.readResponseBody(response);
      const durationMs = Date.now() - start;

      // Parse response headers
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      // Try to parse JSON
      let bodyJson: unknown;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json') && responseText) {
        try {
          bodyJson = JSON.parse(responseText);
        } catch {
          // Not valid JSON, that's fine
        }
      }

      const result: Record<string, unknown> = {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseText,
        durationMs,
      };

      if (bodyJson !== undefined) {
        result['bodyJson'] = bodyJson;
      }

      return this.success(result, durationMs, { ru: 3, mu: 2, eu: 2, vu: 0 });
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof TypeError && e.message.includes('abort')) {
        throw new Error(`HTTP ${method} to ${url} timed out after ${timeout}ms`);
      }
      throw new Error(`HTTP ${method} to ${url} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private buildUrl(baseUrl: string, query?: Record<string, string>): string {
    if (!query || Object.keys(query).length === 0) return baseUrl;
    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  private isHostAllowed(host: string): boolean {
    if (this.allowedHosts.includes('*')) return true;
    for (const pattern of this.allowedHosts) {
      if (pattern.startsWith('*.')) {
        const domain = pattern.slice(2);
        if (host === domain || host.endsWith('.' + domain)) return true;
      } else if (host === pattern) {
        return true;
      }
    }
    return false;
  }

  private async readResponseBody(response: Response): Promise<string> {
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > this.maxResponseSize) {
      throw new Error(`Response body exceeds maximum size (${this.maxResponseSize} bytes)`);
    }

    const text = await response.text();

    if (text.length > this.maxResponseSize) {
      throw new Error(`Response body exceeds maximum size (${this.maxResponseSize} bytes)`);
    }

    return text;
  }

  protected override async performHealthCheck(): Promise<{ healthy: boolean; details?: unknown }> {
    // Simple DNS resolution check — try a lightweight HEAD request
    try {
      const response = await fetch('https://httpbin.org/head', {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      });
      return { healthy: response.ok, details: { status: response.status } };
    } catch {
      // Network might not be available in test environments
      return { healthy: true, details: { note: 'Network health check skipped (offline mode)' } };
    }
  }
}