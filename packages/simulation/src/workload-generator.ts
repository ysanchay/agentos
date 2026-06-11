/**
 * @agentos/simulation — Workload Generator
 * Generates task hierarchies for the simulation.
 * ZERO AI logic — deterministic task generation from templates.
 */

import type {
  TaskID,
  WorkspaceID,
  Priority,
  ResourceBudget,
  TaskType,
} from '@agentos/types';
import { createUUID, TaskState, TaskType as TT } from '@agentos/types';

// ─── Task Template ─────────────────────────────────────────────────────

export interface TaskTemplate {
  title: string;
  description: string;
  type: TaskType;
  priority: Priority;
  capabilities: string[];
  resourcesRequired: ResourceBudget;
  dependsOn: string[]; // template IDs
  subtasks: string[]; // template IDs
}

// ─── WorkloadGenerator ──────────────────────────────────────────────────

export class WorkloadGenerator {
  private rng: () => number;
  private taskCounter: number = 0;

  constructor(rng?: () => number) {
    this.rng = rng ?? Math.random;
  }

  /**
   * Generate a set of tasks for the simulation.
   */
  generateTasks(
    count: number,
    workspaceIds: WorkspaceID[],
    templates?: TaskTemplate[],
  ): GeneratedTask[] {
    const tasks: GeneratedTask[] = [];
    const useTemplates = templates ?? DEFAULT_TASK_TEMPLATES;

    for (let i = 0; i < count; i++) {
      const template = useTemplates[i % useTemplates.length]!;
      const workspaceId = workspaceIds[i % workspaceIds.length]!;
      const taskId = createUUID() as unknown as TaskID;
      const task = this.createTaskFromTemplate(taskId, template, workspaceId);
      tasks.push(task);
    }

    // Add dependencies between tasks (10% chance of dependency)
    for (let i = 1; i < tasks.length; i++) {
      if (this.rng() < 0.1 && i > 0) {
        const depIndex = Math.floor(this.rng() * i);
        tasks[i]!.depends_on.push(tasks[depIndex]!.id);
      }
    }

    return tasks;
  }

  /**
   * Generate a goal decomposition: 1 goal → N objectives → M steps → K actions
   */
  generateGoalDecomposition(
    goalTitle: string,
    objectivesPerGoal: number,
    stepsPerObjective: number,
    actionsPerStep: number,
    workspaceId: WorkspaceID,
  ): GeneratedTask[] {
    const tasks: GeneratedTask[] = [];

    // Goal task
    const goalId = createUUID() as unknown as TaskID;
    tasks.push(this.createTask(
      goalId, goalTitle, `Goal: ${goalTitle}`, TT.OBJECTIVE,
      1 as Priority, workspaceId, ['decompose'], { ru: 100, mu: 50, eu: 20, vu: 10 },
    ));

    // Objectives
    for (let o = 0; o < objectivesPerGoal; o++) {
      const objId = createUUID() as unknown as TaskID;
      const objTask = this.createTask(
        objId, `Objective ${o + 1}`, `Objective for: ${goalTitle}`,
        TT.OBJECTIVE, 2 as Priority, workspaceId, ['coordinate'],
        { ru: 200, mu: 100, eu: 50, vu: 25 },
      );
      objTask.depends_on.push(goalId);
      tasks.push(objTask);

      // Steps
      for (let s = 0; s < stepsPerObjective; s++) {
        const stepId = createUUID() as unknown as TaskID;
        const stepTask = this.createTask(
          stepId, `Step ${o + 1}.${s + 1}`, `Step for objective ${o + 1}`,
          TT.ACTION, 3 as Priority, workspaceId, ['execute', 'implement'],
          { ru: 300, mu: 150, eu: 75, vu: 30 },
        );
        stepTask.depends_on.push(objId);
        tasks.push(stepTask);

        // Actions
        for (let a = 0; a < actionsPerStep; a++) {
          const actionId = createUUID() as unknown as TaskID;
          const actionTask = this.createTask(
            actionId, `Action ${o + 1}.${s + 1}.${a + 1}`,
            `Action for step ${o + 1}.${s + 1}`,
            TT.ACTION, 4 as Priority, workspaceId, ['execute'],
            { ru: 150, mu: 75, eu: 30, vu: 15 },
          );
          actionTask.depends_on.push(stepId);
          tasks.push(actionTask);
        }
      }
    }

    return tasks;
  }

