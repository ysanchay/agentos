/**
 * @agentos/capabilities — Shell Provider
 * Implements actuate.shell.{exec,script} using child_process.spawn.
 * All commands are sandbox-gated with allowlists and resource limits.
 */

import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { ProviderExecuteContext, ProviderSandboxConfig } from '../types.js';
import { ProviderBase, type ProviderBaseConfig, type ProviderCapabilityDef } from './provider-base.js';

// ─── Input Schemas ───────────────────────────────────────────────────────────

const EXEC_INPUT = {
  type: 'object',
  required: ['command'],
  properties: {
    command: { type: 'string', description: 'Command to execute' },
    args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' },
    cwd: { type: 'string', description: 'Working directory' },
    env: { type: 'object', description: 'Environment variables' },
    timeout: { type: 'number', default: 30000, description: 'Execution timeout in ms' },
    stdin: { type: 'string', description: 'Input to pass to stdin' },
    shell: { type: 'boolean', default: false, description: 'Run command in a shell' },
  },
} as const;

const SCRIPT_INPUT = {
  type: 'object',
  required: ['commands'],
  properties: {
    commands: { type: 'array', items: { type: 'string' }, description: 'Commands to execute sequentially' },
    cwd: { type: 'string', description: 'Working directory' },
    env: { type: 'object', description: 'Environment variables' },
    timeout: { type: 'number', default: 60000, description: 'Total script timeout in ms' },
    stopOnError: { type: 'boolean', default: true, description: 'Stop on first error' },
  },
} as const;

