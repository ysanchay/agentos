import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TelemetryCollector, type TaskTelemetry } from '../src/telemetry-collector.js';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeTask(overrides: Partial<TaskTelemetry> = {}): TaskTelemetry {
  return {
    taskId: overrides.taskId ?? 'task-1',
    workspaceId: overrides.workspaceId ?? 'ws-1',
    goalId: overrides.goalId ?? 'goal-1',
    category: overrides.category ?? 'market-research',
    submittedAt: overrides.submittedAt ?? '2026-06-23T00:00:00.000Z',
    completedAt: overrides.completedAt ?? '2026-06-23T00:01:00.000Z',
    latencyMs: overrides.latencyMs ?? 60000,
    status: overrides.status ?? 'completed',
    capabilitiesUsed: overrides.capabilitiesUsed ?? [
      { path: 'navigate.browser.goto', provider: 'playwright', latencyMs: 500, success: true, resourceConsumption: { ru: 10, mu: 5, eu: 2, vu: 1 } },
    ],
    agentsInvolved: overrides.agentsInvolved ?? 5,
    agentsByType: overrides.agentsByType ?? { chief: 1, manager: 1, worker: 2, validator: 1 },
    validationResult: overrides.validationResult ?? 'approved',
    validationAccuracy: overrides.validationAccuracy ?? 0.95,
    validationConfidence: overrides.validationConfidence ?? 0.9,
    failuresInjected: overrides.failuresInjected ?? 0,
    failuresRecovered: overrides.failuresRecovered ?? 0,
    recoveryTimeMs: overrides.recoveryTimeMs ?? 0,
    securityChecksRun: overrides.securityChecksRun ?? 9,
    securityChecksPassed: overrides.securityChecksPassed ?? 9,
    securityDenials: overrides.securityDenials ?? 0,
    approvalGatesTriggered: overrides.approvalGatesTriggered ?? 0,
    modeTransitions: overrides.modeTransitions ?? 0,
    queueDepth: overrides.queueDepth ?? 0,
    syncEvents: overrides.syncEvents ?? 0,
    userInterventions: overrides.userInterventions ?? 0,
    interventionType: overrides.interventionType ?? null,
    invariantViolations: overrides.invariantViolations ?? 0,
    constitutionalCompliance: overrides.constitutionalCompliance ?? 100,
  };
}

describe('TelemetryCollector', () => {
  let tempDir: string;
  let collector: TelemetryCollector;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentos-telemetry-'));
    collector = new TelemetryCollector(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts and ends a session', () => {
    const sessionId = collector.startSession('user-1', 'test-session');
    expect(sessionId).toBe('test-session');

    const session = collector.endSession();
    expect(session).not.toBeNull();
    expect(session!.userId).toBe('user-1');
    expect(session!.sessionId).toBe('test-session');
    expect(session!.endedAt).not.toBeNull();
  });

  it('records tasks and updates session counters', () => {
    collector.startSession('user-1');
    collector.recordTask(makeTask({ taskId: 't1', status: 'completed', latencyMs: 1000 }));
    collector.recordTask(makeTask({ taskId: 't2', status: 'failed', latencyMs: 2000 }));
    collector.recordTask(makeTask({ taskId: 't3', status: 'timeout', latencyMs: 3000, userInterventions: 1 }));

    const session = collector.endSession();
    expect(session!.totalTasks).toBe(3);
    expect(session!.completedTasks).toBe(1);
    expect(session!.failedTasks).toBe(1);
    expect(session!.timedOutTasks).toBe(1);
    expect(session!.totalLatencyMs).toBe(6000);
    expect(session!.userInterventions).toBe(1);
  });

  it('persists session to disk', () => {
    collector.startSession('user-1', 'persist-test');
    collector.recordTask(makeTask());
    collector.endSession();

    const sessionPath = join(tempDir, 'session-persist-test.json');
    expect(existsSync(sessionPath)).toBe(true);
    const data = JSON.parse(readFileSync(sessionPath, 'utf-8'));
    expect(data.userId).toBe('user-1');
    expect(data.tasks).toHaveLength(1);
  });

  it('appends tasks to append-only log', () => {
    collector.startSession('user-1');
    collector.recordTask(makeTask({ taskId: 'log-1' }));
    collector.recordTask(makeTask({ taskId: 'log-2' }));

    const logPath = join(tempDir, 'task-log.jsonl');
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const task1 = JSON.parse(lines[0]!);
    expect(task1.taskId).toBe('log-1');
  });

  it('computes summary with capability and category breakdown', () => {
    collector.startSession('user-1');
    collector.recordTask(makeTask({
      taskId: 't1', category: 'market-research', status: 'completed', latencyMs: 1000,
      capabilitiesUsed: [
        { path: 'navigate.browser.goto', provider: 'playwright', latencyMs: 500, success: true, resourceConsumption: { ru: 10, mu: 0, eu: 0, vu: 0 } },
        { path: 'extract.browser.text', provider: 'playwright', latencyMs: 300, success: true, resourceConsumption: { ru: 5, mu: 0, eu: 0, vu: 0 } },
      ],
    }));
    collector.recordTask(makeTask({
      taskId: 't2', category: 'document-generation', status: 'failed', latencyMs: 2000,
      capabilitiesUsed: [
        { path: 'navigate.browser.goto', provider: 'playwright', latencyMs: 600, success: false, resourceConsumption: { ru: 10, mu: 0, eu: 0, vu: 0 } },
      ],
    }));
    collector.endSession();

    const summary = collector.getSummary();
    expect(summary.totalTasks).toBe(2);
    expect(summary.completionRate).toBe(0.5);
    expect(summary.avgLatencyMs).toBe(1500);
    expect(summary.topCapabilities).toHaveLength(2);
    expect(summary.topCapabilities[0]!.path).toBe('navigate.browser.goto');
    expect(summary.topCapabilities[0]!.uses).toBe(2);
    expect(summary.topCapabilities[0]!.successRate).toBe(0.5);
    expect(summary.categoryBreakdown['market-research']!.completed).toBe(1);
    expect(summary.categoryBreakdown['document-generation']!.completed).toBe(0);
  });

  it('exports all telemetry as JSON', () => {
    collector.startSession('user-1', 'export-test');
    collector.recordTask(makeTask());
    collector.endSession();

    const exportPath = join(tempDir, 'export.json');
    collector.exportAll(exportPath);
    expect(existsSync(exportPath)).toBe(true);
    const data = JSON.parse(readFileSync(exportPath, 'utf-8'));
    expect(data.sessions).toHaveLength(1);
    expect(data.summary.totalTasks).toBe(1);
  });

  it('throws when recording task without active session', () => {
    expect(() => collector.recordTask(makeTask())).toThrow('No active session');
  });
});