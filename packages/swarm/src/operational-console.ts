/**
 * @agentos/swarm — Mission Control Operational Console (Expanded)
 *
 * Extends the base Mission Control snapshot with real-time operational features:
 *   - Offline runtime monitoring (mode, queue depth, sync status, cache stats)
 *   - Security event audit stream
 *   - Resource dashboard with threshold alerts
 *   - Performance analytics (latency trends, throughput, error rates)
 *   - Replayable event timeline from EventStore
 *
 * ALPHA_VALIDATION.md §6 — Mission Control Evolution.
 */

import type { MissionControlSnapshot } from './mission-control.js';
import type { Event } from '@agentos/types';
import { EventDomain } from '@agentos/types';

// ─── Types ─────────────────────────────────────────────────────────────────

export type AlertSeverity = 'P0' | 'P1' | 'P2' | 'P3';

export interface Alert {
  severity: AlertSeverity;
  message: string;
  timestamp: string;
  source: string;
}

export interface OfflineStatus {
  mode: 'online' | 'offline' | 'hybrid';
  queueDepth: number;
  queueMaxSize: number;
  syncStatus: 'idle' | 'reconciling' | 'error';
  artifactCacheEntries: number;
  artifactCacheHitRate: number;
  memoryCacheEntries: number;
  memoryBufferedWrites: number;
  localModelsAvailable: number;
  inferenceSlotsUsed: number;
  inferenceSlotsTotal: number;
}

export interface SecurityAuditEntry {
  timestamp: string;
  checkType: 'pre-invoke' | 'post-invoke';
  checkName: string;
  passed: boolean;
  detail: string;
  agentId?: string;
  capabilityPath?: string;
}

export interface ResourceAlert {
  resourceType: 'RU' | 'MU' | 'EU' | 'VU';
  threshold: number;
  current: number;
  allocated: number;
  severity: AlertSeverity;
  message: string;
}

export interface PerformanceMetric {
  timestamp: string;
  latencyMs: number;
  throughputOpsPerSec: number;
  errorRate: number;
  completionRate: number;
}

export interface EventTimelineEntry {
  eventId: string;
  timestamp: string;
  domain: string;
  type: string;
  source: string;
  summary: string;
}

export interface OperationalConsoleData {
  timestamp: number;
  baseSnapshot: MissionControlSnapshot | null;
  offline: OfflineStatus | null;
  securityAudit: SecurityAuditEntry[];
  resourceAlerts: ResourceAlert[];
  performance: PerformanceMetric[];
  eventTimeline: EventTimelineEntry[];
  alerts: Alert[];
}

// ─── Operational Console ───────────────────────────────────────────────────

export class OperationalConsole {
  private securityAuditLog: SecurityAuditEntry[] = [];
  private performanceHistory: PerformanceMetric[] = [];
  private eventTimeline: EventTimelineEntry[] = [];
  private alerts: Alert[] = [];
  private offlineStatus: OfflineStatus | null = null;
  private resourceThresholds = {
    RU_WARNING: 0.80,
    RU_CRITICAL: 0.95,
    MU_WARNING: 0.80,
    MU_CRITICAL: 0.95,
    EU_WARNING: 0.80,
    EU_CRITICAL: 0.95,
    VU_WARNING: 0.80,
    VU_CRITICAL: 0.95,
  };
  private maxAuditEntries = 500;
  private maxPerformanceEntries = 100;
  private maxTimelineEntries = 200;

  /**
   * Update the offline runtime status.
   */
  updateOfflineStatus(status: OfflineStatus): void {
    this.offlineStatus = status;

    // Alert on mode transitions
    if (status.mode === 'offline') {
      this.addAlert('P2', `System transitioned to OFFLINE mode — queue depth ${status.queueDepth}`, 'offline-runtime');
    }
    if (status.syncStatus === 'error') {
      this.addAlert('P1', `Synchronization error in offline runtime`, 'offline-runtime');
    }
    if (status.queueDepth > status.queueMaxSize * 0.8) {
      this.addAlert('P1', `Queue near capacity: ${status.queueDepth}/${status.queueMaxSize}`, 'offline-runtime');
    }
  }

  /**
   * Record a security check result.
   */
  recordSecurityCheck(entry: SecurityAuditEntry): void {
    this.securityAuditLog.push(entry);
    if (this.securityAuditLog.length > this.maxAuditEntries) {
      this.securityAuditLog.shift();
    }

    // Alert on security failures
    if (!entry.passed) {
      const severity = entry.checkType === 'pre-invoke' ? 'P1' : 'P2';
      this.addAlert(
        severity as AlertSeverity,
        `Security ${entry.checkType} check failed: ${entry.checkName} — ${entry.detail}`,
        'security-hypervisor',
      );
    }
  }