const SHELL_OUTPUT = {
  type: 'object',
  properties: {
    exitCode: { type: 'number' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    durationMs: { type: 'number' },
    command: { type: 'string' },
  },
} as const;

// ─── Provider Config ──────────────────────────────────────────────────────────

export interface ShellProviderConfig extends ProviderBaseConfig {
  /** Allowed commands (if not set, all commands allowed) */
  allowedCommands?: string[];
  /** Maximum subprocess memory in bytes (default 512MB) */
  maxMemoryBytes?: number;
  /** Default execution timeout (default 30s) */
  defaultTimeout?: number;
  /** Maximum stdout/stderr capture size in bytes (default 1MB) */
  maxOutputSize?: number;
}

// ─── Shell Provider ───────────────────────────────────────────────────────────

export class ShellProvider extends ProviderBase {
  private readonly allowedCommands: string[] | undefined;
  private readonly maxMemoryBytes: number;
  private readonly defaultTimeout: number;
  private readonly maxOutputSize: number;

  constructor(config?: Partial<ShellProviderConfig>) {
    const sandboxOverride: Partial<ProviderSandboxConfig> = {
      process: {
        enabled: true,
        allowedCommands: config?.allowedCommands ?? [],
        maxProcesses: 5,
        maxMemoryBytes: config?.maxMemoryBytes ?? 512_000_000,
      },
      maxTimeoutMs: 120_000,
    };

    const defs: ProviderCapabilityDef[] = [
      {
        path: 'actuate.shell.exec',
        displayName: 'Execute Command',
        description: 'Execute a single shell command',
        inputSchema: EXEC_INPUT,
        outputSchema: SHELL_OUTPUT,
        handler: (input, ctx) => this.handleExec(input, ctx),
        permissionsRequired: ['shell:exec'],
        stability: 'beta',
        resourceProfile: { typical: { ru: 5, mu: 3, eu: 2, vu: 0 }, peak: { ru: 30, mu: 20, eu: 10, vu: 0 }, timeout_ms: 30_000 },
      },
      {
        path: 'actuate.shell.script',
        displayName: 'Execute Script',
        description: 'Execute multiple commands sequentially as a script',
        inputSchema: SCRIPT_INPUT,
        outputSchema: SHELL_OUTPUT,
        handler: (input, ctx) => this.handleScript(input, ctx),
        permissionsRequired: ['shell:exec'],
        stability: 'beta',
        resourceProfile: { typical: { ru: 10, mu: 5, eu: 3, vu: 0 }, peak: { ru: 50, mu: 30, eu: 15, vu: 0 }, timeout_ms: 60_000 },
      },
    ];

    super(
      {
        root: 'actuate',
        reliabilityScore: 0.85,
        avgLatencyMs: 500,
        successRate: 0.90,
        maxConcurrent: 10,
        sandboxConfig: sandboxOverride,
        ...config,
      },
      defs,
    );

    this.allowedCommands = config?.allowedCommands;
    this.maxMemoryBytes = config?.maxMemoryBytes ?? 512_000_000;
    this.defaultTimeout = config?.defaultTimeout ?? 30_000;
    this.maxOutputSize = config?.maxOutputSize ?? 1_000_000;
  }

  // ─── Handlers ────────────────────────────────────────────────────────────

  private async handleExec(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const command = input.command as string;
    const args = (input.args ?? []) as string[];
    const cwd = input.cwd ?? context.sandboxRoot ?? process.cwd();
    const timeout = input.timeout ?? Math.min(context.deadlineMs, this.defaultTimeout);

    // Validate command
    this.validateCommand(command);

    // Build environment
    const env = { ...process.env, ...context.env, ...(input.env ?? {}) };

    const start = Date.now();

    const result = await this.runProcess(command, args, {
      cwd,
      env,
      timeout,
      stdin: input.stdin,
      shell: input.shell ?? false,
      signal: context.signal,
    });

    return this.success(result, Date.now() - start, { ru: 5, mu: 3, eu: 2, vu: 0 });
  }

  private async handleScript(input: any, context: ProviderExecuteContext): Promise<ReturnType<typeof this.success>> {
    const commands = input.commands as string[];
    const cwd = input.cwd ?? context.sandboxRoot ?? process.cwd();
    const totalTimeout = input.timeout ?? Math.min(context.deadlineMs, 60_000);
    const stopOnError = input.stopOnError ?? true;
    const start = Date.now();

    // Build environment
    const env = { ...process.env, ...context.env, ...(input.env ?? {}) };

    const results: Array<{ command: string; exitCode: number; stdout: string; stderr: string }> = [];
    let combinedStdout = '';
    let combinedStderr = '';

    for (const cmd of commands) {
      if (Date.now() - start > totalTimeout) {
        throw new Error(`Script timed out after ${totalTimeout}ms`);
      }

      // Parse command into command + args for non-shell execution
      const parts = cmd.split(/\s+/);
      const command = parts[0]!;
      const args = parts.slice(1);

      this.validateCommand(command);

      const result = await this.runProcess(command, args, {
        cwd,
        env,
        timeout: totalTimeout - (Date.now() - start),
        shell: false,
        signal: context.signal,
      });

      results.push({ command: cmd, ...result });
      combinedStdout += result.stdout;
      combinedStderr += result.stderr;

      if (stopOnError && result.exitCode !== 0) {
        break;
      }
    }

    const lastResult = results[results.length - 1];
    const durationMs = Date.now() - start;

    return this.success({
      exitCode: lastResult?.exitCode ?? 0,
      stdout: combinedStdout,
      stderr: combinedStderr,
      durationMs,
      commandCount: results.length,
      results,
    }, durationMs, { ru: 10, mu: 5, eu: 3, vu: 0 });
  }

  // ─── Process Runner ──────────────────────────────────────────────────────

  private runProcess(
    command: string,
    args: string[],
    options: {
      cwd: string;
      env: Record<string, string | undefined>;
      timeout: number;
      stdin?: string;
      shell?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const proc = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        shell: options.shell,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Timeout
      const timeoutId = setTimeout(() => {
        killed = true;
        proc.kill('SIGTERM');
        // Give process 5s to exit gracefully, then force kill
        setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch { /* already dead */ }
        }, 5000);
      }, options.timeout);

      // Abort signal
      if (options.signal) {
        if (options.signal.aborted) {
          clearTimeout(timeoutId);
          proc.kill('SIGTERM');
          reject(new Error('Process aborted before starting'));
          return;
        }
        options.signal.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          killed = true;
          proc.kill('SIGTERM');
        }, { once: true });
      }

      proc.stdout?.on('data', (data: Buffer) => {
        if (stdout.length < this.maxOutputSize) {
          stdout += data.toString('utf-8');
        }
      });

      proc.stderr?.on('data', (data: Buffer) => {
        if (stderr.length < this.maxOutputSize) {
          stderr += data.toString('utf-8');
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutId);
        reject(new Error(`Process error: ${err.message}`));
      });

      proc.on('close', (exitCode) => {
        clearTimeout(timeoutId);
        if (killed && exitCode === null) {
          reject(new Error(`Process timed out after ${options.timeout}ms`));
          return;
        }
        resolve({
          exitCode: exitCode ?? 1,
          stdout: stdout.slice(0, this.maxOutputSize),
          stderr: stderr.slice(0, this.maxOutputSize),
          durationMs: 0, // Caller measures wall-clock
        });
      });

      // Write stdin if provided
      if (options.stdin) {
        proc.stdin?.write(options.stdin);
      }
      proc.stdin?.end();
    });
  }

  // ─── Validation ──────────────────────────────────────────────────────────

  private validateCommand(command: string): void {
    if (!this.allowedCommands || this.allowedCommands.length === 0) {
      return; // No allowlist = all commands allowed (rely on SecurityHypervisor)
    }

    // Extract base command (first part before any path separator)
    const baseCommand = command.split('/').pop()?.split('\\').pop() ?? command;

    if (!this.allowedCommands.includes(baseCommand) && !this.allowedCommands.includes(command)) {
      throw new Error(`Command '${command}' is not allowed. Allowed: ${this.allowedCommands.join(', ')}`);
    }
  }

  protected override async performHealthCheck(): Promise<{ healthy: boolean; details?: unknown }> {
    // Try spawning a simple echo command
    try {
      const result = await this.runProcess(
        process.platform === 'win32' ? 'cmd' : 'echo',
        process.platform === 'win32' ? ['/c', 'echo', 'health'] : ['health'],
        { cwd: process.cwd(), env: process.env as any, timeout: 5000 },
      );
      return { healthy: result.exitCode === 0, details: { exitCode: result.exitCode } };
    } catch {
      return { healthy: false, details: { reason: 'Cannot spawn processes' } };
    }
  }
}