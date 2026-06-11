/**
 * @agentos/simulation — WorkloadGenerator tests
 * Tests for task generation, goal decomposition, and dependency creation.
 */

import { describe, it, expect } from 'vitest';
import { WorkloadGenerator } from '../src/workload-generator.js';
import { TaskState } from '@agentos/types';

describe('WorkloadGenerator', () => {
  describe('generateTasks', () => {
    it('should generate the requested number of tasks', () => {
      const gen = new WorkloadGenerator(() => 0.5);
      const tasks = gen.generateTasks(10, ['ws-1'] as any);
      expect(tasks).toHaveLength(10);
    });

    it('should assign each task to a workspace', () => {
      const gen = new WorkloadGenerator(() => 0.5);
      const tasks = gen.generateTasks(10, ['ws-1', 'ws-2'] as any);
      for (const task of tasks) {
        expect(task.workspaceId).toBeDefined();
        expect(['ws-1', 'ws-2']).toContain(task.workspaceId);
      }
    });

    it('should create tasks in ANNOUNCED state', () => {
      const gen = new WorkloadGenerator(() => 0.5);
      const tasks = gen.generateTasks(5, ['ws-1'] as any);
      for (const task of tasks) {
        expect(task.state).toBe(TaskState.ANNOUNCED);
      }
    });

    it('should set title and description on each task', () => {
      const gen = new WorkloadGenerator(() => 0.5);
      const tasks = gen.generateTasks(5, ['ws-1'] as any);
      for (const task of tasks) {
        expect(task.title).toBeTruthy();
        expect(task.description).toBeTruthy();
      }
    });

    it('should set capability tags on tasks', () => {
      const gen = new WorkloadGenerator(() => 0.5);
      const tasks = gen.generateTasks(10, ['ws-1'] as any);
      const withCapabilities = tasks.filter((t) => t.capabilities && t.capabilities.length > 0);
      expect(withCapabilities.length).toBeGreaterThan(0);
    });

    it('should set resources_required on tasks', () => {
      const gen = new WorkloadGenerator(() => 0.5);
      const tasks = gen.generateTasks(5, ['ws-1'] as any);
      for (const task of tasks) {
        expect(task.resources_required).toBeDefined();
        expect(task.resources_required.ru).toBeGreaterThan(0);
      }
    });

    it('should create dependency chains with low RNG values', () => {
      // With RNG returning 0, every task (after first) gets a dependency
      const gen = new WorkloadGenerator(() => 0);
      const tasks = gen.generateTasks(20, ['ws-1'] as any);
      const withDeps = tasks.filter((t) => t.depends_on && t.depends_on.length > 0);
      expect(withDeps.length).toBeGreaterThan(0);
    });
  });

  describe('generateGoalDecomposition', () => {
    it('should create a goal with objectives, steps, and actions', () => {
      const gen = new WorkloadGenerator(() => 0.5);
      const result = gen.generateGoalDecomposition(
        'Build Feature X',
        2,   // 2 objectives
        2,   // 2 steps per objective
        2,   // 2 actions per step
        'ws-1' as any,
      );
      // Total: 1 goal + 2 objectives + 4 steps + 8 actions = 15
      expect(result).toHaveLength(15);
    });

    it('should create the goal task first with the goal title', () => {
      const gen = new WorkloadGenerator(() => 0.5);
      const result = gen.generateGoalDecomposition('My Goal', 1, 1, 1, 'ws-1' as any);
      expect(result[0]!.title).toContain('My Goal');
    });

    it('should create proper dependency chains', () => {
      const gen = new WorkloadGenerator(() => 0.5);
      const result = gen.generateGoalDecomposition('Goal', 1, 1, 1, 'ws-1' as any);
      // Actions depend on their step, steps on objective, objective on goal
      // Find actions (type=ACTION) — they should have depends_on set
      const goal = result[0]!;
      // The objective should depend on the goal
      const objective = result.find((t) => t.title === 'Objective 1');
      expect(objective).toBeDefined();
      expect(objective!.depends_on).toContain(goal.id);
    });
  });
});