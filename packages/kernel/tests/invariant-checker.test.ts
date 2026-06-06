/**
 * Tests for InvariantChecker
 */

import { describe, it, expect } from 'vitest';
import { AgentState, TaskState, WorkspaceState, ZERO_BUDGET, ZERO_CONSUMPTION, createUUID, asUUID, KER } from '@agentos/types';
import type { Agent, Task, Workspace, AgentID, TaskID, WorkspaceID } from '@agentos/types';
import { AgentRegistry } from '../src/agent-registry.js';
import { TaskRegistry } from '../src/task-registry.js';
import { WorkspaceRegistry } from '../src/workspace-registry.js';
import { DependencyGraph } from '../src/dependency-graph.js';
import { PermissionEngine } from '../src/permission-engine.js';
import { EventBus } from '../src/event-bus.js';
import { InvariantChecker } from '../src/invariant-checker.js';

const createTestDeps = () => {
  const agentRegistry = new AgentRegistry();
  const taskRegistry = new TaskRegistry();
  const workspaceRegistry = new WorkspaceRegistry();
  const dependencyGraph = new DependencyGraph();
  const permissionEngine = new PermissionEngine();
  const eventBus = new EventBus();

  const checker = new InvariantChecker({
    agentRegistry,
    taskRegistry,
    workspaceRegistry,
    dependencyGraph,
    permissionEngine,
    eventBus,
  });

  return { agentRegistry, taskRegistry, workspaceRegistry, dependencyGraph, permissionEngine, eventBus, checker };
};

