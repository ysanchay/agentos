/**
 * Tests for TaskRegistry
 */

import { describe, it, expect } from 'vitest';
import { TaskState, TaskType, ZERO_BUDGET, createUUID, asUUID, TASK_PRIORITY_NORMAL } from '@agentos/types';
import type { Task, TaskID, AgentID } from '@agentos/types';
import { TaskRegistry } from '../src/task-registry.js';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: createUUID() as TaskID,
  title: 'Test Task',
  description: 'A test task',
  type: TaskType.ACTION,
  priority: TASK_PRIORITY_NORMAL,
  state: TaskState.DRAFT,
  workspace_id: asUUID('ws-1'),
  project_id: asUUID('proj-1'),
  assignee_id: undefined,
  claimed_by: undefined,
  claimed_at: undefined,
  parent_task_id: undefined,
  child_task_ids: [],
  depends_on: [],
  blocks: [],
  resources_required: ZERO_BUDGET,
  resources_allocated: undefined,
  result: undefined,
  error: undefined,
  deadline: undefined,
  retry_count: 0,
  max_retries: 3,
  previous_assignees: [],
  tags: [],
  metadata: {},
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe('TaskRegistry', () => {
  it('creates a task', () => {
    const reg = new TaskRegistry();
    const task = makeTask();
    const result = reg.create(task);
    expect(result.ok).toBe(true);
  });

  it('rejects duplicate creation', () => {
    const reg = new TaskRegistry();
    const task = makeTask();
    reg.create(task);
    const result = reg.create(task);
    expect(result.ok).toBe(false);
  });

  it('gets a task by ID', () => {
    const reg = new TaskRegistry();
    const task = makeTask();
    reg.create(task);
    const found = reg.get(task.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(task.id);
  });

  it('returns undefined for non-existent task', () => {
    const reg = new TaskRegistry();
    expect(reg.get(asUUID('non-existent'))).toBeUndefined();
  });

  it('lists all tasks', () => {
    const reg = new TaskRegistry();
    reg.create(makeTask());
    reg.create(makeTask());
    expect(reg.list()).toHaveLength(2);
  });

  it('lists tasks by workspace', () => {
    const reg = new TaskRegistry();
    const ws1 = asUUID('ws-1');
    const ws2 = asUUID('ws-2');
    reg.create(makeTask({ workspace_id: ws1 }));
    reg.create(makeTask({ workspace_id: ws1 }));
    reg.create(makeTask({ workspace_id: ws2 }));
    expect(reg.findByWorkspace(ws1)).toHaveLength(2);
  });

  it('lists tasks by state', () => {
    const reg = new TaskRegistry();
    reg.create(makeTask({ state: TaskState.DRAFT }));
    reg.create(makeTask({ state: TaskState.DRAFT }));
    reg.create(makeTask({ state: TaskState.ANNOUNCED }));
    expect(reg.findByState(TaskState.DRAFT)).toHaveLength(2);
  });

  it('lists tasks by assignee', () => {
    const reg = new TaskRegistry();
    const agentId = createUUID() as AgentID;
    reg.create(makeTask({ assignee_id: agentId }));
    reg.create(makeTask({ assignee_id: agentId }));
    reg.create(makeTask());
    expect(reg.findByAssignee(agentId)).toHaveLength(2);
  });

  it('updates a task', () => {
    const reg = new TaskRegistry();
    const task = makeTask();
    reg.create(task);
    const result = reg.update(task.id, { title: 'Updated' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.title).toBe('Updated');
  });

  it('preserves ID on update', () => {
    const reg = new TaskRegistry();
    const task = makeTask();
    reg.create(task);
    const result = reg.update(task.id, { id: asUUID('different') } as any);
    expect(result.ok && result.data.id).toBe(task.id);
  });

  it('rejects update for non-existent task', () => {
    const reg = new TaskRegistry();
    const result = reg.update(asUUID('non-existent'), { title: 'x' });
    expect(result.ok).toBe(false);
  });

  it('deletes a task', () => {
    const reg = new TaskRegistry();
    const task = makeTask();
    reg.create(task);
    const result = reg.delete(task.id);
    expect(result.ok).toBe(true);
    expect(reg.get(task.id)).toBeUndefined();
  });

  it('rejects delete for non-existent task', () => {
    const reg = new TaskRegistry();
    const result = reg.delete(asUUID('non-existent'));
    expect(result.ok).toBe(false);
  });

  it('returns correct size', () => {
    const reg = new TaskRegistry();
    expect(reg.size()).toBe(0);
    reg.create(makeTask());
    expect(reg.size()).toBe(1);
  });

  it('clears all tasks', () => {
    const reg = new TaskRegistry();
    reg.create(makeTask());
    reg.create(makeTask());
    reg.clear();
    expect(reg.size()).toBe(0);
  });
});