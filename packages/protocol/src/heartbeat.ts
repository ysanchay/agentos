/**
 * HeartbeatManager: tracks HEALTHY -> SUSPECT -> DEGRADED -> FAILED per agent, with recovery
 */

import type { AgentID, LivenessState, AgentState } from '@agentos/types';
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_SUSPECT_MS,
  HEARTBEAT_DEGRADED_MS,
  HEARTBEAT_FAILED_MS,
  RECOVERY_TIMEOUT_MS,
} from '@agentos/types';
import { ok, err } from '@agentos/types';
import type { Outcome } from '@agentos/types';
import { heartbeatMissed, agentDegraded, agentFailed } from './errors.js';

export interface AgentLivenessEntry {
  agentId: AgentID;
  state: LivenessState;
  lastHeartbeat: string; // ISO 8601
  lastStateChange: string; // ISO 8601
  missedHeartbeats: number;
  stateHistory: { from: LivenessState; to: LivenessState; at: string }[];
}

type LivenessTransition = 'healthy' | 'suspect' | 'degraded' | 'failed';

// State transition map: from state -> set of valid target states
const VALID_TRANSITIONS: Record<LivenessState, Set<LivenessState>> = {
  healthy: new Set(['suspect']),
  suspect: new Set(['healthy', 'degraded']),
  degraded: new Set(['healthy', 'suspect', 'failed']),
  failed: new Set(['degraded']), // recovery path
};

export interface HeartbeatManagerOpts {
  suspectMs?: number;
  degradedMs?: number;
  failedMs?: number;
  recoveryTimeoutMs?: number;
}

/**
 * HeartbeatManager tracks liveness state of agents based on heartbeat messages.
 * State machine: HEALTHY -> SUSPECT -> DEGRADED -> FAILED
 * Recovery path: FAILED -> DEGRADED -> (SUSPECT ->) HEALTHY
 */
export class HeartbeatManager {
  private agents = new Map<string, AgentLivenessEntry>();
  private suspectMs: number;
  private degradedMs: number;
  private failedMs: number;
  private recoveryTimeoutMs: number;

  constructor(opts?: HeartbeatManagerOpts) {
    this.suspectMs = opts?.suspectMs ?? HEARTBEAT_SUSPECT_MS;
    this.degradedMs = opts?.degradedMs ?? HEARTBEAT_DEGRADED_MS;
    this.failedMs = opts?.failedMs ?? HEARTBEAT_FAILED_MS;
    this.recoveryTimeoutMs = opts?.recoveryTimeoutMs ?? RECOVERY_TIMEOUT_MS;
  }

  /**
   * Register an agent for heartbeat tracking.
   * Agent starts in HEALTHY state.
   */
  register(agentId: AgentID): AgentLivenessEntry {
    const now = new Date().toISOString();
    const entry: AgentLivenessEntry = {
      agentId,
      state: 'healthy',
      lastHeartbeat: now,
      lastStateChange: now,
      missedHeartbeats: 0,
      stateHistory: [],
    };
    this.agents.set(agentId, entry);
    return entry;
  }

  /**
   * Unregister an agent from heartbeat tracking.
   */
  unregister(agentId: AgentID): void {
    this.agents.delete(agentId);
  }

  /**
   * Record a heartbeat from an agent.
   * May transition the agent back to HEALTHY if they were in SUSPECT or DEGRADED state.
   */
  recordHeartbeat(agentId: AgentID, agentState?: AgentState): Outcome<AgentLivenessEntry> {
    const entry = this.agents.get(agentId);
    if (!entry) {
      return err('KER-0012', `Agent ${agentId} not registered for heartbeat tracking`);
    }

    const now = new Date().toISOString();
    entry.lastHeartbeat = now;
    entry.missedHeartbeats = 0;

    // Recovery: suspect/degraded -> healthy on heartbeat
    if (entry.state === 'suspect' || entry.state === 'degraded') {
      this.transitionState(entry, 'healthy');
    }

    // Failed -> degraded on heartbeat (partial recovery)
    if (entry.state === 'failed') {
      this.transitionState(entry, 'degraded');
    }

    return ok(entry);
  }

  /**
   * Check all agents and update states based on time since last heartbeat.
   * Should be called periodically.
   */
  checkAll(): AgentLivenessEntry[] {
    const now = Date.now();
    const changed: AgentLivenessEntry[] = [];

    for (const entry of this.agents.values()) {
      const elapsed = now - new Date(entry.lastHeartbeat).getTime();
      const previousState = entry.state;

      if (elapsed >= this.failedMs) {
        if (previousState !== 'failed') {
          this.transitionState(entry, 'failed');
          entry.missedHeartbeats = 3;
          changed.push(entry);
        }
      } else if (elapsed >= this.degradedMs) {
        if (previousState !== 'degraded' && previousState !== 'failed') {
          this.transitionState(entry, 'degraded');
          entry.missedHeartbeats = 2;
          changed.push(entry);
        }
      } else if (elapsed >= this.suspectMs) {
        if (previousState === 'healthy') {
          this.transitionState(entry, 'suspect');
          entry.missedHeartbeats = 1;
          changed.push(entry);
        }
      }

      // Check recovery timeout for failed agents
      if (entry.state === 'failed') {
        const timeInFailed = now - new Date(entry.lastStateChange).getTime();
        if (timeInFailed >= this.recoveryTimeoutMs) {
          // Agent has been failed for too long - it stays failed but we record it
          // In a real system, this might trigger agent termination
        }
      }
    }

    return changed;
  }

  /**
   * Get the liveness state of an agent.
   */
  getState(agentId: AgentID): LivenessState | undefined {
    return this.agents.get(agentId)?.state;
  }

  /**
   * Get the full liveness entry for an agent.
   */
  getEntry(agentId: AgentID): AgentLivenessEntry | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents in a specific liveness state.
   */
  getAgentsByState(state: LivenessState): AgentID[] {
    const result: AgentID[] = [];
    for (const entry of this.agents.values()) {
      if (entry.state === state) {
        result.push(entry.agentId);
      }
    }
    return result;
  }

  /**
   * Get all tracked agent IDs.
   */
  getTrackedAgents(): AgentID[] {
    return [...this.agents.keys()] as AgentID[];
  }

  /**
   * Get the time in milliseconds since the last heartbeat for an agent.
   */
  timeSinceLastHeartbeat(agentId: AgentID): number | undefined {
    const entry = this.agents.get(agentId);
    if (!entry) return undefined;
    return Date.now() - new Date(entry.lastHeartbeat).getTime();
  }

  /**
   * Check if a state transition is valid.
   */
  isValidTransition(from: LivenessState, to: LivenessState): boolean {
    return VALID_TRANSITIONS[from]?.has(to) ?? false;
  }

  private transitionState(entry: AgentLivenessEntry, newState: LivenessState): void {
    const oldState = entry.state;
    if (oldState === newState) return;

    const now = new Date().toISOString();
    entry.stateHistory.push({ from: oldState, to: newState, at: now });
    entry.state = newState;
    entry.lastStateChange = now;
  }
}