/**
 * @agentos/benchmarks — User Feedback Collection System
 * Collects per-task feedback, weekly surveys, and bug reports from
 * internal dogfooding and external alpha users.
 *
 * INTERNAL_DOGFOODING.md §4-5 — feedback requirements.
 * EXTERNAL_ALPHA_PROGRAM.md §5 — feedback forms.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface TaskFeedback {
  taskId: string;
  sessionId: string;
  userId: string;
  timestamp: string;
  taskDescription: string;
  setupTimeMin: number;
  agentosTimeMin: number;
  manualTimeEstimateMin: number;
  resultQuality: number;       // 1-5
  wouldUseAgain: 'yes' | 'no' | 'maybe';
  interventionNeeded: 'none' | 'minor' | 'moderate' | 'significant' | 'redo-manual';
  whatWorkedWell: string;
  whatWasFrustrating: string;
  whatWasMissing: string;
}

export interface WeeklySurvey {
  userId: string;
  weekOf: string;
  timestamp: string;
  tasksAttempted: number;
  tasksCompleted: number;
  tasksPartial: number;
  tasksFailed: number;
  satisfaction: number;        // 1-5
  wouldRecommend: 'yes' | 'no' | 'maybe';
  mostValuableTask: string;
  mostFrustratingExperience: string;
  biggestBarrier: string;
  featureWish: string;
  estimatedTimeSavedHours: number;
}

export interface BugReport {
  id: string;
  date: string;
  reporter: string;
  task: string;
  expected: string;
  actual: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  reproducibility: 'always' | 'sometimes' | 'once';
  sessionId: string;
  steps: string[];
  attachmentPath?: string;
}

export interface FeedbackSummary {
  totalTaskFeedback: number;
  totalWeeklySurveys: number;
  totalBugReports: number;
  avgResultQuality: number;
  avgSatisfaction: number;
  wouldUseAgainRate: number;
  wouldRecommendRate: number;
  avgTimeSavedMin: number;
  interventionBreakdown: Record<string, number>;
  topFrictionPoints: Array<{ count: number; text: string }>;
  topFeatureRequests: Array<{ count: number; text: string }>;
  bugSeverityBreakdown: Record<string, number>;
}

// ─── FeedbackCollector ─────────────────────────────────────────────────────

export class FeedbackCollector {
  private dataDir: string;
  private taskFeedback: TaskFeedback[] = [];
  private weeklySurveys: WeeklySurvey[] = [];
  private bugReports: BugReport[] = [];

  constructor(dataDir: string = '.agentos/feedback') {
    this.dataDir = dataDir;
    this.ensureDataDir();
  }

  /**
   * Record per-task feedback.
   */
  recordTaskFeedback(feedback: TaskFeedback): void {
    this.taskFeedback.push(feedback);
    this.appendToJsonl('task-feedback.jsonl', feedback);
  }

  /**
   * Record a weekly survey.
   */
  recordWeeklySurvey(survey: WeeklySurvey): void {
    this.weeklySurveys.push(survey);
    this.appendToJsonl('weekly-surveys.jsonl', survey);
  }

  /**
   * Record a bug report.
   */
  recordBugReport(report: Omit<BugReport, 'id'>): string {
    const id = `BUG-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const fullReport: BugReport = { ...report, id };
    this.bugReports.push(fullReport);
    this.appendToJsonl('bug-reports.jsonl', fullReport);
    return id;
  }

  /**
   * Get all task feedback.
   */
  getTaskFeedback(): TaskFeedback[] {
    return [...this.taskFeedback];
  }

  /**
   * Get all weekly surveys.
   */
  getWeeklySurveys(): WeeklySurvey[] {
    return [...this.weeklySurveys];
  }

  /**
   * Get all bug reports.
   */
  getBugReports(): BugReport[] {
    return [...this.bugReports];
  }

  /**
   * Compute aggregate feedback summary.
   */
  getSummary(): FeedbackSummary {
    const totalTask = this.taskFeedback.length;

    const avgResultQuality = totalTask > 0
      ? this.taskFeedback.reduce((s, f) => s + f.resultQuality, 0) / totalTask : 0;

    const wouldUseAgain = this.taskFeedback.filter(f => f.wouldUseAgain === 'yes').length;
    const wouldUseAgainRate = totalTask > 0 ? wouldUseAgain / totalTask : 0;

    const avgTimeSaved = totalTask > 0
      ? this.taskFeedback.reduce((s, f) => s + (f.manualTimeEstimateMin - f.agentosTimeMin), 0) / totalTask : 0;

    // Intervention breakdown
    const interventionBreakdown: Record<string, number> = {};
    for (const f of this.taskFeedback) {
      interventionBreakdown[f.interventionNeeded] = (interventionBreakdown[f.interventionNeeded] ?? 0) + 1;
    }

    // Top friction points (from "whatWasFrustrating" field)
    const frictionMap = new Map<string, number>();
    for (const f of this.taskFeedback) {
      if (f.whatWasFrustrating.trim()) {
        const key = f.whatWasFrustrating.trim().toLowerCase().slice(0, 80);
        frictionMap.set(key, (frictionMap.get(key) ?? 0) + 1);
      }
    }
    const topFrictionPoints = Array.from(frictionMap.entries())
      .map(([text, count]) => ({ count, text }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Top feature requests (from weekly surveys "featureWish")
    const featureMap = new Map<string, number>();
    for (const s of this.weeklySurveys) {
      if (s.featureWish.trim()) {
        const key = s.featureWish.trim().toLowerCase().slice(0, 80);
        featureMap.set(key, (featureMap.get(key) ?? 0) + 1);
      }
    }
    const topFeatureRequests = Array.from(featureMap.entries())
      .map(([text, count]) => ({ count, text }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Bug severity breakdown
    const bugSeverityBreakdown: Record<string, number> = {};
    for (const b of this.bugReports) {
      bugSeverityBreakdown[b.severity] = (bugSeverityBreakdown[b.severity] ?? 0) + 1;
    }

    // Weekly survey aggregates
    const totalSurveys = this.weeklySurveys.length;
    const avgSatisfaction = totalSurveys > 0
      ? this.weeklySurveys.reduce((s, w) => s + w.satisfaction, 0) / totalSurveys : 0;
    const wouldRecommend = this.weeklySurveys.filter(w => w.wouldRecommend === 'yes').length;
    const wouldRecommendRate = totalSurveys > 0 ? wouldRecommend / totalSurveys : 0;

    return {
      totalTaskFeedback: totalTask,
      totalWeeklySurveys: totalSurveys,
      totalBugReports: this.bugReports.length,
      avgResultQuality,
      avgSatisfaction,
      wouldUseAgainRate,
      wouldRecommendRate,
      avgTimeSavedMin: avgTimeSaved,
      interventionBreakdown,
      topFrictionPoints,
      topFeatureRequests,
      bugSeverityBreakdown,
    };
  }

  /**
   * Export all feedback as a single JSON file.
   */
  exportAll(filePath: string): void {
    const data = {
      exportedAt: new Date().toISOString(),
      taskFeedback: this.taskFeedback,
      weeklySurveys: this.weeklySurveys,
      bugReports: this.bugReports,
      summary: this.getSummary(),
    };
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Render a human-readable feedback report.
   */
  renderReport(): string {
    const s = this.getSummary();
    const lines: string[] = [];

    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('  AgentOS Alpha — User Feedback Report');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');
    lines.push('  Feedback Volume:');
    lines.push(`    Task feedback:     ${s.totalTaskFeedback}`);
    lines.push(`    Weekly surveys:    ${s.totalWeeklySurveys}`);
    lines.push(`    Bug reports:       ${s.totalBugReports}`);
    lines.push('');
    lines.push('  User Satisfaction:');
    lines.push(`    Avg result quality: ${s.avgResultQuality.toFixed(1)}/5`);
    lines.push(`    Avg satisfaction:   ${s.avgSatisfaction.toFixed(1)}/5`);
    lines.push(`    Would use again:    ${(s.wouldUseAgainRate * 100).toFixed(0)}%`);
    lines.push(`    Would recommend:    ${(s.wouldRecommendRate * 100).toFixed(0)}%`);
    lines.push(`    Avg time saved:     ${s.avgTimeSavedMin.toFixed(0)} min/task`);
    lines.push('');
    lines.push('  Intervention Breakdown:');
    for (const [type, count] of Object.entries(s.interventionBreakdown)) {
      lines.push(`    ${type.padEnd(20)} ${count}`);
    }
    lines.push('');
    lines.push('  Top Friction Points:');
    for (const f of s.topFrictionPoints.slice(0, 5)) {
      lines.push(`    [${f.count}x] ${f.text}`);
    }
    lines.push('');
    lines.push('  Top Feature Requests:');
    for (const f of s.topFeatureRequests.slice(0, 5)) {
      lines.push(`    [${f.count}x] ${f.text}`);
    }
    lines.push('');
    lines.push('  Bug Severity Breakdown:');
    for (const [sev, count] of Object.entries(s.bugSeverityBreakdown)) {
      lines.push(`    ${sev}: ${count}`);
    }
    lines.push('');
    lines.push('═══════════════════════════════════════════════════════════');
    return lines.join('\n');
  }

  /**
   * Clear all feedback data.
   */
  clear(): void {
    this.taskFeedback = [];
    this.weeklySurveys = [];
    this.bugReports = [];
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private ensureDataDir(): void {
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private appendToJsonl(filename: string, data: unknown): void {
    const path = join(this.dataDir, filename);
    appendFileSync(path, JSON.stringify(data) + '\n', 'utf-8');
  }
}