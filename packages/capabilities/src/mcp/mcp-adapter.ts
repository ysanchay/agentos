/**
 * @agentos/capabilities — MCP Adapter
 * Maps discovered MCP tools, resources, and prompts to AgentOS CapabilityPaths
 * and creates ICapabilityProvider instances via MCPProvider.
 *
 * Path mapping conventions:
 *   MCP tools     → compute.mcp.{server}.{tool}
 *   MCP resources → remember.mcp.{server}.{resource}
 *   MCP prompts   → reason.mcp.{server}.{prompt}
 */

import type { CapabilityPath, RootCapability } from '@agentos/types';
import type { ICapabilityProvider, ProviderSandboxConfig } from '../types.js';
import type { MCPRuntime, MCPTool, MCPResource, MCPPrompt } from './mcp-runtime.js';
import { MCPProvider } from './mcp-provider.js';

// ─── Path Mapping ─────────────────────────────────────────────────────────────

/**
 * Sanitize a name for use in a capability path segment.
 * Lowercase, replace non-alphanumeric with hyphens, collapse multiple hyphens.
 */
function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Map an MCP tool to an AgentOS capability path.
 * Convention: compute.mcp.{server}.{tool}
 */
export function toolToPath(serverName: string, toolName: string): CapabilityPath {
  return `compute.mcp.${sanitize(serverName)}.${sanitize(toolName)}` as CapabilityPath;
}

/**
 * Map an MCP resource to an AgentOS capability path.
 * Convention: remember.mcp.{server}.{resource}
 */
export function resourceToPath(serverName: string, resourceName: string): CapabilityPath {
  return `remember.mcp.${sanitize(serverName)}.${sanitize(resourceName)}` as CapabilityPath;
}

/**
 * Map an MCP prompt to an AgentOS capability path.
 * Convention: reason.mcp.{server}.{prompt}
 */
export function promptToPath(serverName: string, promptName: string): CapabilityPath {
  return `reason.mcp.${sanitize(serverName)}.${sanitize(promptName)}` as CapabilityPath;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export interface MCPAdapterResult {
  /** Providers created from MCP server capabilities */
  providers: ICapabilityProvider[];
  /** Summary of discovered capabilities */
  summary: {
    serverName: string;
    tools: number;
    resources: number;
    prompts: number;
    paths: CapabilityPath[];
  };
}

/**
 * Create ICapabilityProvider instances from a connected MCPRuntime.
 * Each MCP capability type (tool, resource, prompt) gets its own provider
 * with the correct capability paths and root assignments.
 */
export function adaptMCPRuntime(runtime: MCPRuntime): MCPAdapterResult {
  const serverName = sanitize(runtime.config.name);
  const tools = runtime.getTools();
  const resources = runtime.getResources();
  const prompts = runtime.getPrompts();
  const paths: CapabilityPath[] = [];

  const providers: ICapabilityProvider[] = [];

  // Create a provider for tools
  if (tools.length > 0) {
    const toolProvider = new MCPProvider({
      runtime,
      serverName,
      type: 'tool',
      capabilities: tools.map(tool => ({
        path: toolToPath(serverName, tool.name),
        displayName: tool.description ?? tool.name,
        description: `MCP tool: ${tool.name} (from ${runtime.config.name})`,
        inputSchema: tool.inputSchema,
        root: 'compute' as RootCapability,
      })),
      sandboxConfig: {
        filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
        network: { enabled: true, allowedHosts: ['*'], allowOutbound: true, maxResponseSize: 10_000_000 },
        process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
        maxTimeoutMs: 60_000,
      },
    });
    providers.push(toolProvider);
    paths.push(...tools.map(t => toolToPath(serverName, t.name)));
  }

  // Create a provider for resources
  if (resources.length > 0) {
    const resourceProvider = new MCPProvider({
      runtime,
      serverName,
      type: 'resource',
      capabilities: resources.map(resource => ({
        path: resourceToPath(serverName, resource.name),
        displayName: resource.description ?? resource.name,
        description: `MCP resource: ${resource.name} (from ${runtime.config.name})`,
        inputSchema: {
          type: 'object',
          properties: { uri: { type: 'string', description: `Resource URI: ${resource.uri}` } },
        },
        root: 'remember' as RootCapability,
      })),
      sandboxConfig: {
        filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
        network: { enabled: true, allowedHosts: ['*'], allowOutbound: true, maxResponseSize: 10_000_000 },
        process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
        maxTimeoutMs: 30_000,
      },
    });
    providers.push(resourceProvider);
    paths.push(...resources.map(r => resourceToPath(serverName, r.name)));
  }

  // Create a provider for prompts
  if (prompts.length > 0) {
    const promptProvider = new MCPProvider({
      runtime,
      serverName,
      type: 'prompt',
      capabilities: prompts.map(prompt => ({
        path: promptToPath(serverName, prompt.name),
        displayName: prompt.description ?? prompt.name,
        description: `MCP prompt: ${prompt.name} (from ${runtime.config.name})`,
        inputSchema: {
          type: 'object',
          properties: Object.fromEntries(
            (prompt.arguments ?? []).map(arg => [
              arg.name,
              { type: 'string', description: arg.description ?? '' },
            ]),
          ),
        },
        root: 'reason' as RootCapability,
      })),
      sandboxConfig: {
        filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
        network: { enabled: true, allowedHosts: ['*'], allowOutbound: true, maxResponseSize: 10_000_000 },
        process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
        maxTimeoutMs: 60_000,
      },
    });
    providers.push(promptProvider);
    paths.push(...prompts.map(p => promptToPath(serverName, p.name)));
  }

  return {
    providers,
    summary: {
      serverName,
      tools: tools.length,
      resources: resources.length,
      prompts: prompts.length,
      paths,
    },
  };
}