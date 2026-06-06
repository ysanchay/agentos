/**
 * @agentos/kernel — Task Dependency DAG
 * Validates and manages task dependencies as a Directed Acyclic Graph.
 * ZERO AI logic — deterministic graph algorithms only.
 */

import { ok, err, KER } from '@agentos/types';
import type { Outcome, TaskID } from '@agentos/types';

// ─── Dependency Graph ────────────────────────────────────────────────

export class DependencyGraph {
  /** adjacency: taskId -> set of task IDs it depends on (predecessors) */
  private dependsOn: Map<string, Set<string>> = new Map();
  /** reverse adjacency: taskId -> set of task IDs that depend on it (successors) */
  private dependedBy: Map<string, Set<string>> = new Map();
  /** all known task IDs */
  private tasks: Set<string> = new Set();

  /** Add a task with its dependencies. Rejects if adding would create a cycle. */
  addTask(taskId: TaskID, dependsOn: TaskID[]): Outcome<true> {
    const id = taskId as string;

    if (this.tasks.has(id)) {
      return err(KER.ALREADY_EXISTS, `Task "${taskId}" already exists in dependency graph`, {
        retryable: false,
      });
    }

    // Validate no cycle would be created by adding these deps
    const depIds = dependsOn.map((d) => d as string);

    // Temporarily add to check for cycles
    this.tasks.add(id);
    const prevDeps = this.dependsOn.get(id);
    this.dependsOn.set(id, new Set(depIds));

    for (const depId of depIds) {
      if (!this.dependedBy.has(depId)) {
        this.dependedBy.set(depId, new Set());
      }
      this.dependedBy.get(depId)!.add(id);
    }

    if (this.hasCycle()) {
      // Rollback
      this.tasks.delete(id);
      if (prevDeps) {
        this.dependsOn.set(id, prevDeps);
      } else {
        this.dependsOn.delete(id);
      }
      for (const depId of depIds) {
        const set = this.dependedBy.get(depId);
        if (set) {
          set.delete(id);
        }
      }

      return err(KER.CIRCULAR_DEPENDENCY, `Adding task "${taskId}" with given dependencies would create a cycle`, {
        retryable: false,
      });
    }

    return ok(true);
  }

  /** Remove a task and all its edges from the graph. */
  removeTask(taskId: TaskID): void {
    const id = taskId as string;
    if (!this.tasks.has(id)) return;

    // Remove from all dependency lists
    const deps = this.dependsOn.get(id);
    if (deps) {
      for (const depId of deps) {
        const set = this.dependedBy.get(depId);
        if (set) set.delete(id);
      }
    }

    // Remove from all dependents lists
    const dependents = this.dependedBy.get(id);
    if (dependents) {
      for (const depId of dependents) {
        const set = this.dependsOn.get(depId);
        if (set) set.delete(id);
      }
    }

    this.tasks.delete(id);
    this.dependsOn.delete(id);
    this.dependedBy.delete(id);
  }

  /** Add a single dependency edge. Rejects if it would create a cycle. */
  addDependency(from: TaskID, to: TaskID): Outcome<true> {
    const fromId = from as string;
    const toId = to as string;

    // from depends on to (from -> to means "from requires to")
    if (!this.tasks.has(fromId) || !this.tasks.has(toId)) {
      return err(KER.DEPENDENCY_NOT_MET, `Both tasks must exist in the graph to add dependency`, {
        retryable: false,
        details: { from: fromId, to: toId },
      });
    }

    // Check if already exists
    const existingDeps = this.dependsOn.get(fromId);
    if (existingDeps?.has(toId)) {
      return ok(true); // Already exists, idempotent
    }

    // Temporarily add to check for cycles
    if (!existingDeps) {
      this.dependsOn.set(fromId, new Set());
    }
    this.dependsOn.get(fromId)!.add(toId);

    if (!this.dependedBy.has(toId)) {
      this.dependedBy.set(toId, new Set());
    }
    this.dependedBy.get(toId)!.add(fromId);

    if (this.hasCycle()) {
      // Rollback
      this.dependsOn.get(fromId)!.delete(toId);
      this.dependedBy.get(toId)!.delete(fromId);

      return err(KER.CIRCULAR_DEPENDENCY, `Adding dependency from "${from}" to "${to}" would create a cycle`, {
        retryable: false,
      });
    }

    return ok(true);
  }

  /** Remove a single dependency edge. */
  removeDependency(from: TaskID, to: TaskID): void {
    const fromId = from as string;
    const toId = to as string;

    const deps = this.dependsOn.get(fromId);
    if (deps) deps.delete(toId);

    const dependents = this.dependedBy.get(toId);
    if (dependents) dependents.delete(fromId);
  }

