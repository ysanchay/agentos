import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FeedbackCollector, type TaskFeedback, type WeeklySurvey } from '../src/feedback-collector.js';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeTaskFeedback(overrides: Partial<TaskFeedback> = {}): TaskFeedback {
  return {
    taskId: overrides.taskId ?? 'task-1',
    sessionId: overrides.sessionId ?? 'session-1',
    userId: overrides.userId ?? 'user-1',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    taskDescription: overrides.taskDescription ?? 'Research competitors',
    setupTimeMin: overrides.setupTimeMin ?? 2,
    agentosTimeMin: overrides.agentosTimeMin ?? 5,
    manualTimeEstimateMin: overrides.manualTimeEstimateMin ?? 30,
    resultQuality: overrides.resultQuality ?? 4,
    wouldUseAgain: overrides.wouldUseAgain ?? 'yes',
    interventionNeeded: overrides.interventionNeeded ?? 'none',
    whatWorkedWell: overrides.whatWorkedWell ?? 'Fast and accurate',
    whatWasFrustrating: overrides.whatWasFrustrating ?? 'Setup took too long',
    whatWasMissing: overrides.whatWasMissing ?? 'More detail in report',
  };
}

function makeWeeklySurvey(overrides: Partial<WeeklySurvey> = {}): WeeklySurvey {
  return {
    userId: overrides.userId ?? 'user-1',
    weekOf: overrides.weekOf ?? '2026-06-23',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    tasksAttempted: overrides.tasksAttempted ?? 10,
    tasksCompleted: overrides.tasksCompleted ?? 8,
    tasksPartial: overrides.tasksPartial ?? 1,
    tasksFailed: overrides.tasksFailed ?? 1,
    satisfaction: overrides.satisfaction ?? 4,
    wouldRecommend: overrides.wouldRecommend ?? 'yes',
    mostValuableTask: overrides.mostValuableTask ?? 'Code review',
    mostFrustratingExperience: overrides.mostFrustratingExperience ?? 'Browser automation was slow',
    biggestBarrier: overrides.biggestBarrier ?? 'Configuration complexity',
    featureWish: overrides.featureWish ?? 'Better error messages',
    estimatedTimeSavedHours: overrides.estimatedTimeSavedHours ?? 5,
  };
}

describe('FeedbackCollector', () => {
  let tempDir: string;
  let collector: FeedbackCollector;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agentos-feedback-'));
    collector = new FeedbackCollector(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('records and retrieves task feedback', () => {
    collector.recordTaskFeedback(makeTaskFeedback());
    collector.recordTaskFeedback(makeTaskFeedback({ taskId: 'task-2', resultQuality: 2, wouldUseAgain: 'no' }));

    const feedback = collector.getTaskFeedback();
    expect(feedback).toHaveLength(2);
    expect(feedback[0]!.taskId).toBe('task-1');
    expect(feedback[1]!.resultQuality).toBe(2);
  });

  it('records and retrieves weekly surveys', () => {
    collector.recordWeeklySurvey(makeWeeklySurvey());
    collector.recordWeeklySurvey(makeWeeklySurvey({ userId: 'user-2', satisfaction: 2 }));

    const surveys = collector.getWeeklySurveys();
    expect(surveys).toHaveLength(2);
    expect(surveys[1]!.userId).toBe('user-2');
  });

  it('records bug reports with generated IDs', () => {
    const bugId = collector.recordBugReport({
      date: new Date().toISOString(),
      reporter: 'user-1',
      task: 'File organization',
      expected: 'Files sorted into folders',
      actual: 'Files deleted',
      severity: 'P0',
      reproducibility: 'always',
      sessionId: 'session-1',
      steps: ['1. Run task', '2. Observe output'],
    });

    expect(bugId).toMatch(/^BUG-/);
    const bugs = collector.getBugReports();
    expect(bugs).toHaveLength(1);
    expect(bugs[0]!.severity).toBe('P0');
  });

  it('computes summary with satisfaction and friction metrics', () => {
    collector.recordTaskFeedback(makeTaskFeedback({ resultQuality: 5, wouldUseAgain: 'yes', whatWasFrustrating: 'slow setup' }));
    collector.recordTaskFeedback(makeTaskFeedback({ taskId: 't2', resultQuality: 3, wouldUseAgain: 'maybe', whatWasFrustrating: 'slow setup' }));
    collector.recordTaskFeedback(makeTaskFeedback({ taskId: 't3', resultQuality: 2, wouldUseAgain: 'no', whatWasFrustrating: 'crashed' }));
    collector.recordWeeklySurvey(makeWeeklySurvey({ satisfaction: 4, wouldRecommend: 'yes' }));
    collector.recordWeeklySurvey(makeWeeklySurvey({ userId: 'u2', satisfaction: 2, wouldRecommend: 'no' }));

    const summary = collector.getSummary();
    expect(summary.totalTaskFeedback).toBe(3);
    expect(summary.avgResultQuality).toBeCloseTo(3.33, 1);
    expect(summary.wouldUseAgainRate).toBeCloseTo(0.33, 1);
    expect(summary.avgSatisfaction).toBe(3);
    expect(summary.wouldRecommendRate).toBe(0.5);
    expect(summary.topFrictionPoints[0]!.text).toContain('slow setup');
    expect(summary.topFrictionPoints[0]!.count).toBe(2);
  });

  it('renders human-readable report', () => {
    collector.recordTaskFeedback(makeTaskFeedback());
    collector.recordWeeklySurvey(makeWeeklySurvey());

    const report = collector.renderReport();
    expect(report).toContain('User Feedback Report');
    expect(report).toContain('Task feedback:     1');
    expect(report).toContain('Would use again');
  });

  it('exports all feedback as JSON', () => {
    collector.recordTaskFeedback(makeTaskFeedback());
    collector.recordWeeklySurvey(makeWeeklySurvey());

    const exportPath = join(tempDir, 'export.json');
    collector.exportAll(exportPath);

    const data = JSON.parse(readFileSync(exportPath, 'utf-8') as unknown as string);
    expect(data.taskFeedback).toHaveLength(1);
    expect(data.summary.totalTaskFeedback).toBe(1);
  });

  it('clears all data', () => {
    collector.recordTaskFeedback(makeTaskFeedback());
    collector.recordWeeklySurvey(makeWeeklySurvey());
    collector.recordBugReport({
      date: new Date().toISOString(),
      reporter: 'user-1',
      task: 'test',
      expected: 'x',
      actual: 'y',
      severity: 'P2',
      reproducibility: 'once',
      sessionId: 's1',
      steps: [],
    });

    collector.clear();
    expect(collector.getTaskFeedback()).toHaveLength(0);
    expect(collector.getWeeklySurveys()).toHaveLength(0);
    expect(collector.getBugReports()).toHaveLength(0);
  });
});