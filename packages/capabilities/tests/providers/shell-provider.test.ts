/**
 * @agentos/capabilities — Shell Provider Tests
 * Tests shell command execution using child_process.spawn.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ShellProvider } from '../../src/providers/shell-provider.js';
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

function makeContext(invocation: CapabilityInvocation): ProviderExecuteContext {
  return {
    invocation,
    capability: {} as any,
    env: {},
    deadlineMs: 30000,
    log: () => {},
    signal: new AbortController().signal,
  };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('ShellProvider', () => {
  it('should register shell capabilities', () => {
    const provider = new ShellProvider();
    const paths = provider.capabilities.map(c => c.path as string);
    expect(paths).toContain('actuate.shell.exec');
    expect(paths).toContain('actuate.shell.script');
  });

  it('should have process sandbox enabled', () => {
    const provider = new ShellProvider();
    expect(provider.sandboxConfig.process.enabled).toBe(true);
    expect(provider.sandboxConfig.process.maxProcesses).toBeGreaterThan(0);
  });

  it('should execute a command and return output', async () => {
    const provider = new ShellProvider();

    // Use platform-appropriate echo command
    const isWin = process.platform === 'win32';
    const command = isWin ? 'cmd' : 'echo';
    const args = isWin ? ['/c', 'echo', 'hello'] : ['hello'];

    const invocation = makeInvocation('actuate.shell.exec', { command, args });
    const context = makeContext(invocation);
    const result = await provider.execute(context);

    expect(result.output).toBeDefined();
    const output = result.output as any;
    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain('hello');
  });

  it('should capture stderr on failure', async () => {
    const provider = new ShellProvider();

    const isWin = process.platform === 'win32';
    const command = isWin ? 'cmd' : 'ls';
    const args = isWin ? ['/c', 'dir', 'NONEXISTENT_DIR_XYZ'] : ['NONEXISTENT_DIR_XYZ'];

    const invocation = makeInvocation('actuate.shell.exec', { command, args });
    const context = makeContext(invocation);
    const result = await provider.execute(context);

    const output = result.output as any;
    // Non-zero exit code expected
    expect(output.exitCode).not.toBe(0);
  });

  it('should execute a script with multiple commands', async () => {
    const provider = new ShellProvider();

    const isWin = process.platform === 'win32';
    const commands = isWin
      ? ['cmd /c echo first', 'cmd /c echo second']
      : ['echo first', 'echo second'];

    const invocation = makeInvocation('actuate.shell.script', { commands });
    const context = makeContext(invocation);
    const result = await provider.execute(context);

    const output = result.output as any;
    expect(output.commandCount).toBe(2);
    expect(output.stdout).toContain('first');
    expect(output.stdout).toContain('second');
  });

  it('should block disallowed commands when allowlist is set', async () => {
    const provider = new ShellProvider({ allowedCommands: ['echo'] });

    const isWin = process.platform === 'win32';
    const command = isWin ? 'cmd' : 'rm';
    const args = isWin ? ['/c', 'del'] : ['-rf', '/tmp/nope'];

    const invocation = makeInvocation('actuate.shell.exec', { command, args });
    const context = makeContext(invocation);

    await expect(provider.execute(context)).rejects.toThrow('not allowed');
  });

  it('should timeout long-running commands', async () => {
    const provider = new ShellProvider({ defaultTimeout: 1000 });

    // Use node itself to create a long-running process (cross-platform)
    const command = process.execPath;
    const args = ['-e', 'setTimeout(() => {}, 30000)'];

    const invocation = makeInvocation('actuate.shell.exec', { command, args, timeout: 500 });
    const context = makeContext(invocation);

    // On timeout, behavior varies by platform:
    // Unix: exitCode=null → promise rejects with timeout error
    // Windows: exitCode=1 → promise resolves with non-zero exitCode
    try {
      const result = await provider.execute(context);
      // Windows path: resolved with non-zero exit code
      const output = result.output as any;
      expect(output.exitCode).not.toBe(0);
    } catch (e) {
      // Unix path: rejected with timeout error
      expect((e as Error).message).toContain('timed out');
    }
  });

  it('should pass health check', async () => {
    const provider = new ShellProvider();
    const health = await provider.healthCheck();
    expect(health.healthy).toBe(true);
  });

  it('should mark shell capabilities as beta stability', () => {
    const provider = new ShellProvider();
    for (const cap of provider.capabilities) {
      expect(cap.stability).toBe('beta');
    }
  });

  it('should require shell:exec permission', () => {
    const provider = new ShellProvider();
    for (const cap of provider.capabilities) {
      expect(cap.permissions_required).toContain('shell:exec');
    }
  });
});