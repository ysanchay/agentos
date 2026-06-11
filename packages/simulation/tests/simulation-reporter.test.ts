/**
 * @agentos/simulation — SimulationReporter tests
 * Tests for metrics collection and report generation.
 */

import { describe, it, expect } from 'vitest';
import { SimulationReporter } from '../src/simulation-reporter.js';

describe('SimulationReporter', () => {
  describe('initial state', () => {
    it('should generate a report with zero defaults', () => {
      const reporter = new SimulationReporter();
      const metrics = reporter.generateReport();
      expect(metrics.agents.total).toBe(0);
      expect(metrics.tasks.total).toBe(0);
      expect(metrics.resources.ruAllocated).toBe(0);
      expect(metrics.resources.ruConsumed).toBe(0);
    });
  });

  describe('updateAgentMetrics', () => {
    it('should track agent counts', () => {
      const reporter = new SimulationReporter();
      reporter.updateAgentMetrics({
        total: 10,
        completed: 7,
        failed: 2,
        active: 1,
      });
      const metrics = reporter.generateReport();
      expect(metrics.agents.total).toBe(10);
      expect(metrics.agents.completed).toBe(7);
      expect(metrics.agents.failed).toBe(2);
      expect(metrics.agents.active).toBe(1);
    });
  });

  describe('updateTaskMetrics', () => {
    it('should track task counts', () => {
      const reporter = new SimulationReporter();
      reporter.updateTaskMetrics({
        total: 50,
        completed: 40,
        failed: 5,
        cancelled: 2,
        pending: 3,
      });
      const metrics = reporter.generateReport();
      expect(metrics.tasks.total).toBe(50);
      expect(metrics.tasks.completed).toBe(40);
      expect(metrics.tasks.failed).toBe(5);
      expect(metrics.tasks.cancelled).toBe(2);
      expect(metrics.tasks.pending).toBe(3);
    });
  });

  describe('updateResourceMetrics', () => {
    it('should track resource allocation and consumption', () => {
      const reporter = new SimulationReporter();
      reporter.updateResourceMetrics({
        ruAllocated: 10000,
        ruConsumed: 8000,
        muAllocated: 5000,
        muConsumed: 4000,
        euAllocated: 2000,
        euConsumed: 1500,
        vuAllocated: 1000,
        vuConsumed: 500,
      });
      const metrics = reporter.generateReport();
      expect(metrics.resources.ruAllocated).toBe(10000);
      expect(metrics.resources.ruConsumed).toBe(8000);
      expect(metrics.resources.muAllocated).toBe(5000);
      expect(metrics.resources.muConsumed).toBe(4000);
    });
  });

  describe('printReport', () => {
    it('should generate a report string without errors', () => {
      const reporter = new SimulationReporter();
      reporter.updateAgentMetrics({ total: 10, completed: 7, failed: 2, active: 1 });
      reporter.updateTaskMetrics({ total: 50, completed: 40, failed: 5, cancelled: 2, pending: 3 });
      reporter.updateResourceMetrics({
        ruAllocated: 10000, ruConsumed: 8000,
        muAllocated: 5000, muConsumed: 4000,
        euAllocated: 2000, euConsumed: 1500,
        vuAllocated: 1000, vuConsumed: 500,
      });

      const report = reporter.printReport();
      expect(typeof report).toBe('string');
      expect(report.length).toBeGreaterThan(0);
      expect(report).toContain('AgentOS Simulation Report');
      expect(report).toContain('AGENTS');
      expect(report).toContain('TASKS');
    });
  });

  describe('recordEvent', () => {
    it('should track events', () => {
      const reporter = new SimulationReporter();
      reporter.recordEvent('agent.spawn', { agentId: 'a1' });
      reporter.recordEvent('task.complete', { taskId: 't1' });
      const events = reporter.getEvents();
      expect(events).toHaveLength(2);
      expect(events[0]!.type).toBe('agent.spawn');
      expect(events[1]!.type).toBe('task.complete');
    });
  });
});