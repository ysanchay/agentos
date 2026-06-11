/**
 * @agentos/simulation — Simulation Reporter
 * Collects metrics and produces a final report.
 */

import type { AgentID, TaskID } from '@agentos/types';

export interface SimulationMetrics {
  /** Total simulation time in ms */
  totalDurationMs: number;

  /** Agent metrics */
  agents: {
    total: number;
    completed: number;
    failed: number;
    active: number;
  };

  /** Task metrics */
  tasks: {
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    pending: number;
  };

  /** Resource metrics */
  resources: {
    ruAllocated: number;
    ruConsumed: number;
    muAllocated: number;
    muConsumed: number;
    euAllocated: number;
    euConsumed: number;
    vuAllocated: number;
    vuConsumed: number;
  };

  /** Claim metrics */
  claims: {
    totalClaims: number;
    successfulClaims: number;
    failedClaims: number;
    overrides: number;
    releases: number;
    doubleClaims: number;
  };

  /** Verification results */
  verification: VerificationResults;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  message: string;
  details?: unknown;
}

export interface VerificationResults {
  /** All 10 checks must pass */
  checks: VerificationCheck[];
  allPassed: boolean;
  passedCount: number;
  failedCount: number;
}

// ─── SimulationReporter ──────────────────────────────────────────────────

export class SimulationReporter {
  private metrics: Partial<SimulationMetrics> = {};
  private events: Array<{ timestamp: number; type: string; data: unknown }> = [];

  /**
   * Record a simulation event.
   */
  recordEvent(type: string, data: unknown): void {
    this.events.push({
      timestamp: Date.now(),
      type,
      data,
    });
  }

  /**
   * Update agent metrics.
   */
  updateAgentMetrics(metrics: SimulationMetrics['agents']): void {
    this.metrics.agents = metrics;
  }

  /**
   * Update task metrics.
   */
  updateTaskMetrics(metrics: SimulationMetrics['tasks']): void {
    this.metrics.tasks = metrics;
  }

  /**
   * Update resource metrics.
   */
  updateResourceMetrics(metrics: SimulationMetrics['resources']): void {
    this.metrics.resources = metrics;
  }

  /**
   * Update claim metrics.
   */
  updateClaimMetrics(metrics: SimulationMetrics['claims']): void {
    this.metrics.claims = metrics;
  }

  /**
   * Set the total duration.
   */
  setDuration(ms: number): void {
    this.metrics.totalDurationMs = ms;
  }

  /**
   * Set verification results.
   */
  setVerificationResults(results: VerificationResults): void {
    this.metrics.verification = results;
  }

  /**
   * Generate the final report.
   */
  generateReport(): SimulationMetrics {
    return {
      totalDurationMs: this.metrics.totalDurationMs ?? 0,
      agents: this.metrics.agents ?? { total: 0, completed: 0, failed: 0, active: 0 },
      tasks: this.metrics.tasks ?? { total: 0, completed: 0, failed: 0, cancelled: 0, pending: 0 },
      resources: this.metrics.resources ?? {
        ruAllocated: 0, ruConsumed: 0,
        muAllocated: 0, muConsumed: 0,
        euAllocated: 0, euConsumed: 0,
        vuAllocated: 0, vuConsumed: 0,
      },
      claims: this.metrics.claims ?? {
        totalClaims: 0, successfulClaims: 0, failedClaims: 0,
        overrides: 0, releases: 0, doubleClaims: 0,
      },
      verification: this.metrics.verification ?? {
        checks: [],
        allPassed: false,
        passedCount: 0,
        failedCount: 0,
      },
    };
  }

  /**
   * Print a formatted report to stdout.
   */
  printReport(): string {
    const report = this.generateReport();
    const lines: string[] = [
      '',
      '═══════════════════════════════════════════════════════════════════════',
      '  AgentOS Simulation Report',
      '═══════════════════════════════════════════════════════════════════════',
      '',
      `  Duration: ${report.totalDurationMs}ms`,
      '',
      '  AGENTS',
      `    Total:     ${report.agents.total}`,
      `    Completed: ${report.agents.completed}`,
      `    Failed:    ${report.agents.failed}`,
      `    Active:    ${report.agents.active}`,
      '',
      '  TASKS',
      `    Total:     ${report.tasks.total}`,
      `    Completed: ${report.tasks.completed}`,
      `    Failed:    ${report.tasks.failed}`,
      `    Cancelled: ${report.tasks.cancelled}`,
      `    Pending:   ${report.tasks.pending}`,
      '',
      '  CLAIMS',
      `    Total:      ${report.claims.totalClaims}`,
      `    Successful: ${report.claims.successfulClaims}`,
      `    Failed:      ${report.claims.failedClaims}`,
      `    Overrides:   ${report.claims.overrides}`,
      `    Releases:    ${report.claims.releases}`,
      `    Double:     ${report.claims.doubleClaims}`,
      '',
      '  RESOURCES',
      `    RU: ${report.resources.ruConsumed}/${report.resources.ruAllocated} consumed/allocated`,
      `    MU: ${report.resources.muConsumed}/${report.resources.muAllocated} consumed/allocated`,
      `    EU: ${report.resources.euConsumed}/${report.resources.euAllocated} consumed/allocated`,
      `    VU: ${report.resources.vuConsumed}/${report.resources.vuAllocated} consumed/allocated`,
      '',
      '  VERIFICATION',
    ];

    if (report.verification.checks.length > 0) {
      for (const check of report.verification.checks) {
        const icon = check.passed ? '✅' : '❌';
        lines.push(`    ${icon} ${check.name}: ${check.message}`);
      }
    }
    lines.push('');
    lines.push(`  Result: ${report.verification.allPassed ? '✅ ALL CHECKS PASSED' : '❌ SOME CHECKS FAILED'}`);
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════════════════');
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Get all recorded events.
   */
  getEvents(): Array<{ timestamp: number; type: string; data: unknown }> {
    return [...this.events];
  }
}