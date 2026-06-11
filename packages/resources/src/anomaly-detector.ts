/**
 * @agentos/resources — Anomaly Detector
 * 5x spike detection and sustained utilization alerts.
 * From resource-model-v1.md Section 10.
 */

import type { AgentID, Outcome } from '@agentos/types';
import { ok, err, KER } from '@agentos/types';
import type { AllocationRecord } from './allocator.js';

// ─── Types ─────────────────────────────────────────────────────────────

export interface AnomalyEvent {
  type: 'spike' | 'sustained_high' | 'sustained_zero' | 'budget_breach' | 'preemption_storm';
  agentId: AgentID;
  metric: string;
  value: number;
  baseline: number;
  detectedAt: string;
  severity: 'warning' | 'critical';
}

export interface AnomalyDetectorConfig {
  /** Spike multiplier threshold (default: 5x = 5.0) */
  spikeMultiplier: number;
  /** Sustained high utilization threshold (default: 0.9 = 90%) */
  sustainedHighThreshold: number;
  /** Sustained high duration in ms (default: 300000 = 5 min) */
  sustainedHighDurationMs: number;
  /** Sustained zero utilization threshold (default: 0.05 = 5%) */
  sustainedZeroThreshold: number;
  /** Sustained zero duration in ms (default: 600000 = 10 min) */
  sustainedZeroDurationMs: number;
  /** Preemption storm threshold (default: 10 in 1 hour) */
  preemptionStormThreshold: number;
  /** Preemption storm window in ms (default: 3600000 = 1 hour) */
  preemptionStormWindowMs: number;
}

const DEFAULT_CONFIG: AnomalyDetectorConfig = {
  spikeMultiplier: 5.0,
  sustainedHighThreshold: 0.9,
  sustainedHighDurationMs: 300_000,
  sustainedZeroThreshold: 0.05,
  sustainedZeroDurationMs: 600_000,
  preemptionStormThreshold: 10,
  preemptionStormWindowMs: 3_600_000,
};

// ─── Usage Record ──────────────────────────────────────────────────────

interface UsageRecord {
  agentId: AgentID;
  ruConsumed: number;
  timestamp: number;
}

// ─── AnomalyDetector ──────────────────────────────────────────────────

export class AnomalyDetector {
  private config: AnomalyDetectorConfig;
  private usageHistory: Map<string, UsageRecord[]> = new Map();
  private preemptionTimestamps: Map<string, number[]> = new Map();
  private baselineAverages: Map<string, number> = new Map();
  private detectedAnomalies: AnomalyEvent[] = [];

