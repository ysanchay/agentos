/**
 * @agentos/capabilities — MCP Runtime
 * JSON-RPC 2.0 client for Model Context Protocol servers.
 * Manages server subprocess lifecycle, handshake, and tool/resource/prompt discovery.
 * Supports stdio transport (newline-delimited JSON).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { ProviderID, CapabilityPath } from '@agentos/types';
import { createUUID } from '@agentos/types';

// ─── MCP Types ───────────────────────────────────────────────────────────────

export interface MCPServerConfig {
  /** Unique ID for this MCP server */
  id?: ProviderID;
  /** Display name */
  name: string;
  /** Command to launch the server (e.g., 'npx', 'python') */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Environment variables for the subprocess */
  env?: Record<string, string>;
  /** Working directory for the subprocess */
  cwd?: string;
  /** Protocol version (default: '2025-03-26') */
  protocolVersion?: string;
  /** Client info sent during handshake */
  clientInfo?: { name: string; version: string };
  /** Startup timeout in ms (default: 30000) */
  startupTimeout?: number;
}

export interface MCPServerCapabilities {
  tools?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  prompts?: { listChanged?: boolean };
  logging?: {};
  completions?: {};
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  size?: number;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

export interface MCPContent {
  type: 'text' | 'image' | 'audio' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { uri: string; mimeType?: string; text?: string };
}

export interface MCPToolResult {
  content: MCPContent[];
  isError?: boolean;
}

export interface MCPResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface MCPPromptMessage {
  role: 'user' | 'assistant';
  content: MCPContent;
}

export interface MCPPromptResult {
  description?: string;
  messages: MCPPromptMessage[];
}

export interface MCPServerInfo {
  name: string;
  version: string;
  instructions?: string;
}

// ─── JSON-RPC Types ───────────────────────────────────────────────────────────

interface JSONRPCRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ─── MCP Runtime ──────────────────────────────────────────────────────────────

export type MCPRuntimeState = 'disconnected' | 'connecting' | 'connected' | 'failed';

export class MCPRuntime extends EventEmitter {
  readonly config: MCPServerConfig;
  readonly id: ProviderID;

