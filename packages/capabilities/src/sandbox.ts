/**
 * @agentos/capabilities — Sandbox Manager
 * Creates isolated execution environments for capability providers.
 * Handles directory creation, path validation, and cleanup.
 */

import { mkdtemp, rm, readdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { ProviderSandboxConfig } from './types.js';

export interface SandboxHandle {
  id: string;
  root: string;
  config: ProviderSandboxConfig;
}

export class SandboxManager {
  private activeSandboxes = new Map<string, SandboxHandle>();

  /**
   * Create a sandbox for a provider invocation.
   * Creates a temporary directory under the OS temp dir.
   */
  async createSandbox(config: ProviderSandboxConfig, prefix: string = 'agentos-'): Promise<SandboxHandle> {
    const id = `sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const root = await mkdtemp(join(tmpdir(), sep, prefix));

    const handle: SandboxHandle = { id, root, config };
    this.activeSandboxes.set(id, handle);

    return handle;
  }

  /**
   * Destroy a sandbox — remove the temporary directory and all contents.
   */
  async destroySandbox(sandboxId: string): Promise<void> {
    const handle = this.activeSandboxes.get(sandboxId);
    if (!handle) return;

    try {
      await rm(handle.root, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup — don't throw on sandbox teardown
    }

    this.activeSandboxes.delete(sandboxId);
  }

  /**
   * Validate that a file path stays within the sandbox root.
   * Prevents path traversal attacks (e.g., "../../etc/passwd").
   */
  isPathAllowed(path: string, sandboxRoot: string, allowedPaths: string[]): boolean {
    const resolved = resolve(path);

    // Must be under sandbox root
    if (!resolved.startsWith(resolve(sandboxRoot) + sep) && resolved !== resolve(sandboxRoot)) {
      return false;
    }

    // If specific allowedPaths are defined, check them
    if (allowedPaths.length > 0 && !allowedPaths.includes('**')) {
      const relativePath = resolved.slice(resolve(sandboxRoot).length + 1);
      const isAllowed = allowedPaths.some(pattern => {
        if (pattern === '**') return true;
        if (pattern.endsWith('/**')) {
          return relativePath.startsWith(pattern.slice(0, -3));
        }
        return relativePath === pattern || relativePath.startsWith(pattern + '/');
      });
      if (!isAllowed) return false;
    }

    return true;
  }

  /**
   * Validate that a host is in the allowed list.
   */
  isHostAllowed(hostname: string, allowedHosts: string[]): boolean {
    if (allowedHosts.length === 0 || allowedHosts.includes('*')) {
      return true;
    }

    return allowedHosts.some(pattern => {
      if (pattern === '*') return true;
      // Simple glob: *.example.com matches sub.example.com
      if (pattern.startsWith('*.')) {
        const domain = pattern.slice(2);
        return hostname === domain || hostname.endsWith('.' + domain);
      }
      return hostname === pattern;
    });
  }

  /**
   * Get the count of active sandboxes.
   */
  get activeCount(): number {
    return this.activeSandboxes.size;
  }

  /**
   * Destroy all active sandboxes.
   */
  async destroyAll(): Promise<void> {
    const ids = Array.from(this.activeSandboxes.keys());
    await Promise.all(ids.map(id => this.destroySandbox(id)));
  }

  /**
   * Get a sandbox handle by ID.
   */
  getSandbox(sandboxId: string): SandboxHandle | undefined {
    return this.activeSandboxes.get(sandboxId);
  }
}