  constructor(config: Partial<AnomalyDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record resource usage for an agent (called periodically).
   */
  recordUsage(agentId: AgentID, ruConsumed: number): void {
    const key = agentId as string;
    const history = this.usageHistory.get(key) ?? [];

    // Compute baseline from existing history BEFORE adding the new entry,
    // so spike values don't contaminate the baseline they're measured against.
    this.updateBaseline(key, history);

    history.push({ agentId, ruConsumed, timestamp: Date.now() });
    this.usageHistory.set(key, history);
  }

  /**
   * Record a preemption event for storm detection.
   */
  recordPreemption(agentId: AgentID): void {
    const key = agentId as string;
    const timestamps = this.preemptionTimestamps.get(key) ?? [];
    timestamps.push(Date.now());
    this.preemptionTimestamps.set(key, timestamps);
  }

  /**
   * Check for anomalies in the current usage data.
   * Returns all detected anomalies since the last check.
   */
  detect(): AnomalyEvent[] {
    const anomalies: AnomalyEvent[] = [];

    for (const [key, history] of this.usageHistory) {
      if (history.length < 2) continue;

      const latest = history[history.length - 1]!;
      const baseline = this.baselineAverages.get(key) ?? 0;

      // 1. Spike detection: 5x baseline
      if (baseline > 0 && latest.ruConsumed >= baseline * this.config.spikeMultiplier) {
        anomalies.push({
          type: 'spike',
          agentId: latest.agentId,
          metric: 'ru_consumed',
          value: latest.ruConsumed,
          baseline,
          detectedAt: new Date().toISOString(),
          severity: latest.ruConsumed >= baseline * 10 ? 'critical' : 'warning',
        });
      }

      // 2. Sustained high utilization
      const sustainedHigh = this.checkSustainedHigh(key, history);
      if (sustainedHigh) {
        anomalies.push(sustainedHigh);
      }

      // 3. Sustained zero utilization
      const sustainedZero = this.checkSustainedZero(key, history);
      if (sustainedZero) {
        anomalies.push(sustainedZero);
      }
    }

    // 4. Preemption storm detection
    const preemptionStorm = this.checkPreemptionStorm();
    anomalies.push(...preemptionStorm);

    // Store all detected anomalies
    this.detectedAnomalies.push(...anomalies);

    return anomalies;
  }

  /**
   * Get all historical anomalies.
   */
  getAnomalies(): AnomalyEvent[] {
    return [...this.detectedAnomalies];
  }

  /**
   * Get anomalies for a specific agent.
   */
  getAnomaliesForAgent(agentId: AgentID): AnomalyEvent[] {
    return this.detectedAnomalies.filter((a) => a.agentId === agentId);
  }

  /**
   * Clear old usage history beyond the retention window.
   */
  prune(now?: number): void {
    const cutoff = (now ?? Date.now()) - 3_600_000; // Keep 1 hour
    for (const [key, history] of this.usageHistory) {
      const pruned = history.filter((r) => r.timestamp >= cutoff);
      this.usageHistory.set(key, pruned);
    }

    // Prune preemption timestamps
    for (const [key, timestamps] of this.preemptionTimestamps) {
      const pruned = timestamps.filter((t) => t >= cutoff);
      this.preemptionTimestamps.set(key, pruned);
    }
  }

  // ─── Private ────────────────────────────────────────────────────────

  private updateBaseline(key: string, history: UsageRecord[]): void {
    if (history.length < 3) return;
    // Use exponential moving average for baseline
    const alpha = 0.3;
    let ema = history[0]!.ruConsumed;
    for (let i = 1; i < history.length; i++) {
      ema = alpha * history[i]!.ruConsumed + (1 - alpha) * ema;
    }
    this.baselineAverages.set(key, ema);
  }

  private checkSustainedHigh(key: string, history: UsageRecord[]): AnomalyEvent | null {
    if (history.length < 2) return null;

    const now = Date.now();
    const windowStart = now - this.config.sustainedHighDurationMs;
    const recentHistory = history.filter((r) => r.timestamp >= windowStart);

    if (recentHistory.length < 2) return null;

    // Check if all recent usage is above threshold
    const baseline = this.baselineAverages.get(key) ?? 0;
    if (baseline <= 0) return null;

    const allHigh = recentHistory.every(
      (r) => r.ruConsumed / baseline >= this.config.sustainedHighThreshold,
    );

    if (allHigh) {
      return {
        type: 'sustained_high',
        agentId: recentHistory[0]!.agentId,
        metric: 'ru_consumed',
        value: recentHistory[recentHistory.length - 1]!.ruConsumed,
        baseline,
        detectedAt: new Date().toISOString(),
        severity: 'warning',
      };
    }

    return null;
  }

  private checkSustainedZero(key: string, history: UsageRecord[]): AnomalyEvent | null {
    if (history.length < 2) return null;

    const now = Date.now();
    const windowStart = now - this.config.sustainedZeroDurationMs;
    const recentHistory = history.filter((r) => r.timestamp >= windowStart);

    if (recentHistory.length < 2) return null;

    const baseline = this.baselineAverages.get(key) ?? 0;
    if (baseline <= 0) return null;

    const allZero = recentHistory.every(
      (r) => r.ruConsumed / baseline <= this.config.sustainedZeroThreshold,
    );

    if (allZero) {
      return {
        type: 'sustained_zero',
        agentId: recentHistory[0]!.agentId,
        metric: 'ru_consumed',
        value: recentHistory[recentHistory.length - 1]!.ruConsumed,
        baseline,
        detectedAt: new Date().toISOString(),
        severity: 'warning',
      };
    }

    return null;
  }

  private checkPreemptionStorm(): AnomalyEvent[] {
    const anomalies: AnomalyEvent[] = [];
    const now = Date.now();
    const windowStart = now - this.config.preemptionStormWindowMs;

    for (const [key, timestamps] of this.preemptionTimestamps) {
      const recent = timestamps.filter((t) => t >= windowStart);
      if (recent.length >= this.config.preemptionStormThreshold) {
        anomalies.push({
          type: 'preemption_storm',
          agentId: key as unknown as AgentID,
          metric: 'preemption_count',
          value: recent.length,
          baseline: this.config.preemptionStormThreshold,
          detectedAt: new Date().toISOString(),
          severity: 'critical',
        });
      }
    }

    return anomalies;
  }
}