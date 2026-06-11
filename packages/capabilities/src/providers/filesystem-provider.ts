/**
 * @agentos/capabilities — Filesystem Provider
 * Implements actuate.filesystem.{read,write,list,stat,delete,watch}
 * using Node.js fs/promises. All file operations are sandboxed.
 */

import { readFile, writeFile, readdir, stat, unlink, mkdir, access } from 'node:fs/promises';
import { join, resolve, relative, dirname, basename } from 'node:path';
import { watch } from 'node:fs';
import type { ResourceConsumption } from '@agentos/types';
import type { ProviderExecuteContext, ProviderSandboxConfig } from '../types.js';
import { ProviderBase, type ProviderBaseConfig, type ProviderCapabilityDef } from './provider-base.js';

// ─── Input Schemas ───────────────────────────────────────────────────────────

const READ_INPUT = {
  type: 'object',
  required: ['path'],
  properties: {
    path: { type: 'string', description: 'File path to read (relative to sandbox root)' },
    encoding: { type: 'string', default: 'utf-8', description: 'File encoding' },
  },
} as const;

const WRITE_INPUT = {
  type: 'object',
  required: ['path', 'content'],
  properties: {
    path: { type: 'string', description: 'File path to write (relative to sandbox root)' },
    content: { type: 'string', description: 'Content to write' },
    encoding: { type: 'string', default: 'utf-8' },
    append: { type: 'boolean', default: false, description: 'Append instead of overwrite' },
  },
} as const;

const LIST_INPUT = {
  type: 'object',
  required: ['path'],
  properties: {
    path: { type: 'string', description: 'Directory to list (relative to sandbox root)' },
    recursive: { type: 'boolean', default: false },
    pattern: { type: 'string', description: 'Glob pattern to filter results' },
  },
} as const;

const STAT_INPUT = {
  type: 'object',
  required: ['path'],
  properties: {
    path: { type: 'string', description: 'File or directory path' },
  },
} as const;

const DELETE_INPUT = {
  type: 'object',
  required: ['path'],
  properties: {
    path: { type: 'string', description: 'File path to delete' },
    recursive: { type: 'boolean', default: false, description: 'Remove directories recursively' },
  },
} as const;

const GENERIC_OUTPUT = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    data: { type: 'object' },
    error: { type: 'string' },
  },
} as const;

// ─── Provider Config ──────────────────────────────────────────────────────────

export interface FilesystemProviderConfig extends ProviderBaseConfig {
  /** Root directory for file operations (defaults to cwd) */
  rootDir?: string;
  /** Whether write operations are allowed */
  writable?: boolean;
  /** Maximum file size in bytes (default 10MB) */
  maxFileSize?: number;
  /** Whether the executor should create a sandbox for this provider (default true).
   *  Set to false for integration testing with a persistent rootDir. */
  sandboxEnabled?: boolean;
}

// ─── Filesystem Provider ─────────────────────────────────────────────────────

export class FilesystemProvider extends ProviderBase {
  private readonly rootDir: string;
  private readonly writable: boolean;
  private readonly maxFileSize: number;

  constructor(config?: Partial<FilesystemProviderConfig>) {
    const rootDir = config?.rootDir ?? process.cwd();
    const writable = config?.writable ?? true;
    const maxFileSize = config?.maxFileSize ?? 10_000_000;
    const sandboxEnabled = config?.sandboxEnabled ?? true;

    const sandboxOverride: Partial<ProviderSandboxConfig> = {
      filesystem: {
        enabled: sandboxEnabled,
        allowedPaths: ['**'],
        writable,
        maxFileSize,
      },
      maxTimeoutMs: 60_000,
    };

    const defs: ProviderCapabilityDef[] = [
      {
        path: 'actuate.filesystem.read',
        displayName: 'Read File',
        description: 'Read the contents of a file',
        inputSchema: READ_INPUT,
        outputSchema: GENERIC_OUTPUT,
        handler: (input, ctx) => this.handleRead(input, ctx),
        resourceProfile: { typical: { ru: 2, mu: 1, eu: 1, vu: 0 }, peak: { ru: 10, mu: 5, eu: 2, vu: 0 }, timeout_ms: 10_000 },
      },
      {
        path: 'actuate.filesystem.write',
        displayName: 'Write File',
        description: 'Write content to a file',
        inputSchema: WRITE_INPUT,
        outputSchema: GENERIC_OUTPUT,
        handler: (input, ctx) => this.handleWrite(input, ctx),
        resourceProfile: { typical: { ru: 3, mu: 2, eu: 1, vu: 0 }, peak: { ru: 15, mu: 10, eu: 3, vu: 0 }, timeout_ms: 15_000 },
      },
      {
        path: 'actuate.filesystem.list',
        displayName: 'List Directory',
        description: 'List files and directories',
        inputSchema: LIST_INPUT,
        outputSchema: GENERIC_OUTPUT,
        handler: (input, ctx) => this.handleList(input, ctx),
        resourceProfile: { typical: { ru: 1, mu: 1, eu: 1, vu: 0 }, peak: { ru: 5, mu: 3, eu: 1, vu: 0 }, timeout_ms: 10_000 },
      },
      {
        path: 'actuate.filesystem.stat',
        displayName: 'File Status',
        description: 'Get file or directory metadata',
        inputSchema: STAT_INPUT,
        outputSchema: GENERIC_OUTPUT,
        handler: (input, ctx) => this.handleStat(input, ctx),
        resourceProfile: { typical: { ru: 1, mu: 1, eu: 1, vu: 0 }, peak: { ru: 3, mu: 2, eu: 1, vu: 0 }, timeout_ms: 5_000 },
      },
      {
        path: 'actuate.filesystem.delete',
        displayName: 'Delete File',
        description: 'Delete a file or directory',
        inputSchema: DELETE_INPUT,
        outputSchema: GENERIC_OUTPUT,
        handler: (input, ctx) => this.handleDelete(input, ctx),
        resourceProfile: { typical: { ru: 2, mu: 1, eu: 1, vu: 0 }, peak: { ru: 10, mu: 5, eu: 2, vu: 0 }, timeout_ms: 10_000 },
      },
    ];

    super(
      {
        root: 'actuate',
        reliabilityScore: 0.98,
        avgLatencyMs: 50,
        successRate: 0.99,
        maxConcurrent: 20,
        sandboxConfig: sandboxOverride,
        ...config,
      },
      defs,
    );

    this.rootDir = rootDir;
    this.writable = writable;
    this.maxFileSize = maxFileSize;
  }

