/**
 * @agentos/benchmarks — Production Telemetry Collector
 * Persists operational data from real-world task executions for
 * Reputation Engine calibration, scheduling optimization, and
 * production observability.
 *
 * ALPHA_FREEZE.md §2.3 — observability enhancement (allowed change).
 * PRODUCTION_HARDENING.md §7 — telemetry schema.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ─── Telemetry Types ───────────────────────────────────────────────────────

export interface CapabilityUsageRecord {
  path: string;
  provider: string;
  latencyMs: number;
  success: boolean;
  resourceConsumption: { ru: number; mu: number; eu: number; vu: number };
}

export interface TaskTelemetry {
  taskId: string;
  workspaceId: string;
  goalId: string;
  category: string;
  submittedAt: string;
  completedAt: string | null;
  latencyMs: number;
  status: 'completed' | 'failed' | 'partial' | 'timeout';

  capabilitiesUsed: CapabilityUsageRecord[];
  agentsInvolved: number;
  agentsByType: { chief: number; manager: number; worker: number; validator: number };

  validationResult: 'approved' | 'rejected' | 'partial';
  validationAccuracy: number;
  validationConfidence: number;

  failuresInjected: number;
  failuresRecovered: number;
  recoveryTimeMs: number;

  securityChecksRun: number;
  securityChecksPassed: number;
  securityDenials: number;
  approvalGatesTriggered: number;

  modeTransitions: number;
  queueDepth: number;
  syncEvents: number;

  userInterventions: number;
  interventionType: string | null;

  invariantViolations: number;
  constitutionalCompliance: number;
}

export interface SessionTelemetry {
  sessionId: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  partialTasks: number;
  timedOutTasks: number;
  totalLatencyMs: number;
  userInterventions: number;
  securityDenials: number;
  offlineTransitions: number;
  invariantViolations: number;
  tasks: TaskTelemetry[];
}

export interface TelemetrySummary {
  totalSessions: number;
  totalTasks: number;
  completionRate: number;
  avgLatencyMs: number;
  avgValidationAccuracy: number;
  totalResourceConsumption: { ru: number; mu: number; eu: number; vu: number };
  topCapabilities: Array<{ path: string; uses: number; successRate: number; avgLatencyMs: number }>;
  categoryBreakdown: Record<string, { total: number; completed: number; avgLatencyMs: number }>;
}

// ─── TelemetryCollector ────────────────────────────────────────────────────

export class TelemetryCollector {
  private dataDir: string;
  private currentSession: SessionTelemetry | null = null;
  private sessions: SessionTelemetry[] = [];

  constructor(dataDir: string = '.agentos/telemetry') {
    this.dataDir = dataDir;
    this.ensureDataDir();
    this.loadExistingSessions();
  }

  /**
   * Start a new user session.
   */
  startSession(userId: string, sessionId?: string): string {
    const id = sessionId ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.currentSession = {
      sessionId: id,
      userId,
      startedAt: new Date().toISOString(),
      endedAt: null,
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      partialTasks: 0,
      timedOutTasks: 0,
      totalLatencyMs: 0,
      userInterventions: 0,
      securityDenials: 0,
      offlineTransitions: 0,
      invariantViolations: 0,
      tasks: [],
    };
    return id;
  }

  /**
   * Record a completed task's telemetry.
   */
  recordTask(task: TaskTelemetry): void {
    if (!this.currentSession) {
      throw new Error('No active session — call startSession() first');
    }

    this.currentSession.tasks.push(task);
    this.currentSession.totalTasks++;
    this.currentSession.totalLatencyMs += task.latencyMs;

    switch (task.status) {
      case 'completed': this.currentSession.completedTasks++; break;
      case 'failed': this.currentSession.failedTasks++; break;
      case 'partial': this.currentSession.partialTasks++; break;
      case 'timeout': this.currentSession.timedOutTasks++; break;
    }

    this.currentSession.userInterventions += task.userInterventions;
    this.currentSession.securityDenials += task.securityDenials;
    this.currentSession.offlineTransitions += task.modeTransitions;
    this.currentSession.invariantViolations += task.invariantViolations;

    // Append to disk (append-only log)
    this.appendTaskToLog(task);
  }

  /**
   * End the current session and persist it.
   */
  endSession(): SessionTelemetry | null {
    if (!this.currentSession) return null;

    this.currentSession.endedAt = new Date().toISOString();
    this.sessions.push(this.currentSession);

    // Persist to disk
    const sessionPath = join(this.dataDir, `session-${this.currentSession.sessionId}.json`);
    writeFileSync(sessionPath, JSON.stringify(this.currentSession, null, 2), 'utf-8');

    const completed = this.currentSession;
    this.currentSession = null;
    return completed;
  }

  /**
   * Get all recorded sessions.
   */
  getSessions(): SessionTelemetry[] {
    return [...this.sessions];
  }

  /**
   * Compute aggregate telemetry summary across all sessions.
   */
  getSummary(): TelemetrySummary {
    const allTasks = this.sessions.flatMap((s) => s.tasks);
    const totalTasks = allTasks.length;
    const completed = allTasks.filter((t) => t.status === 'completed').length;

    // Resource totals
    const totalRU = allTasks.reduce((sum, t) =>
      sum + t.capabilitiesUsed.reduce((s, c) => s + c.resourceConsumption.ru, 0), 0);
    const totalMU = allTasks.reduce((sum, t) =>
      sum + t.capabilitiesUsed.reduce((s, c) => s + c.resourceConsumption.mu, 0), 0);
    const totalEU = allTasks.reduce((sum, t) =>
      sum + t.capabilitiesUsed.reduce((s, c) => s + c.resourceConsumption.eu, 0), 0);
    const totalVU = allTasks.reduce((sum, t) =>
      sum + t.capabilitiesUsed.reduce((s, c) => s + c.resourceConsumption.vu, 0), 0);

    // Top capabilities
    const capMap = new Map<string, { uses: number; successes: number; totalLatency: number }>();
    for (const task of allTasks) {
      for (const cap of task.capabilitiesUsed) {
        const existing = capMap.get(cap.path) ?? { uses: 0, successes: 0, totalLatency: 0 };
        existing.uses++;
        if (cap.success) existing.successes++;
        existing.totalLatency += cap.latencyMs;
        capMap.set(cap.path, existing);
      }
    }
    const topCapabilities = Array.from(capMap.entries())
      .map(([path, data]) => ({
        path,
        uses: data.uses,
        successRate: data.uses > 0 ? data.successes / data.uses : 0,
        avgLatencyMs: data.uses > 0 ? data.totalLatency / data.uses : 0,
      }))
      .sort((a, b) => b.uses - a.uses);

    // Category breakdown
    const categoryBreakdown: Record<string, { total: number; completed: number; avgLatencyMs: number }> = {};
    for (const task of allTasks) {
      const cat = task.category;
      if (!categoryBreakdown[cat]) {
        categoryBreakdown[cat] = { total: 0, completed: 0, avgLatencyMs: 0 };
      }
      categoryBreakdown[cat]!.total++;
      if (task.status === 'completed') categoryBreakdown[cat]!.completed++;
      categoryBreakdown[cat]!.avgLatencyMs += task.latencyMs;
    }
    for (const cat of Object.keys(categoryBreakdown)) {
      const c = categoryBreakdown[cat]!;
      c.avgLatencyMs = c.total > 0 ? c.avgLatencyMs / c.total : 0;
    }

    return {
      totalSessions: this.sessions.length,
      totalTasks,
      completionRate: totalTasks > 0 ? completed / totalTasks : 0,
      avgLatencyMs: totalTasks > 0
        ? allTasks.reduce((sum, t) => sum + t.latencyMs, 0) / totalTasks
        : 0,
      avgValidationAccuracy: totalTasks > 0
        ? allTasks.reduce((sum, t) => sum + t.validationAccuracy, 0) / totalTasks
        : 0,
      totalResourceConsumption: { ru: totalRU, mu: totalMU, eu: totalEU, vu: totalVU },
      topCapabilities,
      categoryBreakdown,
    };
  }

  /**
   * Export all telemetry as a single JSON file.
   */
  exportAll(filePath: string): void {
    const data = {
      exportedAt: new Date().toISOString(),
      sessions: this.sessions,
      summary: this.getSummary(),
    };
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Clear all telemetry data (for testing or reset).
   */
  clear(): void {
    this.sessions = [];
    this.currentSession = null;
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private ensureDataDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private loadExistingSessions(): void {
    // Sessions are loaded lazily — could be extended to read all files in dataDir
  }

  private appendTaskToLog(task: TaskTelemetry): void {
    const logPath = join(this.dataDir, 'task-log.jsonl');
    appendFileSync(logPath, JSON.stringify(task) + '\n', 'utf-8');
  }
}