describe('InvariantChecker', () => {
  it('checkAll returns a valid report with no violations on empty state', () => {
    const { checker } = createTestDeps();
    const report = checker.checkAll();
    expect(report.checked).toBe(10);
    expect(report.passed).toBe(10);
    expect(report.violations).toHaveLength(0);
    expect(report.timestamp).toBeDefined();
  });

  it('checkConservation detects budget violation', () => {
    const { agentRegistry, checker } = createTestDeps();
    const agent: Agent = {
      id: asUUID<AgentID>('agent-1'),
      name: 'test',
      type: 1 as any,
      state: AgentState.READY,
      workspace_id: asUUID('ws-1'),
      project_id: asUUID('proj-1'),
      capabilities: [],
      permissions: [],
      resources_allocated: { ru: 10, mu: 10, eu: 10, vu: 10 },
      resources_consumed: { ru: 20, mu: 10, eu: 10, vu: 10 }, // exceeds limits
      resource_limits: { ru: 10, mu: 10, eu: 10, vu: 10 }, // limits too low for consumption
      parent_agent_id: undefined,
      child_agent_ids: [],
      active_task_ids: [],
      completed_task_count: 0,
      failed_task_count: 0,
      owner_user_id: asUUID('user-1'),
      public_key: '',
      metadata: {},
      tags: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    agentRegistry.register(agent);
    expect(checker.checkConservation()).toBe(false);
  });

  it('checkConservation passes when consumption within limits', () => {
    const { agentRegistry, checker } = createTestDeps();
    const agent: Agent = {
      id: asUUID<AgentID>('agent-1'),
      name: 'test',
      type: 1 as any,
      state: AgentState.READY,
      workspace_id: asUUID('ws-1'),
      project_id: asUUID('proj-1'),
      capabilities: [],
      permissions: [],
      resources_allocated: ZERO_BUDGET,
      resources_consumed: ZERO_CONSUMPTION,
      resource_limits: ZERO_BUDGET,
      parent_agent_id: undefined,
      child_agent_ids: [],
      active_task_ids: [],
      completed_task_count: 0,
      failed_task_count: 0,
      owner_user_id: asUUID('user-1'),
      public_key: '',
      metadata: {},
      tags: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    agentRegistry.register(agent);
    expect(checker.checkConservation()).toBe(true);
  });

  it('checkDagAcyclicity detects cycles (forced)', () => {
    const { dependencyGraph, checker } = createTestDeps();
    // Add tasks that form a valid DAG initially
    dependencyGraph.addTask(asUUID<TaskID>('a'), []);
    dependencyGraph.addTask(asUUID<TaskID>('b'), [asUUID<TaskID>('a')]);
    dependencyGraph.addTask(asUUID<TaskID>('c'), [asUUID<TaskID>('b')]);
    // addDependency correctly rejects cycles
    const result = dependencyGraph.addDependency(asUUID<TaskID>('a'), asUUID<TaskID>('c'));
    expect(result.ok).toBe(false);
    // Graph remains acyclic since addDependency prevented the cycle
    expect(checker.checkDagAcyclicity()).toBe(true);

    // Force a cycle to test the invariant checker can detect it
    dependencyGraph.forceAddDependency(asUUID<TaskID>('a'), asUUID<TaskID>('c'));
    expect(checker.checkDagAcyclicity()).toBe(false);
  });

  it('checkDagAcyclicity passes for valid DAG', () => {
    const { dependencyGraph, checker } = createTestDeps();
    dependencyGraph.addTask(asUUID<TaskID>('a'), []);
    dependencyGraph.addTask(asUUID<TaskID>('b'), [asUUID<TaskID>('a')]);
    expect(checker.checkDagAcyclicity()).toBe(true);
  });

  it('checkBudgetHardLimit detects exceeded budget', () => {
    const { agentRegistry, checker } = createTestDeps();
    const agent: Agent = {
      id: asUUID<AgentID>('agent-1'),
      name: 'test',
      type: 1 as any,
      state: AgentState.READY,
      workspace_id: asUUID('ws-1'),
      project_id: asUUID('proj-1'),
      capabilities: [],
      permissions: [],
      resources_allocated: { ru: 5, mu: 5, eu: 5, vu: 5 },
      resources_consumed: { ru: 10, mu: 5, eu: 5, vu: 5 },
      resource_limits: { ru: 100, mu: 100, eu: 100, vu: 100 },
      parent_agent_id: undefined,
      child_agent_ids: [],
      active_task_ids: [],
      completed_task_count: 0,
      failed_task_count: 0,
      owner_user_id: asUUID('user-1'),
      public_key: '',
      metadata: {},
      tags: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    agentRegistry.register(agent);
    expect(checker.checkBudgetHardLimit()).toBe(false);
  });

  it('checkBudgetHardLimit passes when within limits', () => {
    const { agentRegistry, checker } = createTestDeps();
    const agent: Agent = {
      id: asUUID<AgentID>('agent-1'),
      name: 'test',
      type: 1 as any,
      state: AgentState.READY,
      workspace_id: asUUID('ws-1'),
      project_id: asUUID('proj-1'),
      capabilities: [],
      permissions: [],
      resources_allocated: { ru: 10, mu: 10, eu: 10, vu: 10 },
      resources_consumed: { ru: 5, mu: 5, eu: 5, vu: 5 },
      resource_limits: { ru: 100, mu: 100, eu: 100, vu: 100 },
      parent_agent_id: undefined,
      child_agent_ids: [],
      active_task_ids: [],
      completed_task_count: 0,
      failed_task_count: 0,
      owner_user_id: asUUID('user-1'),
      public_key: '',
      metadata: {},
      tags: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    agentRegistry.register(agent);
    expect(checker.checkBudgetHardLimit()).toBe(true);
  });

  it('checkWorkspaceIsolation detects cross-workspace task assignment', () => {
    const { agentRegistry, taskRegistry, checker } = createTestDeps();
    const ws1 = asUUID<WorkspaceID>('ws-1');
    const ws2 = asUUID<WorkspaceID>('ws-2');
    const agentId = asUUID<AgentID>('agent-1');

    agentRegistry.register({
      id: agentId,
      name: 'test',
      type: 1 as any,
      state: AgentState.READY,
      workspace_id: ws1,
      project_id: asUUID('proj-1'),
      capabilities: [],
      permissions: [],
      resources_allocated: ZERO_BUDGET,
      resources_consumed: ZERO_CONSUMPTION,
      resource_limits: ZERO_BUDGET,
      parent_agent_id: undefined,
      child_agent_ids: [],
      active_task_ids: [],
      completed_task_count: 0,
      failed_task_count: 0,
      owner_user_id: asUUID('user-1'),
      public_key: '',
      metadata: {},
      tags: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    taskRegistry.create({
      id: asUUID<TaskID>('task-1'),
      title: 'test',
      description: 'test',
      type: 1 as any,
      priority: 3 as any,
      state: TaskState.IN_PROGRESS,
      workspace_id: ws2,
      project_id: asUUID('proj-1'),
      assignee_id: agentId,
      claimed_by: agentId,
      claimed_at: new Date().toISOString(),
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
    });

    expect(checker.checkWorkspaceIsolation()).toBe(false);
  });

  it('checkWorkspaceIsolation passes when tasks and agents are in same workspace', () => {
    const { checker } = createTestDeps();
    expect(checker.checkWorkspaceIsolation()).toBe(true);
  });

  it('report generates a valid InvariantReport', () => {
    const { checker } = createTestDeps();
    const report = checker.report();
    expect(report.checked).toBe(10);
    expect(report.passed).toBe(10);
    expect(report.violations).toHaveLength(0);
    expect(report.timestamp).toBeDefined();
  });

  it('getViolations returns empty array when no violations', () => {
    const { checker } = createTestDeps();
    expect(checker.getViolations()).toHaveLength(0);
  });

  it('checkEventOrdering detects out-of-order events', () => {
    const { eventBus, checker } = createTestDeps();
    // Manually inject out-of-order events
    eventBus.publish({
      id: asUUID('evt-1'),
      domain: 1 as any,
      type: 'test',
      source: 'src-1',
      data: {},
      timestamp: '2026-01-02T00:00:00Z',
    });
    eventBus.publish({
      id: asUUID('evt-2'),
      domain: 1 as any,
      type: 'test',
      source: 'src-1',
      data: {},
      timestamp: '2026-01-01T00:00:00Z', // Before previous event from same source
    });
    expect(checker.checkEventOrdering()).toBe(false);
  });

  it('checkEventOrdering passes for ordered events', () => {
    const { checker } = createTestDeps();
    expect(checker.checkEventOrdering()).toBe(true);
  });

  it('checkPermissionEnforcement warns about agents with no permissions', () => {
    const { agentRegistry, checker } = createTestDeps();
    agentRegistry.register({
      id: asUUID<AgentID>('agent-1'),
      name: 'test',
      type: 1 as any,
      state: AgentState.READY,
      workspace_id: asUUID('ws-1'),
      project_id: asUUID('proj-1'),
      capabilities: [],
      permissions: [], // No permissions
      resources_allocated: ZERO_BUDGET,
      resources_consumed: ZERO_CONSUMPTION,
      resource_limits: ZERO_BUDGET,
      parent_agent_id: undefined,
      child_agent_ids: [],
      active_task_ids: [],
      completed_task_count: 0,
      failed_task_count: 0,
      owner_user_id: asUUID('user-1'),
      public_key: '',
      metadata: {},
      tags: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    expect(checker.checkPermissionEnforcement()).toBe(false);
  });
});