  /**
   * Force-add a dependency edge without cycle checking.
   * Use with extreme caution — only for admin overrides or testing.
   * This can create cycles in the graph.
   */
  forceAddDependency(from: TaskID, to: TaskID): void {
    const fromId = from as string;
    const toId = to as string;

    if (!this.tasks.has(fromId) || !this.tasks.has(toId)) return;

    if (!this.dependsOn.has(fromId)) {
      this.dependsOn.set(fromId, new Set());
    }
    this.dependsOn.get(fromId)!.add(toId);

    if (!this.dependedBy.has(toId)) {
      this.dependedBy.set(toId, new Set());
    }
    this.dependedBy.get(toId)!.add(fromId);
  }

  /** Get the tasks that a given task depends on (its predecessors). */
  getDependencies(taskId: TaskID): TaskID[] {
    const deps = this.dependsOn.get(taskId as string);
    return deps ? Array.from(deps) as TaskID[] : [];
  }

  /** Get the tasks that depend on a given task (its successors). */
  getDependents(taskId: TaskID): TaskID[] {
    const dependents = this.dependedBy.get(taskId as string);
    return dependents ? Array.from(dependents) as TaskID[] : [];
  }

  /** Check if a task is ready (all its dependencies are in the completed set). */
  isReady(taskId: TaskID, completedTasks: Set<TaskID>): boolean {
    const deps = this.getDependencies(taskId);
    return deps.every((dep) => completedTasks.has(dep));
  }

  /** Topological sort — returns a valid execution order. */
  topologicalSort(): TaskID[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) return; // Cycle detected, skip (shouldn't happen in valid graph)

      visiting.add(id);

      const deps = this.dependsOn.get(id);
      if (deps) {
        for (const depId of deps) {
          visit(depId);
        }
      }

      visiting.delete(id);
      visited.add(id);
      result.push(id);
    };

    for (const id of this.tasks) {
      visit(id);
    }

    return result as TaskID[];
  }

  /** Check if the graph has any cycles. */
  hasCycle(): boolean {
    return this.detectCycle() !== null;
  }

  /** Detect a cycle and return the cycle path, or null if no cycle exists. */
  detectCycle(): TaskID[] | null {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK_VAL = 2;

    const color: Map<string, number> = new Map();
    const parent: Map<string, string | null> = new Map();

    for (const id of this.tasks) {
      color.set(id, WHITE);
      parent.set(id, null);
    }

    for (const id of this.tasks) {
      if (color.get(id) === BLACK_VAL) continue;

      const cycle = this.dfsDetect(id, color, parent);
      if (cycle) return cycle;
    }

    return null;
  }

  /** DFS-based cycle detection. Returns the cycle path if found. */
  private dfsDetect(
    startId: string,
    color: Map<string, number>,
    parent: Map<string, string | null>,
  ): TaskID[] | null {
    const stack: { id: string; iter: Iterator<string> | null }[] = [];

    color.set(startId, 1); // GRAY
    const deps = this.dependsOn.get(startId);
    stack.push({ id: startId, iter: deps ? deps[Symbol.iterator]() : null });

    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (!top.iter) {
        // No dependencies, mark as BLACK (2) and pop
        color.set(top.id, 2);
        stack.pop();
        continue;
      }

      const next = top.iter.next();
      if (next.done) {
        color.set(top.id, 2);
        stack.pop();
        continue;
      }

      const depId = next.value as string;

      if (!color.has(depId)) {
        // External dependency not in graph, skip
        continue;
      }

      const depColor = color.get(depId)!;

      if (depColor === 1) {
        // GRAY — cycle detected! Build cycle path
        const cycle: string[] = [depId];
        for (let i = stack.length - 1; i >= 0; i--) {
          cycle.push(stack[i]!.id);
          if (stack[i]!.id === depId) break;
        }
        cycle.reverse();
        return cycle as TaskID[];
      }

      if (depColor === 0) {
        // WHITE — visit
        parent.set(depId, top.id);
        color.set(depId, 1); // GRAY
        const depDeps = this.dependsOn.get(depId);
        stack.push({ id: depId, iter: depDeps ? depDeps[Symbol.iterator]() : null });
      }
      // BLACK — already processed, skip
    }

    return null;
  }

  /** Check if a task exists in the graph. */
  has(taskId: TaskID): boolean {
    return this.tasks.has(taskId as string);
  }

  /** Get all task IDs in the graph. */
  getAllTaskIds(): TaskID[] {
    return Array.from(this.tasks) as TaskID[];
  }

  /** Clear the entire graph. */
  clear(): void {
    this.tasks.clear();
    this.dependsOn.clear();
    this.dependedBy.clear();
  }
}