  /**
   * Create a single task from a template.
   */
  private createTaskFromTemplate(
    id: TaskID,
    template: TaskTemplate,
    workspaceId: WorkspaceID,
  ): GeneratedTask {
    return {
      id,
      title: template.title,
      description: template.description,
      type: template.type,
      priority: template.priority,
      state: TaskState.ANNOUNCED,
      workspaceId,
      capabilities: template.capabilities,
      resources_required: template.resourcesRequired,
      depends_on: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  private createTask(
    id: TaskID,
    title: string,
    description: string,
    type: TaskType,
    priority: Priority,
    workspaceId: WorkspaceID,
    capabilities: string[],
    resourcesRequired: ResourceBudget,
  ): GeneratedTask {
    return {
      id,
      title,
      description,
      type,
      priority,
      state: TaskState.ANNOUNCED,
      workspaceId,
      capabilities,
      resources_required: resourcesRequired,
      depends_on: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
}

// ─── Types ──────────────────────────────────────────────────────────────

export interface GeneratedTask {
  id: TaskID;
  title: string;
  description: string;
  type: TaskType;
  priority: Priority;
  state: TaskState;
  workspaceId: WorkspaceID;
  capabilities: string[];
  resources_required: ResourceBudget;
  depends_on: TaskID[];
  created_at: string;
  updated_at: string;
}

// ─── Default Templates ─────────────────────────────────────────────────

const DEFAULT_TASK_TEMPLATES: TaskTemplate[] = [
  {
    title: 'Process Data',
    description: 'Process and transform input data',
    type: TT.ACTION,
    priority: 3 as Priority,
    capabilities: ['execute', 'implement'],
    resourcesRequired: { ru: 500, mu: 200, eu: 100, vu: 50 },
    dependsOn: [],
    subtasks: [],
  },
  {
    title: 'Review Code',
    description: 'Review code changes for quality',
    type: TT.ACTION,
    priority: 2 as Priority,
    capabilities: ['review', 'validate'],
    resourcesRequired: { ru: 300, mu: 150, eu: 80, vu: 30 },
    dependsOn: [],
    subtasks: [],
  },
  {
    title: 'Run Tests',
    description: 'Execute test suite',
    type: TT.ACTION,
    priority: 2 as Priority,
    capabilities: ['execute', 'test'],
    resourcesRequired: { ru: 400, mu: 100, eu: 60, vu: 20 },
    dependsOn: [],
    subtasks: [],
  },
  {
    title: 'Deploy Service',
    description: 'Deploy a service to production',
    type: TT.ACTION,
    priority: 1 as Priority,
    capabilities: ['execute', 'manage'],
    resourcesRequired: { ru: 800, mu: 400, eu: 200, vu: 100 },
    dependsOn: [],
    subtasks: [],
  },
  {
    title: 'Generate Report',
    description: 'Generate analytics report',
    type: TT.ACTION,
    priority: 4 as Priority,
    capabilities: ['execute'],
    resourcesRequired: { ru: 200, mu: 100, eu: 50, vu: 25 },
    dependsOn: [],
    subtasks: [],
  },
  {
    title: 'Monitor Health',
    description: 'Check system health metrics',
    type: TT.ACTION,
    priority: 3 as Priority,
    capabilities: ['monitor', 'heartbeat'],
    resourcesRequired: { ru: 100, mu: 50, eu: 25, vu: 10 },
    dependsOn: [],
    subtasks: [],
  },
];