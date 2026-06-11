/**
 * @agentos/capabilities — MCP Provider Tests
 * Tests the MCPProvider class without requiring a real MCP server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPProvider, type MCPProviderConfig } from '../../src/mcp/mcp-provider.js';
import type { ProviderExecuteContext } from '../../src/types.js';
import type {
  CapabilityInvocation,
  InvocationID,
  AgentID,
  WorkspaceID,
  ProviderID,
  CapabilityPath,
} from '@agentos/types';
import { createUUID } from '@agentos/types';

// ─── Mock Runtime ──────────────────────────────────────────────────────────────

function createMockRuntime(type: 'tool' | 'resource' | 'prompt') {
  return {
    config: { name: 'test-server', command: 'test' },
    getState: vi.fn().mockReturnValue('connected'),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'tool result' }],
      isError: false,
    }),
    readResource: vi.fn().mockResolvedValue({
      contents: [{ uri: 'file:///test.txt', mimeType: 'text/plain', text: 'resource content' }],
    }),
    getPrompt: vi.fn().mockResolvedValue({
      description: 'test prompt',
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: 'prompt content' } }],
    }),
    stop: vi.fn().mockResolvedValue(undefined),
  };
}

function makeInvocation(path: string, input: unknown): CapabilityInvocation {
  return {
    id: createUUID() as unknown as InvocationID,
    capability_path: path as CapabilityPath,
    provider_id: createUUID() as unknown as ProviderID,
    caller: {
      agent_id: createUUID() as unknown as AgentID,
      workspace_id: createUUID() as unknown as WorkspaceID,
    },
    input,
    options: { timeout_ms: 30000, priority: 3, retry_on_failure: false },
    status: 'pending',
    created_at: new Date().toISOString(),
  };
}

function makeContext(invocation: CapabilityInvocation): ProviderExecuteContext {
  return {
    invocation,
    capability: {} as any,
    env: {},
    deadlineMs: 30_000,
    log: () => {},
    signal: new AbortController().signal,
  };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('MCPProvider', () => {
  it('should create capabilities from tool definitions', () => {
    const runtime = createMockRuntime('tool');
    const provider = new MCPProvider({
      runtime: runtime as any,
      serverName: 'test-server',
      type: 'tool',
      capabilities: [
        {
          path: 'compute.mcp.test-server.read-file',
          displayName: 'Read File',
          description: 'Read a file via MCP',
          inputSchema: { type: 'object' },
          root: 'compute',
        },
        {
          path: 'compute.mcp.test-server.write-file',
          displayName: 'Write File',
          description: 'Write a file via MCP',
          inputSchema: { type: 'object' },
          root: 'compute',
        },
      ],
      sandboxConfig: {
        filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
        network: { enabled: true, allowedHosts: ['*'], allowOutbound: true, maxResponseSize: 10_000_000 },
        process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
        maxTimeoutMs: 60_000,
      },
    });

    expect(provider.capabilities.length).toBe(2);
    expect(provider.capabilities[0]!.path).toBe('compute.mcp.test-server.read-file');
    expect(provider.capabilities[1]!.root).toBe('compute');
    expect(provider.providerRecord.id).toBeDefined();
    expect(provider.sandboxConfig.network.enabled).toBe(true);
  });

  it('should execute a tool call via runtime', async () => {
    const runtime = createMockRuntime('tool');
    const provider = new MCPProvider({
      runtime: runtime as any,
      serverName: 'test-server',
      type: 'tool',
      capabilities: [
        {
          path: 'compute.mcp.test-server.read-file',
          displayName: 'Read File',
          description: 'Read a file via MCP',
          inputSchema: { type: 'object' },
          root: 'compute',
        },
      ],
      sandboxConfig: {
        filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
        network: { enabled: true, allowedHosts: ['*'], allowOutbound: true, maxResponseSize: 10_000_000 },
        process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
        maxTimeoutMs: 60_000,
      },
    });

    const invocation = makeInvocation('compute.mcp.test-server.read-file', { path: '/test.txt' });
    const context = makeContext(invocation);
    const result = await provider.execute(context);

    expect(result.output).toBeDefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0); // Mock resolves instantly
    expect(result.resourcesConsumed).toBeDefined();
    expect(runtime.callTool).toHaveBeenCalledOnce();
  });

  it('should execute a resource read via runtime', async () => {
    const runtime = createMockRuntime('resource');
    const provider = new MCPProvider({
      runtime: runtime as any,
      serverName: 'test-server',
      type: 'resource',
      capabilities: [
        {
          path: 'remember.mcp.test-server.api-docs',
          displayName: 'API Docs',
          description: 'API documentation resource',
          inputSchema: { type: 'object' },
          root: 'remember',
        },
      ],
      sandboxConfig: {
        filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
        network: { enabled: true, allowedHosts: ['*'], allowOutbound: true, maxResponseSize: 10_000_000 },
        process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
        maxTimeoutMs: 30_000,
      },
    });

    const invocation = makeInvocation('remember.mcp.test-server.api-docs', { uri: 'file:///api/docs' });
    const context = makeContext(invocation);
    const result = await provider.execute(context);

    expect(result.output).toBeDefined();
    expect(runtime.readResource).toHaveBeenCalledWith('file:///api/docs');
  });

  it('should execute a prompt get via runtime', async () => {
    const runtime = createMockRuntime('prompt');
    const provider = new MCPProvider({
      runtime: runtime as any,
      serverName: 'test-server',
      type: 'prompt',
      capabilities: [
        {
          path: 'reason.mcp.test-server.code-review',
          displayName: 'Code Review',
          description: 'Code review prompt',
          inputSchema: { type: 'object' },
          root: 'reason',
        },
      ],
      sandboxConfig: {
        filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
        network: { enabled: true, allowedHosts: ['*'], allowOutbound: true, maxResponseSize: 10_000_000 },
        process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
        maxTimeoutMs: 60_000,
      },
    });

    const invocation = makeInvocation('reason.mcp.test-server.code-review', { code: 'fn main() {}' });
    const context = makeContext(invocation);
    const result = await provider.execute(context);

    expect(result.output).toBeDefined();
    expect(runtime.getPrompt).toHaveBeenCalledOnce();
  });

  it('should throw for unknown capability paths', async () => {
    const runtime = createMockRuntime('tool');
    const provider = new MCPProvider({
      runtime: runtime as any,
      serverName: 'test-server',
      type: 'tool',
      capabilities: [
        {
          path: 'compute.mcp.test-server.read-file',
          displayName: 'Read File',
          description: 'Read',
          inputSchema: { type: 'object' },
          root: 'compute',
        },
      ],
      sandboxConfig: {
        filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
        network: { enabled: false, allowedHosts: [], allowOutbound: false, maxResponseSize: 0 },
        process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
        maxTimeoutMs: 60_000,
      },
    });

    const invocation = makeInvocation('compute.mcp.test-server.nonexistent', {});
    const context = makeContext(invocation);

    await expect(provider.execute(context)).rejects.toThrow('no handler');
  });

  it('should report healthy when runtime is connected', async () => {
    const runtime = createMockRuntime('tool');
    const provider = new MCPProvider({
      runtime: runtime as any,
      serverName: 'test-server',
      type: 'tool',
      capabilities: [],
      sandboxConfig: {
        filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
        network: { enabled: false, allowedHosts: [], allowOutbound: false, maxResponseSize: 0 },
        process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
        maxTimeoutMs: 60_000,
      },
    });

    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
  });

  it('should report unhealthy when runtime is disconnected', async () => {
    const runtime = createMockRuntime('tool');
    runtime.getState.mockReturnValue('failed');
    const provider = new MCPProvider({
      runtime: runtime as any,
      serverName: 'test-server',
      type: 'tool',
      capabilities: [],
      sandboxConfig: {
        filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
        network: { enabled: false, allowedHosts: [], allowOutbound: false, maxResponseSize: 0 },
        process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
        maxTimeoutMs: 60_000,
      },
    });

    const health = await provider.healthCheck();
    expect(health.healthy).toBe(false);
  });

  it('should call runtime.stop() on shutdown', async () => {
    const runtime = createMockRuntime('tool');
    const provider = new MCPProvider({
      runtime: runtime as any,
      serverName: 'test-server',
      type: 'tool',
      capabilities: [],
      sandboxConfig: {
        filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
        network: { enabled: false, allowedHosts: [], allowOutbound: false, maxResponseSize: 0 },
        process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
        maxTimeoutMs: 60_000,
      },
    });

    await provider.shutdown();
    expect(runtime.stop).toHaveBeenCalledOnce();
  });

  it('should mark all capabilities as beta stability', () => {
    const runtime = createMockRuntime('tool');
    const provider = new MCPProvider({
      runtime: runtime as any,
      serverName: 'test-server',
      type: 'tool',
      capabilities: [
        {
          path: 'compute.mcp.test-server.tool1',
          displayName: 'Tool 1',
          description: 'Test tool',
          inputSchema: { type: 'object' },
          root: 'compute',
        },
      ],
      sandboxConfig: {
        filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
        network: { enabled: false, allowedHosts: [], allowOutbound: false, maxResponseSize: 0 },
        process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
        maxTimeoutMs: 60_000,
      },
    });

    for (const cap of provider.capabilities) {
      expect(cap.stability).toBe('beta');
      expect(cap.tags).toContain('mcp');
    }
  });

  it('should throw when resource invocation lacks uri', async () => {
    const runtime = createMockRuntime('resource');
    const provider = new MCPProvider({
      runtime: runtime as any,
      serverName: 'test-server',
      type: 'resource',
      capabilities: [
        {
          path: 'remember.mcp.test-server.docs',
          displayName: 'Docs',
          description: 'Docs',
          inputSchema: { type: 'object' },
          root: 'remember',
        },
      ],
      sandboxConfig: {
        filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
        network: { enabled: false, allowedHosts: [], allowOutbound: false, maxResponseSize: 0 },
        process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
        maxTimeoutMs: 30_000,
      },
    });

    const invocation = makeInvocation('remember.mcp.test-server.docs', {});
    const context = makeContext(invocation);

    await expect(provider.execute(context)).rejects.toThrow('requires a "uri"');
  });
});