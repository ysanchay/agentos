/**
 * @agentos/capabilities — Filesystem Provider Tests
 * Tests file operations using a temp directory as sandbox root.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FilesystemProvider } from '../../src/providers/filesystem-provider.js';
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
import { mkdtemp, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function makeContext(invocation: CapabilityInvocation, sandboxRoot?: string): ProviderExecuteContext {
  return {
    invocation,
    capability: {} as any,
    sandboxRoot,
    env: {},
    deadlineMs: 30000,
    log: () => {},
    signal: new AbortController().signal,
  };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('FilesystemProvider', () => {
  let sandboxDir: string;
  let provider: FilesystemProvider;

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(tmpdir(), 'agentos-fs-test-'));
    provider = new FilesystemProvider({ rootDir: sandboxDir, writable: true });
  });

  afterEach(async () => {
    try {
      await rm(sandboxDir, { recursive: true, force: true });
    } catch {
      // Temp dir may already be cleaned up
    }
  });

  it('should register filesystem capabilities', () => {
    const paths = provider.capabilities.map(c => c.path as string);
    expect(paths).toContain('actuate.filesystem.read');
    expect(paths).toContain('actuate.filesystem.write');
    expect(paths).toContain('actuate.filesystem.list');
    expect(paths).toContain('actuate.filesystem.stat');
    expect(paths).toContain('actuate.filesystem.delete');
  });

  it('should have filesystem sandbox enabled', () => {
    expect(provider.sandboxConfig.filesystem.enabled).toBe(true);
    expect(provider.sandboxConfig.filesystem.writable).toBe(true);
  });

  it('should read a file', async () => {
    await writeFile(join(sandboxDir, 'test.txt'), 'hello world', 'utf-8');

    const invocation = makeInvocation('actuate.filesystem.read', { path: 'test.txt' });
    const context = makeContext(invocation, sandboxDir);
    const result = await provider.execute(context);

    expect(result.output).toBeDefined();
    const output = result.output as any;
    expect(output.content).toBe('hello world');
    expect(output.size).toBeGreaterThan(0);
  });

  it('should write a file', async () => {
    const invocation = makeInvocation('actuate.filesystem.write', {
      path: 'new-file.txt',
      content: 'test content',
    });
    const context = makeContext(invocation, sandboxDir);
    const result = await provider.execute(context);

    expect(result.output).toBeDefined();
    const output = result.output as any;
    expect(output.success).toBe(true);

    // Verify file exists
    const content = await import('node:fs/promises').then(m => m.readFile(join(sandboxDir, 'new-file.txt'), 'utf-8'));
    expect(content).toBe('test content');
  });

  it('should append to a file', async () => {
    await writeFile(join(sandboxDir, 'append.txt'), 'line1\n', 'utf-8');

    const invocation = makeInvocation('actuate.filesystem.write', {
      path: 'append.txt',
      content: 'line2\n',
      append: true,
    });
    const context = makeContext(invocation, sandboxDir);
    await provider.execute(context);

    const content = await import('node:fs/promises').then(m => m.readFile(join(sandboxDir, 'append.txt'), 'utf-8'));
    expect(content).toBe('line1\nline2\n');
  });

  it('should list directory contents', async () => {
    await mkdir(join(sandboxDir, 'subdir'));
    await writeFile(join(sandboxDir, 'file1.txt'), 'a');
    await writeFile(join(sandboxDir, 'file2.txt'), 'b');

    const invocation = makeInvocation('actuate.filesystem.list', { path: '.' });
    const context = makeContext(invocation, sandboxDir);
    const result = await provider.execute(context);

    const output = result.output as any;
    expect(output.entries).toBeDefined();
    expect(output.count).toBeGreaterThanOrEqual(2);
  });

  it('should get file stats', async () => {
    await writeFile(join(sandboxDir, 'stat-test.txt'), 'content', 'utf-8');

    const invocation = makeInvocation('actuate.filesystem.stat', { path: 'stat-test.txt' });
    const context = makeContext(invocation, sandboxDir);
    const result = await provider.execute(context);

    const output = result.output as any;
    expect(output.type).toBe('file');
    expect(output.size).toBeGreaterThan(0);
    expect(output.modified).toBeDefined();
  });

  it('should delete a file', async () => {
    await writeFile(join(sandboxDir, 'delete-me.txt'), 'delete me', 'utf-8');

    const invocation = makeInvocation('actuate.filesystem.delete', { path: 'delete-me.txt' });
    const context = makeContext(invocation, sandboxDir);
    const result = await provider.execute(context);

    const output = result.output as any;
    expect(output.success).toBe(true);

    // Verify file is gone
    await expect(stat(join(sandboxDir, 'delete-me.txt'))).rejects.toThrow();
  });

  it('should block path traversal', async () => {
    const invocation = makeInvocation('actuate.filesystem.read', { path: '../../etc/passwd' });
    const context = makeContext(invocation, sandboxDir);

    await expect(provider.execute(context)).rejects.toThrow('Path traversal blocked');
  });

  it('should reject writes when provider is read-only', async () => {
    const readOnlyProvider = new FilesystemProvider({ rootDir: sandboxDir, writable: false });

    const invocation = makeInvocation('actuate.filesystem.write', {
      path: 'readonly-test.txt',
      content: 'should fail',
    });
    const context = makeContext(invocation, sandboxDir);

    await expect(readOnlyProvider.execute(context)).rejects.toThrow('Write operations are disabled');
  });

  it('should pass health check when root is accessible', async () => {
    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
  });

  it('should list recursively', async () => {
    await mkdir(join(sandboxDir, 'a'), { recursive: true });
    await mkdir(join(sandboxDir, 'a', 'b'), { recursive: true });
    await writeFile(join(sandboxDir, 'a', 'file1.txt'), '1');
    await writeFile(join(sandboxDir, 'a', 'b', 'file2.txt'), '2');

    const invocation = makeInvocation('actuate.filesystem.list', { path: 'a', recursive: true });
    const context = makeContext(invocation, sandboxDir);
    const result = await provider.execute(context);

    const output = result.output as any;
    expect(output.count).toBeGreaterThanOrEqual(3); // b dir + file1 + file2
  });
});