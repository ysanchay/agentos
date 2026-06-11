/**
 * @agentos/capabilities — Capability Runtime
 * Universal execution layer between agents and external systems.
 * All actions are expressed as capabilities through a provider-based architecture.
 */

// Core
export { CapabilityRegistry } from './capability-registry.js';
export { CapabilityResolver } from './capability-resolver.js';
export { CapabilityExecutor } from './capability-executor.js';
export { SecurityHypervisor } from './security-hypervisor.js';
export { SandboxManager } from './sandbox.js';
export { ConsumptionTracker } from './consumption-tracker.js';
export { createProductionPolicy, createDevelopmentPolicy } from './production-policy.js';

// Providers
export { ProviderBase, type ProviderBaseConfig, type ProviderCapabilityDef, type CapabilityHandler } from './providers/provider-base.js';
export { FilesystemProvider, type FilesystemProviderConfig } from './providers/filesystem-provider.js';
export { HttpProvider, type HttpProviderConfig } from './providers/http-provider.js';
export { ShellProvider, type ShellProviderConfig } from './providers/shell-provider.js';
export { LocalModelProvider, type LocalModelProviderConfig } from './providers/local-model-provider.js';

// MCP
export { MCPRuntime, type MCPServerConfig, type MCPServerCapabilities, type MCPServerInfo, type MCPRuntimeState, type MCPTool, type MCPResource, type MCPPrompt, type MCPContent, type MCPToolResult, type MCPResourceContent, type MCPPromptMessage, type MCPPromptResult } from './mcp/mcp-runtime.js';
export { MCPProvider, type MCPProviderConfig, type MCPCapabilityDef } from './mcp/mcp-provider.js';
export { adaptMCPRuntime, toolToPath, resourceToPath, promptToPath, type MCPAdapterResult } from './mcp/mcp-adapter.js';

// Types
export type {
  ICapabilityProvider,
  ProviderExecuteContext,
  ProviderExecuteResult,
  ProviderSandboxConfig,
  SecurityPolicy,
  CapabilityRule,
  InvocationEvent,
  CapabilityExecutorConfig,
} from './types.js';