/**
 * @agentos/capabilities — Integration Test
 * Executor + real Filesystem + Shell providers working together.
 * Validates the full capability lifecycle with actual I/O.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CapabilityExecutor } from '../src/capability-executor.js';
import { CapabilityRegistry } from '../src/capability-registry.js';
import { CapabilityResolver } from '../src/capability-resolver.js';
import { SecurityHypervisor } from '../src/security-hypervisor.js';
import { SandboxManager } from '../src/sandbox.js';
import { ConsumptionTracker } from '../src/consumption-tracker.js';
import { FilesystemProvider } from '../src/providers/filesystem-provider.js';
import { ShellProvider } from '../src/providers/shell-provider.js';
import type { SecurityPolicy } from '../src/types.js';
import type {
  ResolutionRequest,
  CapabilityPath,
  AgentID,
  WorkspaceID,
} from '@agentos/types';
import { createUUID } from '@agentos/types';
import { mkdtemp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cpath(p: string): CapabilityPath { return p as CapabilityPath; }
function aid(): AgentID { return createUUID() as unknown as AgentID; }
function wid(): WorkspaceID { return createUUID() as unknown as WorkspaceID; }

function makePermissivePolicy(): SecurityPolicy {
  return {
    defaultAction: 'allow',
    capabilityRules: new Map(),
    globalRateLimit: { maxInvocationsPerHour: 1000, maxConcurrent: 50 },
    budgetLimits: { maxRuPerHour: 100000, maxMuPerHour: 50000 },
    approvalRequired: [],
    restricted: [],
    maxInputSizeBytes: 10_000_000,
    maxOutputSizeBytes: 100_000_000,
  };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('Integration: Executor + Filesystem + Shell', () => {
  let sandboxDir: string;
  let executor: CapabilityExecutor;
  let registry: CapabilityRegistry;
  let agentId: AgentID;
  let workspaceId: WorkspaceID;

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(tmpdir(), 'agentos-integration-'));
    agentId = aid();
    workspaceId = wid();

    registry = new CapabilityRegistry();
    const resolver = new CapabilityResolver(registry);
    const hypervisor = new SecurityHypervisor(makePermissivePolicy());
    const sandboxManager = new SandboxManager();
    const consumptionTracker = new ConsumptionTracker();

    // Register real providers
    // sandboxEnabled: false so the executor uses the provider's rootDir
    // instead of creating ephemeral per-invocation sandboxes
    const fsProvider = new FilesystemProvider({ rootDir: sandboxDir, writable: true, sandboxEnabled: false });
    const shellProvider = new ShellProvider();
    await registry.registerProvider(fsProvider);
    await registry.registerProvider(shellProvider);

    executor = new CapabilityExecutor({
      registry,
      resolver,
      hypervisor,
      sandboxManager,
      consumptionTracker,
      config: { generateMemoryArtifacts: false },
    });
  });

  afterEach(async () => {
    try {
      await rm(sandboxDir, { recursive: true, force: true });
    } catch {
      // May already be cleaned up
    }
  });

  it('should write a file then read it back', async () => {
    // Write
    const writeRequest: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.write'),
      context: { agent_id: agentId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const writeResult = await executor.invoke(
      writeRequest,
      { path: 'hello.txt', content: 'Hello from AgentOS!' },
      { agentId, workspaceId },
    );

    expect(writeResult.ok).toBe(true);

    // Read
    const readRequest: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: agentId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const readResult = await executor.invoke(
      readRequest,
      { path: 'hello.txt' },
      { agentId, workspaceId },
    );

    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      const output = readResult.data.output as any;
      expect(output.content).toBe('Hello from AgentOS!');
    }
  });

  it('should execute a shell command and track consumption', async () => {
    const request: ResolutionRequest = {
      capability_path: cpath('actuate.shell.exec'),
      context: { agent_id: agentId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const isWin = process.platform === 'win32';
    const command = isWin ? 'cmd' : 'echo';
    const args = isWin ? ['/c', 'echo', 'integration-test'] : ['integration-test'];

    const result = await executor.invoke(
      request,
      { command, args },
      { agentId, workspaceId },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.resources_consumed).toBeDefined();
      expect(result.data.resources_consumed.ru).toBeGreaterThan(0);
    }
  });

  it('should list a directory that was created via write', async () => {
    // Write a file (creates directory structure)
    const writeRequest: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.write'),
      context: { agent_id: agentId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    await executor.invoke(
      writeRequest,
      { path: 'subdir/file1.txt', content: 'file1' },
      { agentId, workspaceId },
    );

    // List the directory
    const listRequest: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.list'),
      context: { agent_id: agentId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const listResult = await executor.invoke(
      listRequest,
      { path: '.', recursive: true },
      { agentId, workspaceId },
    );

    expect(listResult.ok).toBe(true);
    if (listResult.ok) {
      const output = listResult.data.output as any;
      expect(output.entries.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('should emit full lifecycle events for real invocations', async () => {
    const request: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: agentId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    // Create a file first so read succeeds
    await writeFile(join(sandboxDir, 'events-test.txt'), 'test content');

    await executor.invoke(
      request,
      { path: 'events-test.txt' },
      { agentId, workspaceId },
    );

    const events = executor.getEvents();
    const phases = events.map(e => e.phase);

    expect(phases).toContain('created');
    expect(phases).toContain('resolved');
    expect(phases).toContain('approved');
    expect(phases).toContain('executing');
    expect(phases).toContain('completed');
  });

  it('should track consumption across multiple invocations', async () => {
    // Create a file first
    await writeFile(join(sandboxDir, 'multi.txt'), 'data');

    const readRequest: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.read'),
      context: { agent_id: agentId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    // Execute 3 reads
    for (let i = 0; i < 3; i++) {
      await executor.invoke(readRequest, { path: 'multi.txt' }, { agentId, workspaceId });
    }

    const tracker = executor.getConsumptionTracker();
    expect(tracker.count).toBe(3);
    const agentConsumption = tracker.getByAgent(agentId);
    expect(agentConsumption.ru).toBeGreaterThan(0);
  });

  it('should stat a file created via write', async () => {
    // Write
    const writeRequest: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.write'),
      context: { agent_id: agentId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    await executor.invoke(
      writeRequest,
      { path: 'stat-me.txt', content: 'stat test content' },
      { agentId, workspaceId },
    );

    // Stat
    const statRequest: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.stat'),
      context: { agent_id: agentId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const statResult = await executor.invoke(
      statRequest,
      { path: 'stat-me.txt' },
      { agentId, workspaceId },
    );

    expect(statResult.ok).toBe(true);
    if (statResult.ok) {
      const output = statResult.data.output as any;
      expect(output.type).toBe('file');
      expect(output.size).toBeGreaterThan(0);
    }
  });

  it('should delete a file created via write', async () => {
    // Write
    const writeRequest: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.write'),
      context: { agent_id: agentId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    await executor.invoke(
      writeRequest,
      { path: 'delete-me.txt', content: 'delete me' },
      { agentId, workspaceId },
    );

    // Verify it exists
    const statBefore = await stat(join(sandboxDir, 'delete-me.txt'));
    expect(statBefore).toBeDefined();

    // Delete
    const deleteRequest: ResolutionRequest = {
      capability_path: cpath('actuate.filesystem.delete'),
      context: { agent_id: agentId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const deleteResult = await executor.invoke(
      deleteRequest,
      { path: 'delete-me.txt' },
      { agentId, workspaceId },
    );

    expect(deleteResult.ok).toBe(true);

    // Verify it's gone
    await expect(stat(join(sandboxDir, 'delete-me.txt'))).rejects.toThrow();
  });

  it('should block shell exec with restrictive security policy', async () => {
    // Create a new executor with deny-by-default policy
    const denyPolicy: SecurityPolicy = {
      defaultAction: 'deny',
      capabilityRules: new Map(),
      globalRateLimit: { maxInvocationsPerHour: 1000, maxConcurrent: 50 },
      budgetLimits: { maxRuPerHour: 100000, maxMuPerHour: 50000 },
      approvalRequired: [],
      restricted: [],
      maxInputSizeBytes: 10_000_000,
      maxOutputSizeBytes: 100_000_000,
    };

    const denyHypervisor = new SecurityHypervisor(denyPolicy);
    const denyResolver = new CapabilityResolver(registry);
    const denyExecutor = new CapabilityExecutor({
      registry,
      resolver: denyResolver,
      hypervisor: denyHypervisor,
      sandboxManager: new SandboxManager(),
      consumptionTracker: new ConsumptionTracker(),
    });

    const request: ResolutionRequest = {
      capability_path: cpath('actuate.shell.exec'),
      context: { agent_id: agentId },
      constraints: {},
      preferences: { optimize_for: 'balanced' },
    };

    const result = await denyExecutor.invoke(
      request,
      { command: 'echo', args: ['blocked'] },
      { agentId, workspaceId },
    );

    expect(result.ok).toBe(false);
  });
});