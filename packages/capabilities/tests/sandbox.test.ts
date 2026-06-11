/**
 * @agentos/capabilities — Sandbox Manager Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SandboxManager } from '../src/sandbox.js';
import type { ProviderSandboxConfig } from '../src/types.js';
import { join, resolve, sep } from 'node:path';

function makeFilesystemConfig(): ProviderSandboxConfig {
  return {
    filesystem: { enabled: true, allowedPaths: ['**'], writable: true, maxFileSize: 10_000_000 },
    network: { enabled: false, allowedHosts: [], allowOutbound: false, maxResponseSize: 0 },
    process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
    maxTimeoutMs: 30000,
  };
}

function makeProcessConfig(): ProviderSandboxConfig {
  return {
    filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
    network: { enabled: false, allowedHosts: [], allowOutbound: false, maxResponseSize: 0 },
    process: { enabled: true, allowedCommands: ['echo', 'ls'], maxProcesses: 5, maxMemoryBytes: 512_000_000 },
    maxTimeoutMs: 60000,
  };
}

describe('SandboxManager', () => {
  let manager: SandboxManager;

  beforeEach(() => {
    manager = new SandboxManager();
  });

  afterEach(async () => {
    await manager.destroyAll();
  });

  it('should create a sandbox with a temp directory', async () => {
    const config = makeFilesystemConfig();
    const handle = await manager.createSandbox(config);

    expect(handle.id).toBeDefined();
    expect(handle.root).toBeDefined();
    expect(handle.config).toBe(config);
    expect(manager.activeCount).toBe(1);
  });

  it('should create unique sandbox IDs', async () => {
    const config = makeFilesystemConfig();
    const handle1 = await manager.createSandbox(config);
    const handle2 = await manager.createSandbox(config);

    expect(handle1.id).not.toBe(handle2.id);
    expect(handle1.root).not.toBe(handle2.root);
    expect(manager.activeCount).toBe(2);
  });

  it('should destroy a sandbox', async () => {
    const config = makeFilesystemConfig();
    const handle = await manager.createSandbox(config);
    expect(manager.activeCount).toBe(1);

    await manager.destroySandbox(handle.id);
    expect(manager.activeCount).toBe(0);
  });

  it('should handle destroy of non-existent sandbox gracefully', async () => {
    await expect(manager.destroySandbox('nonexistent')).resolves.toBeUndefined();
  });

  it('should destroy all active sandboxes', async () => {
    const config = makeFilesystemConfig();
    await manager.createSandbox(config);
    await manager.createSandbox(config);
    await manager.createSandbox(config);
    expect(manager.activeCount).toBe(3);

    await manager.destroyAll();
    expect(manager.activeCount).toBe(0);
  });

  it('should validate allowed paths within sandbox', () => {
    const sandboxRoot = '/tmp/agentos-sandbox';
    const allowedPaths = ['src/**', 'data/**'];

    expect(manager.isPathAllowed('/tmp/agentos-sandbox/src/main.ts', sandboxRoot, allowedPaths)).toBe(true);
    expect(manager.isPathAllowed('/tmp/agentos-sandbox/data/config.json', sandboxRoot, allowedPaths)).toBe(true);
    expect(manager.isPathAllowed('/tmp/agentos-sandbox/README.md', sandboxRoot, allowedPaths)).toBe(false);
  });

  it('should allow all paths when wildcard is used', () => {
    const sandboxRoot = '/tmp/agentos-sandbox';

    expect(manager.isPathAllowed('/tmp/agentos-sandbox/anything.txt', sandboxRoot, ['**'])).toBe(true);
    expect(manager.isPathAllowed('/tmp/agentos-sandbox/sub/dir/file.ts', sandboxRoot, ['**'])).toBe(true);
  });

  it('should block path traversal attempts', () => {
    const sandboxRoot = '/tmp/agentos-sandbox';

    expect(manager.isPathAllowed('/tmp/agentos-sandbox/../../etc/passwd', sandboxRoot, ['**'])).toBe(false);
    expect(manager.isPathAllowed('/etc/passwd', sandboxRoot, ['**'])).toBe(false);
  });

  it('should validate allowed hosts', () => {
    const allowedHosts = ['api.example.com', '*.test.com'];

    expect(manager.isHostAllowed('api.example.com', allowedHosts)).toBe(true);
    expect(manager.isHostAllowed('sub.test.com', allowedHosts)).toBe(true);
    expect(manager.isHostAllowed('evil.com', allowedHosts)).toBe(false);
  });

  it('should allow all hosts with wildcard', () => {
    expect(manager.isHostAllowed('anything.com', ['*'])).toBe(true);
    expect(manager.isHostAllowed('sub.anything.com', [])).toBe(true); // Empty = allow all
  });

  it('should get sandbox by ID', async () => {
    const config = makeFilesystemConfig();
    const handle = await manager.createSandbox(config);

    const retrieved = manager.getSandbox(handle.id);
    expect(retrieved).toBe(handle);

    expect(manager.getSandbox('nonexistent')).toBeUndefined();
  });
});