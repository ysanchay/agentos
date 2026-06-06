/**
 * @agentos/kernel — Task Registry
 * In-memory registry of all tasks.
 * ZERO AI logic — deterministic lookups and mutations only.
 */

import { ok, err, KER } from '@agentos/types';
import type { Outcome, Task, TaskID, WorkspaceID, TaskState, AgentID } from '@agentos/types';

// ─── Task Registry ───────────────────────────────────────────────────

export class TaskRegistry {
  private tasks: Map<string, Task> = new Map();

  /** Create/register a new task. */
  create(task: Task): Outcome<Task> {
    if (this.tasks.has(task.id)) {
      return err(KER.ALREADY_EXISTS, `Task with id "${task.id}" already exists`, {
        retryable: false,
      });
    }
    this.tasks.set(task.id, { ...task });
    return ok({ ...task });
  }

  /** Get a task by ID. Returns undefined if not found. */
  get(taskId: TaskID): Task | undefined {
    const task = this.tasks.get(taskId);
    return task ? { ...task } : undefined;
  }

  /** List tasks, optionally filtered. */
  list(filter?: { workspace_id?: WorkspaceID; state?: TaskState; assignee_id?: AgentID }): Task[] {
    let result = Array.from(this.tasks.values());

    if (filter?.workspace_id) {
      result = result.filter((t) => t.workspace_id === filter.workspace_id);
    }
    if (filter?.state) {
      result = result.filter((t) => t.state === filter.state);
    }
    if (filter?.assignee_id) {
      result = result.filter((t) => t.assignee_id === filter.assignee_id);
    }

    return result.map((t) => ({ ...t }));
  }

  /** Update a task with a partial patch. */
  update(taskId: TaskID, patch: Partial<Task>): Outcome<Task> {
    const existing = this.tasks.get(taskId);
    if (!existing) {
      return err(KER.TASK_NOT_FOUND, `Task "${taskId}" not found`, {
        retryable: false,
      });
    }
    const updated = { ...existing, ...patch, id: existing.id }; // ID is immutable
    this.tasks.set(taskId, updated);
    return ok({ ...updated });
  }

  /** Delete a task by ID. */
  delete(taskId: TaskID): Outcome<true> {
    if (!this.tasks.has(taskId)) {
      return err(KER.TASK_NOT_FOUND, `Task "${taskId}" not found`, {
        retryable: false,
      });
    }
    this.tasks.delete(taskId);
    return ok(true);
  }

  /** Find tasks by workspace. */
  findByWorkspace(workspaceId: WorkspaceID): Task[] {
    return this.list({ workspace_id: workspaceId });
  }

  /** Find tasks by state. */
  findByState(state: TaskState): Task[] {
    return this.list({ state });
  }

  /** Find tasks by assignee. */
  findByAssignee(agentId: AgentID): Task[] {
    return this.list({ assignee_id: agentId });
  }

  /** Get the number of registered tasks. */
  size(): number {
    return this.tasks.size;
  }

  /** Clear all tasks. */
  clear(): void {
    this.tasks.clear();
  }
}