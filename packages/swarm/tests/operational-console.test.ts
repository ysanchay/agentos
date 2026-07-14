import { describe, it, expect, beforeEach } from 'vitest';
import { OperationalConsole } from '../src/operational-console.js';

describe('OperationalConsole — basic functionality', () => {
  let console: OperationalConsole;

  beforeEach(() => {
    console = new OperationalConsole();
  });

  it('records and retrieves security checks', () => {
    console.recordSecurityCheck({
      timestamp: new Date().toISOString(),
      checkType: 'pre-invoke',
      checkName: 'policy',
      passed: true,
      detail: 'Policy check passed',
    });
    console.recordSecurityCheck({
      timestamp: new Date().toISOString(),
      checkType: 'pre-invoke',
      checkName: 'permission',
      passed: false,
      detail: 'Permission denied',
    });

    const data = console.getConsoleData();
    expect(data.securityAudit).toHaveLength(2);
    expect(data.securityAudit[1]!.passed).toBe(false);
    // Should have generated an alert for the failed check
    expect(data.alerts.length).toBeGreaterThanOrEqual(1);
    expect(data.alerts[0]!.severity).toBe('P1');
  });

  it('records performance metrics', () => {
    console.recordPerformance({
      timestamp: new Date().toISOString(),
      latencyMs: 1500,
      throughputOpsPerSec: 10.5,
      errorRate: 0.05,
      completionRate: 0.95,
    });

    const data = console.getConsoleData();
    expect(data.performance).toHaveLength(1);
    expect(data.performance[0]!.latencyMs).toBe(1500);
  });

  it('alerts on high error rate', () => {
    console.recordPerformance({
      timestamp: new Date().toISOString(),
      latencyMs: 2000,
      throughputOpsPerSec: 5,
      errorRate: 0.25, // > 0.2 threshold
      completionRate: 0.75,
    });

    const data = console.getConsoleData();
    expect(data.alerts.some(a => a.message.includes('High error rate'))).toBe(true);
  });

  it('updates offline status and generates mode alerts', () => {
    console.updateOfflineStatus({
      mode: 'offline',
      queueDepth: 100,
      queueMaxSize: 10000,
      syncStatus: 'idle',
      artifactCacheEntries: 50,
      artifactCacheHitRate: 0.8,
      memoryCacheEntries: 30,
      memoryBufferedWrites: 5,
      localModelsAvailable: 3,
      inferenceSlotsUsed: 2,
      inferenceSlotsTotal: 4,
    });

    const data = console.getConsoleData();
    expect(data.offline).not.toBeNull();
    expect(data.offline!.mode).toBe('offline');
    expect(data.alerts.some(a => a.message.includes('OFFLINE mode'))).toBe(true);
  });

  it('evaluates resources and generates alerts', () => {
    const alerts = console.evaluateResources(
      { ru: 9700, mu: 4000, eu: 1000, vu: 100 },  // RU at 97%
      { ru: 10000, mu: 5000, eu: 2000, vu: 500 },
    );

    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.some(a => a.resourceType === 'RU' && a.severity === 'P0')).toBe(true);
  });

  it('renders the full operational console', () => {
    console.updateOfflineStatus({
      mode: 'hybrid',
      queueDepth: 42,
      queueMaxSize: 10000,
      syncStatus: 'reconciling',
      artifactCacheEntries: 100,
      artifactCacheHitRate: 0.85,
      memoryCacheEntries: 50,
      memoryBufferedWrites: 12,
      localModelsAvailable: 5,
      inferenceSlotsUsed: 3,
      inferenceSlotsTotal: 8,
    });

    console.recordPerformance({
      timestamp: new Date().toISOString(),
      latencyMs: 1200,
      throughputOpsPerSec: 8.3,
      errorRate: 0.02,
      completionRate: 0.98,
    });

    const rendered = console.render();
    expect(rendered).toContain('OPERATIONAL CONSOLE');
    expect(rendered).toContain('OFFLINE RUNTIME');
    expect(rendered).toContain('HYBRID');
    expect(rendered).toContain('PERFORMANCE');
  });

  it('resets all state', () => {
    console.recordSecurityCheck({
      timestamp: new Date().toISOString(),
      checkType: 'pre-invoke',
      checkName: 'test',
      passed: true,
      detail: 'test',
    });
    console.recordPerformance({
      timestamp: new Date().toISOString(),
      latencyMs: 100,
      throughputOpsPerSec: 10,
      errorRate: 0.01,
      completionRate: 0.99,
    });

    console.reset();
    const data = console.getConsoleData();
    expect(data.securityAudit).toHaveLength(0);
    expect(data.performance).toHaveLength(0);
    expect(data.alerts).toHaveLength(0);
    expect(data.offline).toBeNull();
  });
});