  private proc: ChildProcess | null = null;
  private state: MCPRuntimeState = 'disconnected';
  private requestId = 0;
  private pendingRequests = new Map<number | string, {
    resolve: (result: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private buffer = '';
  private serverCapabilities?: MCPServerCapabilities;
  private serverInfo?: MCPServerInfo;
  private tools: MCPTool[] = [];
  private resources: MCPResource[] = [];
  private prompts: MCPPrompt[] = [];

  constructor(config: MCPServerConfig) {
    super();
    this.config = config;
    this.id = config.id ?? createUUID() as unknown as ProviderID;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * Start the MCP server subprocess and perform handshake.
   */
  async start(): Promise<void> {
    if (this.state !== 'disconnected') {
      throw new Error(`Cannot start: server is ${this.state}`);
    }

    this.state = 'connecting';
    this.emit('stateChange', this.state);

    try {
      // Launch subprocess
      this.proc = spawn(this.config.command, this.config.args ?? [], {
        cwd: this.config.cwd,
        env: { ...process.env, ...this.config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (!this.proc.stdin || !this.proc.stdout || !this.proc.stderr) {
        throw new Error('Failed to create stdio pipes');
      }

      // Handle stdout — line-buffered JSON-RPC messages
      this.proc.stdout.on('data', (chunk: Buffer) => {
        this.handleStdout(chunk.toString('utf-8'));
      });

      // Handle stderr — logging
      this.proc.stderr.on('data', (chunk: Buffer) => {
        this.emit('log', chunk.toString('utf-8').trim());
      });

      // Handle process exit
      this.proc.on('exit', (code, signal) => {
        this.handleExit(code, signal);
      });

      this.proc.on('error', (err) => {
        this.state = 'failed';
        this.emit('stateChange', this.state);
        this.emit('error', err);
        this.rejectAllPending(`Server error: ${err.message}`);
      });

      // Perform handshake
      await this.handshake();

      // Discover capabilities
      await this.discover();

      this.state = 'connected';
      this.emit('stateChange', this.state);
    } catch (e) {
      this.state = 'failed';
      this.emit('stateChange', this.state);
      this.kill();
      throw e;
    }
  }

  /**
   * Stop the MCP server gracefully.
   */
  async stop(): Promise<void> {
    if (this.state === 'disconnected') return;

    this.rejectAllPending('Server shutting down');
    this.kill();
    this.state = 'disconnected';
    this.emit('stateChange', this.state);
  }

  /**
   * Get the current runtime state.
   */
  getState(): MCPRuntimeState {
    return this.state;
  }

  /**
   * Get discovered tools.
   */
  getTools(): ReadonlyArray<MCPTool> {
    return this.tools;
  }

  /**
   * Get discovered resources.
   */
  getResources(): ReadonlyArray<MCPResource> {
    return this.resources;
  }

  /**
   * Get discovered prompts.
   */
  getPrompts(): ReadonlyArray<MCPPrompt> {
    return this.prompts;
  }

  /**
   * Get server info from handshake.
   */
  getServerInfo(): MCPServerInfo | undefined {
    return this.serverInfo;
  }

  /**
   * Get server capabilities from handshake.
   */
  getServerCapabilities(): MCPServerCapabilities | undefined {
    return this.serverCapabilities;
  }

  // ─── MCP Operations ──────────────────────────────────────────────────────

  /**
   * Call a tool on the MCP server.
   */
  async callTool(name: string, arguments_?: Record<string, unknown>): Promise<MCPToolResult> {
    const result = await this.sendRequest('tools/call', {
      name,
      arguments: arguments_ ?? {},
    });
    return result as MCPToolResult;
  }

  /**
   * Read a resource from the MCP server.
   */
  async readResource(uri: string): Promise<{ contents: MCPResourceContent[] }> {
    const result = await this.sendRequest('resources/read', { uri });
    return result as { contents: MCPResourceContent[] };
  }

  /**
   * Get a prompt from the MCP server.
   */
  async getPrompt(name: string, arguments_?: Record<string, string>): Promise<MCPPromptResult> {
    const result = await this.sendRequest('prompts/get', {
      name,
      arguments: arguments_ ?? {},
    });
    return result as MCPPromptResult;
  }

  /**
   * Re-discover tools, resources, and prompts.
   */
  async refresh(): Promise<void> {
    await this.discover();
  }

  // ─── Private: Handshake ───────────────────────────────────────────────────

  private async handshake(): Promise<void> {
    const timeout = this.config.startupTimeout ?? 30_000;

    const result = await this.sendRequest('initialize', {
      protocolVersion: this.config.protocolVersion ?? '2025-03-26',
      capabilities: {
        roots: { listChanged: true },
      },
      clientInfo: this.config.clientInfo ?? {
        name: 'AgentOS',
        version: '1.0.0',
      },
    }, timeout);

    const initResult = result as {
      protocolVersion: string;
      capabilities: MCPServerCapabilities;
      serverInfo: MCPServerInfo;
      instructions?: string;
    };

    this.serverCapabilities = initResult.capabilities;
    this.serverInfo = initResult.serverInfo;

    // Send initialized notification
    this.sendNotification('notifications/initialized');
  }

  /**
   * Discover tools, resources, and prompts from the server.
   */
  private async discover(): Promise<void> {
    const discoverPromises: Promise<void>[] = [];

    if (this.serverCapabilities?.tools) {
      discoverPromises.push(
        this.sendRequest('tools/list', {})
          .then(result => {
            this.tools = (result as { tools: MCPTool[] }).tools ?? [];
            this.emit('toolsDiscovered', this.tools);
          })
          .catch(() => {
            this.tools = [];
          }),
      );
    }

    if (this.serverCapabilities?.resources) {
      discoverPromises.push(
        this.sendRequest('resources/list', {})
          .then(result => {
            this.resources = (result as { resources: MCPResource[] }).resources ?? [];
            this.emit('resourcesDiscovered', this.resources);
          })
          .catch(() => {
            this.resources = [];
          }),
      );
    }

    if (this.serverCapabilities?.prompts) {
      discoverPromises.push(
        this.sendRequest('prompts/list', {})
          .then(result => {
            this.prompts = (result as { prompts: MCPPrompt[] }).prompts ?? [];
            this.emit('promptsDiscovered', this.prompts);
          })
          .catch(() => {
            this.prompts = [];
          }),
      );
    }

    await Promise.all(discoverPromises);
  }

  // ─── Private: JSON-RPC Transport ──────────────────────────────────────────

  private sendRequest(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin) {
        reject(new Error('Server not connected'));
        return;
      }

      const id = ++this.requestId;
      const request: JSONRPCRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${method} timed out after ${timeoutMs ?? 30000}ms`));
      }, timeoutMs ?? 30_000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      const message = JSON.stringify(request) + '\n';
      this.proc.stdin.write(message, 'utf-8');
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.proc?.stdin) return;

    const notification: JSONRPCNotification = {
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    };

    const message = JSON.stringify(notification) + '\n';
    this.proc.stdin.write(message, 'utf-8');
  }

  private handleStdout(data: string): void {
    this.buffer += data;

    // Split on newlines — each line is a complete JSON-RPC message
    const lines = this.buffer.split('\n');
    // Last element might be incomplete — keep it in the buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const message = JSON.parse(line) as JSONRPCResponse;
        this.handleMessage(message);
      } catch {
        // Malformed JSON — ignore
        this.emit('log', `Malformed JSON-RPC message: ${line.slice(0, 200)}`);
      }
    }
  }

  private handleMessage(message: JSONRPCResponse): void {
    // Response to a pending request
    if ('id' in message && message.id !== undefined) {
      const pending = this.pendingRequests.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(message.id);

        if (message.error) {
          pending.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
        } else {
          pending.resolve(message.result);
        }
      }
    }
    // Server-initiated notification or request
    else if ('method' in message) {
      const notif = message as unknown as JSONRPCNotification;
      this.emit('notification', notif);

      // Handle capability change notifications
      if (notif.method === 'notifications/tools/list_changed') {
        this.sendRequest('tools/list', {}).then(result => {
          this.tools = (result as { tools: MCPTool[] }).tools ?? [];
          this.emit('toolsDiscovered', this.tools);
        }).catch(() => {});
      } else if (notif.method === 'notifications/resources/list_changed') {
        this.sendRequest('resources/list', {}).then(result => {
          this.resources = (result as { resources: MCPResource[] }).resources ?? [];
          this.emit('resourcesDiscovered', this.resources);
        }).catch(() => {});
      } else if (notif.method === 'notifications/prompts/list_changed') {
        this.sendRequest('prompts/list', {}).then(result => {
          this.prompts = (result as { prompts: MCPPrompt[] }).prompts ?? [];
          this.emit('promptsDiscovered', this.prompts);
        }).catch(() => {});
      }
    }
  }

  private handleExit(code: number | null, signal: string | null): void {
    this.rejectAllPending(`Server exited with code ${code}, signal ${signal}`);
    this.proc = null;

    if (this.state !== 'disconnected') {
      this.state = 'failed';
      this.emit('stateChange', this.state);
    }
  }

  private kill(): void {
    if (!this.proc) return;

    try {
      // Close stdin to signal shutdown
      this.proc.stdin?.end();
    } catch {
      // May already be closed
    }

    // Give process 3s to exit gracefully, then force kill
    const pid = this.proc.pid;
    setTimeout(() => {
      try {
        if (pid) process.kill(pid, 'SIGKILL');
      } catch {
        // Already dead
      }
    }, 3000);

    this.proc = null;
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }
}