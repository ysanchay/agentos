/**
 * @agentos/simulation — Simulation integration tests
 * Tests the full simulation lifecycle: setup, run, verify, teardown.
 */

import { describe, it, expect } from 'vitest';
import { Simulation } from '../src/simulation.js';
import { createConfig, DEFAULT_CONFIG } from '../src/simulation-config.js';
import { AgentState, TaskState } from '@agentos/types';

describe('Simulation', () => {
  describe('constructor and createConfig', () => {
    it('should create default config', () => {
      const config = createConfig();
      expect(config.agentCount).toBe(DEFAULT_CONFIG.agentCount);
      expect(config.taskCount).toBe(DEFAULT_CONFIG.taskCount);
      expect(config.randomSeed).toBe(DEFAULT_CONFIG.randomSeed);
    });

    it('should accept partial config overrides', () => {
      const config = createConfig({ agentCount: 10, taskCount: 50 });
      expect(config.agentCount).toBe(10);
      expect(config.taskCount).toBe(50);
      // Other defaults preserved
      expect(config.clockSpeed).toBe(DEFAULT_CONFIG.clockSpeed);
      expect(config.failureRate).toBe(DEFAULT_CONFIG.failureRate);
    });

    it('should merge partial config with defaults', () => {
      const config = createConfig({ workspaceCount: 3 });
      expect(config.workspaceCount).toBe(3);
      expect(config.agentCount).toBe(DEFAULT_CONFIG.agentCount);
    });
  });

  describe('Simulation class', () => {
    it('should create a simulation instance', () => {
      const sim = new Simulation({ agentCount: 5, taskCount: 10 });
      expect(sim).toBeDefined();
    });

    it('should run a small simulation to completion', async () => {
      const sim = new Simulation({
        agentCount: 5,
        taskCount: 10,
        workspaceCount: 1,
        durationMs: 5000,
        clockSpeed: 100,
        failureRate: 0,
        randomSeed: 42,
      });

      const result = await sim.run();
      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
      expect(result.metrics).toBeDefined();
      expect(result.report).toBeDefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    }, 30000); // 30 second timeout for simulation

    it('should produce metrics after running', async () => {
      const sim = new Simulation({
        agentCount: 5,
        taskCount: 10,
        workspaceCount: 1,
        durationMs: 3000,
        clockSpeed: 100,
        failureRate: 0,
        randomSeed: 123,
      });

      const result = await sim.run();
      // Agent count in metrics reflects the simulation set (which includes chiefs/managers/workers)
      expect(result.metrics.agents.total).toBeGreaterThan(0);
      expect(result.metrics.tasks.total).toBeGreaterThan(0);
    }, 30000);

    it('should generate a non-empty report', async () => {
      const sim = new Simulation({
        agentCount: 5,
        taskCount: 10,
        workspaceCount: 1,
        durationMs: 3000,
        clockSpeed: 100,
        failureRate: 0,
        randomSeed: 99,
      });

      const result = await sim.run();
      expect(result.report.length).toBeGreaterThan(0);
      // Report should contain key sections
      expect(result.report).toContain('Agent');
      expect(result.report).toContain('Task');
    }, 30000);

    it('should handle zero failure rate', async () => {
      const sim = new Simulation({
        agentCount: 3,
        taskCount: 5,
        workspaceCount: 1,
        durationMs: 2000,
        clockSpeed: 100,
        failureRate: 0,
        randomSeed: 42,
      });

      const result = await sim.run();
      // With 0% failure rate, all completed tasks should succeed
      expect(result.metrics.tasks.failed).toBe(0);
    }, 30000);

    it('should produce deterministic results with same seed', async () => {
      const config = {
        agentCount: 5,
        taskCount: 10,
        workspaceCount: 1,
        durationMs: 2000,
        clockSpeed: 50,
        failureRate: 0.05,
        randomSeed: 42,
      };

      const sim1 = new Simulation(config);
      const result1 = await sim1.run();

      const sim2 = new Simulation(config);
      const result2 = await sim2.run();

      // Same seed should produce same metrics
      expect(result1.metrics.agents.total).toBe(result2.metrics.agents.total);
      expect(result1.metrics.tasks.total).toBe(result2.metrics.tasks.total);
    }, 30000);
  });
});