  /**
   * Record a performance metric sample.
   */
  recordPerformance(metric: PerformanceMetric): void {
    this.performanceHistory.push(metric);
    if (this.performanceHistory.length > this.maxPerformanceEntries) {
      this.performanceHistory.shift();
    }

    // Alert on high error rates
    if (metric.errorRate > 0.2) {
      this.addAlert('P1', `High error rate: ${(metric.errorRate * 100).toFixed(1)}%`, 'performance-monitor');
    }
  }

  /**
   * Record an event in the timeline.
   */
  recordEvent(event: Event): void {
    const entry: EventTimelineEntry = {
      eventId: event.id as string,
      timestamp: event.timestamp,
      domain: event.domain as string,
      type: event.type,
      source: event.source,
      summary: this.summarizeEvent(event),
    };
    this.eventTimeline.push(entry);
    if (this.eventTimeline.length > this.maxTimelineEntries) {
      this.eventTimeline.shift();
    }
  }

  /**
   * Evaluate resource usage and generate alerts.
   */
  evaluateResources(
    consumed: { ru: number; mu: number; eu: number; vu: number },
    allocated: { ru: number; mu: number; eu: number; vu: number },
  ): ResourceAlert[] {
    const alerts: ResourceAlert[] = [];
    const types: Array<{ key: 'RU' | 'MU' | 'EU' | 'VU'; consumed: number; allocated: number }> = [
      { key: 'RU', consumed: consumed.ru, allocated: allocated.ru },
      { key: 'MU', consumed: consumed.mu, allocated: allocated.mu },
      { key: 'EU', consumed: consumed.eu, allocated: allocated.eu },
      { key: 'VU', consumed: consumed.vu, allocated: allocated.vu },
    ];

    for (const { key, consumed: c, allocated: a } of types) {
      if (a === 0) continue;
      const utilization = c / a;
      if (utilization >= this.resourceThresholds[`${key}_CRITICAL` as keyof typeof this.resourceThresholds]) {
        const alert: ResourceAlert = {
          resourceType: key,
          threshold: this.resourceThresholds[`${key}_CRITICAL` as keyof typeof this.resourceThresholds],
          current: utilization,
          allocated: a,
          severity: 'P0',
          message: `${key} CRITICAL: ${(utilization * 100).toFixed(1)}% utilized (${c}/${a})`,
        };
        alerts.push(alert);
        this.addAlert('P0', alert.message, 'resource-scheduler');
      } else if (utilization >= this.resourceThresholds[`${key}_WARNING` as keyof typeof this.resourceThresholds]) {
        const alert: ResourceAlert = {
          resourceType: key,
          threshold: this.resourceThresholds[`${key}_WARNING` as keyof typeof this.resourceThresholds],
          current: utilization,
          allocated: a,
          severity: 'P2',
          message: `${key} WARNING: ${(utilization * 100).toFixed(1)}% utilized (${c}/${a})`,
        };
        alerts.push(alert);
      }
    }

    return alerts;
  }