  // ─── Handlers ────────────────────────────────────────────────────────────

  private async handleRead(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const filePath = this.resolvePath(input.path, context);
    const encoding = input.encoding ?? 'utf-8';
    const start = Date.now();

    try {
      const content = await readFile(filePath, { encoding: encoding as BufferEncoding });
      return this.success({ content, path: input.path, size: Buffer.byteLength(content) }, Date.now() - start, { ru: 2, mu: 1, eu: 1, vu: 0 });
    } catch (e) {
      throw new Error(`Failed to read file ${input.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async handleWrite(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    if (!this.writable) {
      throw new Error('Write operations are disabled for this provider');
    }

    const filePath = this.resolvePath(input.path, context);
    const content = input.content as string;
    const encoding = (input.encoding ?? 'utf-8') as BufferEncoding;
    const append = input.append ?? false;
    const start = Date.now();

    // Size check
    if (Buffer.byteLength(content) > this.maxFileSize) {
      throw new Error(`Content size exceeds maximum (${this.maxFileSize} bytes)`);
    }

    try {
      // Ensure directory exists
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, content, { encoding, flag: append ? 'a' : 'w' });
      return this.success({ success: true, path: input.path, bytes: Buffer.byteLength(content) }, Date.now() - start, { ru: 3, mu: 2, eu: 1, vu: 0 });
    } catch (e) {
      throw new Error(`Failed to write file ${input.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async handleList(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const dirPath = this.resolvePath(input.path, context);
    const recursive = input.recursive ?? false;
    const start = Date.now();

    try {
      const entries = await this.listDirectory(dirPath, recursive);
      return this.success({ entries, path: input.path, count: entries.length }, Date.now() - start, { ru: 1, mu: 1, eu: 1, vu: 0 });
    } catch (e) {
      throw new Error(`Failed to list directory ${input.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async handleStat(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const filePath = this.resolvePath(input.path, context);
    const start = Date.now();

    try {
      const stats = await stat(filePath);
      return this.success({
        path: input.path,
        type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
        size: stats.size,
        modified: stats.mtime.toISOString(),
        created: stats.birthtime.toISOString(),
        permissions: stats.mode.toString(8).slice(-3),
      }, Date.now() - start, { ru: 1, mu: 1, eu: 1, vu: 0 });
    } catch (e) {
      throw new Error(`Failed to stat ${input.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async handleDelete(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    if (!this.writable) {
      throw new Error('Delete operations are disabled for this provider');
    }

    const filePath = this.resolvePath(input.path, context);
    const recursive = input.recursive ?? false;
    const start = Date.now();

    try {
      if (recursive) {
        const { rm } = await import('node:fs/promises');
        await rm(filePath, { recursive: true, force: true });
      } else {
        await unlink(filePath);
      }
      return this.success({ success: true, path: input.path }, Date.now() - start, { ru: 2, mu: 1, eu: 1, vu: 0 });
    } catch (e) {
      throw new Error(`Failed to delete ${input.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Resolve a path relative to the sandbox root or configured root dir.
   * Prevents path traversal attacks.
   */
  private resolvePath(inputPath: string, context: ProviderExecuteContext): string {
    const base = context.sandboxRoot ?? this.rootDir;
    const resolved = resolve(base, inputPath);

    // Path traversal check — resolved path must be under the base
    if (!resolved.startsWith(resolve(base))) {
      throw new Error(`Path traversal blocked: ${inputPath}`);
    }

    return resolved;
  }

  /**
   * Recursively list directory entries.
   */
  private async listDirectory(dirPath: string, recursive: boolean): Promise<Array<{ name: string; type: string; path: string }>> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const result: Array<{ name: string; type: string; path: string }> = [];

    for (const entry of entries) {
      const entryPath = join(dirPath, entry.name);
      result.push({
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
        path: relative(this.rootDir, entryPath),
      });

      if (recursive && entry.isDirectory()) {
        const subEntries = await this.listDirectory(entryPath, true);
        result.push(...subEntries);
      }
    }

    return result;
  }

  protected override async performHealthCheck(): Promise<{ healthy: boolean; details?: unknown }> {
    try {
      await access(this.rootDir);
      return { healthy: true };
    } catch {
      return { healthy: false, details: { reason: 'Root directory not accessible' } };
    }
  }
}