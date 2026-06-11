/**
 * @agentos/simulation — Simulation Configuration
 * Defines the configuration for a simulation run.
 */

import type { ResourceBudget } from '@agentos/types';

export interface SimulationConfig {
  /** Number of agents to simulate (default: 100) */
  agentCount: number;

  /** Number of tasks to generate (default: 5x agent count) */
  taskCount: number;

  /** Simulation duration in milliseconds (default: 60000) */
  durationMs: number;

  /** Clock speed multiplier (1 = real-time, 10 = 10x speed) */
  clockSpeed: number;

  /** Probability of agent failure (0-1, default: 0.05) */
  failureRate: number;

  /** Probability of task rejection (0-1, default: 0.1) */
  rejectionRate: number;

  /** Total resource capacity for the simulation */
  totalCapacity: ResourceBudget;

  /** Whether to enable deadlock detection (default: true) */
  enableDeadlockDetection: boolean;

  /** Whether to enable resource preemption (default: true) */
  enablePreemption: boolean;

  /** Random seed for deterministic simulation (default: 42) */
  randomSeed: number;

  /** Number of workspaces (default: 5) */
  workspaceCount: number;

  /** Number of chiefs (default: agentCount * 0.05) */
  chiefCount: number;

  /** Number of managers (default: agentCount * 0.15) */
  managerCount: number;

  /** Maximum concurrent tasks per agent (default: 3) */
  maxConcurrentTasks: number;

  /** Claim timeout in milliseconds (default: 60000) */
  claimTimeoutMs: number;
}

export const DEFAULT_CONFIG: SimulationConfig = {
  agentCount: 100,
  taskCount: 500,
  durationMs: 60_000,
  clockSpeed: 10,
  failureRate: 0.05,
  rejectionRate: 0.1,
  totalCapacity: {
    ru: 100_000,
    mu: 50_000,
    eu: 10_000,
    vu: 5_000,
  },
  enableDeadlockDetection: true,
  enablePreemption: true,
  randomSeed: 42,
  workspaceCount: 5,
  chiefCount: 5,
  managerCount: 15,
  maxConcurrentTasks: 3,
  claimTimeoutMs: 60_000,
};

/**
 * Create a config with partial overrides.
 */
export function createConfig(overrides: Partial<SimulationConfig> = {}): SimulationConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}