  /**
   * Add an alert.
   */
  addAlert(severity: AlertSeverity, message: string, source: string): void {
    this.alerts.push({
      severity,
      message,
      timestamp: new Date().toISOString(),
      source,
    });
    // Keep last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts.shift();
    }
  }

  /**
   * Produce the full operational console data.
   */
  getConsoleData(baseSnapshot?: MissionControlSnapshot): OperationalConsoleData {
    return {
      timestamp: Date.now(),
      baseSnapshot: baseSnapshot ?? null,
      offline: this.offlineStatus,
      securityAudit: [...this.securityAuditLog],
      resourceAlerts: this.evaluateResources(
        baseSnapshot?.resources.consumed ?? { ru: 0, mu: 0, eu: 0, vu: 0 },
        baseSnapshot?.resources.allocated ?? { ru: 0, mu: 0, eu: 0, vu: 0 },
      ),
      performance: [...this.performanceHistory],
      eventTimeline: [...this.eventTimeline],
      alerts: [...this.alerts],
    };
  }

  /**
   * Render the full operational console as a formatted string.
   */
  render(baseSnapshot?: MissionControlSnapshot): string {
    const data = this.getConsoleData(baseSnapshot);
    const lines: string[] = [];

    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('           MISSION CONTROL — OPERATIONAL CONSOLE           ');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');

    // Offline status
    if (data.offline) {
      const o = data.offline;
      lines.push('── OFFLINE RUNTIME ──────────────────────────────────────');
      const modeIcon = o.mode === 'online' ? '●' : o.mode === 'hybrid' ? '◐' : '○';
      lines.push(`  Mode: ${modeIcon} ${o.mode.toUpperCase()}`);
      lines.push(`  Queue: ${o.queueDepth}/${o.queueMaxSize}  Sync: ${o.syncStatus}`);
      lines.push(`  Artifact Cache: ${o.artifactCacheEntries} entries, ${(o.artifactCacheHitRate * 100).toFixed(1)}% hit`);
      lines.push(`  Memory Cache: ${o.memoryCacheEntries} entries, ${o.memoryBufferedWrites} buffered writes`);
      lines.push(`  Local Models: ${o.localModelsAvailable} available, ${o.inferenceSlotsUsed}/${o.inferenceSlotsTotal} inference slots`);
      lines.push('');
    }

    // Alerts
    if (data.alerts.length > 0) {
      lines.push('── ALERTS ────────────────────────────────────────────────');
      const recentAlerts = data.alerts.slice(-10);
      for (const a of recentAlerts) {
        const icon = a.severity === 'P0' ? '🔴' : a.severity === 'P1' ? '🟡' : a.severity === 'P2' ? '🔵' : '⚪';
        lines.push(`  ${icon} [${a.severity}] ${a.message}`);
        lines.push(`       source: ${a.source}  at: ${a.timestamp}`);
      }
      lines.push('');
    }

    // Resource alerts
    if (data.resourceAlerts.length > 0) {
      lines.push('── RESOURCE ALERTS ───────────────────────────────────────');
      for (const r of data.resourceAlerts) {
        const icon = r.severity === 'P0' ? '🔴' : '🟡';
        lines.push(`  ${icon} ${r.message}`);
      }
      lines.push('');
    }

    // Security audit (recent)
    if (data.securityAudit.length > 0) {
      lines.push('── SECURITY AUDIT (recent) ──────────────────────────────');
      const recent = data.securityAudit.slice(-10);
      for (const s of recent) {
        const status = s.passed ? '✓' : '✗';
        lines.push(`  ${status} [${s.checkType}] ${s.checkName}: ${s.detail}`);
      }
      lines.push('');
    }

    // Performance
    if (data.performance.length > 0) {
      lines.push('── PERFORMANCE ──────────────────────────────────────────');
      const latest = data.performance[data.performance.length - 1]!;
      lines.push(`  Latency: ${latest.latencyMs.toFixed(0)}ms`);
      lines.push(`  Throughput: ${latest.throughputOpsPerSec.toFixed(1)} ops/s`);
      lines.push(`  Error rate: ${(latest.errorRate * 100).toFixed(1)}%`);
      lines.push(`  Completion rate: ${(latest.completionRate * 100).toFixed(1)}%`);
      if (data.performance.length > 1) {
        const prev = data.performance[data.performance.length - 2]!;
        const latencyTrend = latest.latencyMs - prev.latencyMs;
        const throughputTrend = latest.throughputOpsPerSec - prev.throughputOpsPerSec;
        lines.push(`  Trends: latency ${latencyTrend > 0 ? '↑' : '↓'}${Math.abs(latencyTrend).toFixed(0)}ms, throughput ${throughputTrend > 0 ? '↑' : '↓'}${Math.abs(throughputTrend).toFixed(1)} ops/s`);
      }
      lines.push('');
    }

    // Event timeline (recent)
    if (data.eventTimeline.length > 0) {
      lines.push('── EVENT TIMELINE (recent) ──────────────────────────────');
      const recent = data.eventTimeline.slice(-10);
      for (const e of recent) {
        lines.push(`  [${e.domain}] ${e.type} from ${e.source}`);
        lines.push(`    ${e.summary}`);
      }
      lines.push('');
    }

    lines.push('═══════════════════════════════════════════════════════════');
    return lines.join('\n');
  }

  /**
   * Clear all collected data.
   */
  reset(): void {
    this.securityAuditLog = [];
    this.performanceHistory = [];
    this.eventTimeline = [];
    this.alerts = [];
    this.offlineStatus = null;
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private summarizeEvent(event: Event): string {
    const data = event.data as Record<string, unknown>;
    const parts: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' || typeof value === 'number') {
        parts.push(`${key}=${value}`);
      } else {
        parts.push(`${key}=<object>`);
      }
      if (parts.length >= 3) break;
    }
    return parts.join(', ');
  }
}