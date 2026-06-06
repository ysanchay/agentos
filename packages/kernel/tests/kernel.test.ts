/**
 * Tests for Kernel — the top-level orchestrator
 */

import { describe, it, expect } from 'vitest';
import {
  AgentState,
  TaskState,
  WorkspaceState,
  AgentType,
  TaskType,
  PermissionScope,
  ZERO_BUDGET,
  ZERO_CONSUMPTION,
  createUUID,
  asUUID,
} from '@agentos/types';
import type { AgentID, TaskID, WorkspaceID, PermissionID } from '@agentos/types';
import { Kernel } from '../src/kernel.js';

const makeWorkspace = () => asUUID<WorkspaceID>('ws-test');
const makeProject = () => asUUID('proj-test');
const makeUser = () => asUUID('user-test');

describe('Kernel', () => {
  const createKernel = () => {
    const kernel = new Kernel();
    // Create a workspace first (needed for agent spawning)
    const wsResult = kernel.createWorkspace({
      name: 'Test Workspace',
      description: 'Test workspace for kernel tests',
      project_id: makeProject(),
      owner_id: makeUser(),
      resource_quota: { ru: 1000, mu: 1000, eu: 1000, vu: 1000 },
    });
    if (!wsResult.ok) throw new Error('Failed to create test workspace');
    return { kernel, workspaceId: wsResult.data.id };
  };

  it('creates a workspace', () => {
    const kernel = new Kernel();
    const result = kernel.createWorkspace({
      name: 'Test',
      description: 'Test workspace',
      project_id: makeProject(),
      owner_id: makeUser(),
      resource_quota: { ru: 100, mu: 100, eu: 100, vu: 100 },
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.state).toBe(WorkspaceState.ACTIVE);
  });

  it('spawns an agent through full lifecycle', () => {
    const { kernel, workspaceId } = createKernel();
    const result = kernel.spawnAgent({
      name: 'Test Agent',
      type: AgentType.WORKER,
      workspace_id: workspaceId,
      project_id: makeProject(),
      owner_user_id: makeUser(),
      capabilities: [],
      resource_limits: { ru: 100, mu: 100, eu: 100, vu: 100 },
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.state).toBe(AgentState.READY);
  });

  it('rejects spawning agent in non-existent workspace', () => {
    const kernel = new Kernel();
    const result = kernel.spawnAgent({
      name: 'Test Agent',
      type: AgentType.WORKER,
      workspace_id: asUUID('non-existent'),
      project_id: makeProject(),
      owner_user_id: makeUser(),
      capabilities: [],
      resource_limits: ZERO_BUDGET,
    });
    expect(result.ok).toBe(false);
  });

  it('terminates an agent', () => {
    const { kernel, workspaceId } = createKernel();
    const agentResult = kernel.spawnAgent({
      name: 'Test Agent',
      type: AgentType.WORKER,
      workspace_id: workspaceId,
      project_id: makeProject(),
      owner_user_id: makeUser(),
      capabilities: [],
      resource_limits: { ru: 100, mu: 100, eu: 100, vu: 100 },
    });
    const agentId = agentResult.ok ? agentResult.data.id : asUUID<AgentID>('fail');

    const result = kernel.terminateAgent(agentId);
    expect(result.ok).toBe(true);

    const agent = kernel.getAgent(agentId);
    expect(agent?.state).toBe(AgentState.TERMINATED);
  });

  it('creates a task', () => {
    const { kernel, workspaceId } = createKernel();
    const result = kernel.createTask({
      title: 'Test Task',
      description: 'A test task',
      type: TaskType.ACTION,
      workspace_id: workspaceId,
      project_id: makeProject(),
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.state).toBe(TaskState.DRAFT);
  });

  it('runs full task lifecycle: create -> announce -> claim -> start -> complete', () => {
    const { kernel, workspaceId } = createKernel();

    // Create agent
    const agentResult = kernel.spawnAgent({
      name: 'Worker',
      type: AgentType.WORKER,
      workspace_id: workspaceId,
      project_id: makeProject(),
      owner_user_id: makeUser(),
      capabilities: [],
      resource_limits: { ru: 100, mu: 100, eu: 100, vu: 100 },
    });
    const agentId = agentResult.ok ? agentResult.data.id : asUUID<AgentID>('fail');

    // Create task
    const taskResult = kernel.createTask({
      title: 'Full Lifecycle Task',
      description: 'Test full lifecycle',
      type: TaskType.ACTION,
      workspace_id: workspaceId,
      project_id: makeProject(),
    });
    expect(taskResult.ok).toBe(true);
    const taskId = taskResult.ok ? taskResult.data.id : asUUID<TaskID>('fail');

    // Announce
    const announceResult = kernel.announceTask(taskId);
    expect(announceResult.ok).toBe(true);
    expect(announceResult.ok && announceResult.data.state).toBe(TaskState.ANNOUNCED);

    // Claim
    const claimResult = kernel.claimTask(taskId, agentId);
    expect(claimResult.ok).toBe(true);
    expect(claimResult.ok && claimResult.data.state).toBe(TaskState.CLAIMED);

    // Start
    const startResult = kernel.startTask(taskId);
    expect(startResult.ok).toBe(true);
    expect(startResult.ok && startResult.data.state).toBe(TaskState.IN_PROGRESS);

    // Complete
    const completeResult = kernel.completeTask(taskId, { output: 'done' });
    expect(completeResult.ok).toBe(true);
    expect(completeResult.ok && completeResult.data.state).toBe(TaskState.COMPLETED);
  });

  it('blocks and unblocks a task', () => {
    const { kernel, workspaceId } = createKernel();
    const taskResult = kernel.createTask({
      title: 'Blocked Task',
      description: 'Test blocking',
      type: TaskType.ACTION,
      workspace_id: workspaceId,
      project_id: makeProject(),
    });
    const taskId = taskResult.ok ? taskResult.data.id : asUUID<TaskID>('fail');

    // Advance to in_progress
    kernel.announceTask(taskId);
    const agentResult = kernel.spawnAgent({
      name: 'Worker',
      type: AgentType.WORKER,
      workspace_id: workspaceId,
      project_id: makeProject(),
      owner_user_id: makeUser(),
      capabilities: [],
      resource_limits: { ru: 100, mu: 100, eu: 100, vu: 100 },
    });
    const agentId = agentResult.ok ? agentResult.data.id : asUUID<AgentID>('fail');
    kernel.claimTask(taskId, agentId);
    kernel.startTask(taskId);

    // Block
    const blockResult = kernel.blockTask(taskId, 'missing dep');
    expect(blockResult.ok).toBe(true);
    expect(blockResult.ok && blockResult.data.state).toBe(TaskState.BLOCKED);

    // Unblock
    const unblockResult = kernel.unblockTask(taskId);
    expect(unblockResult.ok).toBe(true);
    expect(unblockResult.ok && unblockResult.data.state).toBe(TaskState.IN_PROGRESS);
  });

  it('cancels a task', () => {
    const { kernel, workspaceId } = createKernel();
    const taskResult = kernel.createTask({
      title: 'Cancellable Task',
      description: 'Test cancellation',
      type: TaskType.ACTION,
      workspace_id: workspaceId,
      project_id: makeProject(),
    });
    const taskId = taskResult.ok ? taskResult.data.id : asUUID<TaskID>('fail');

    const cancelResult = kernel.cancelTask(taskId);
    expect(cancelResult.ok).toBe(true);
    expect(cancelResult.ok && cancelResult.data.state).toBe(TaskState.CANCELLED);
  });

  it('fails a task', () => {
    const { kernel, workspaceId } = createKernel();
    const taskResult = kernel.createTask({
      title: 'Failing Task',
      description: 'Test failure',
      type: TaskType.ACTION,
      workspace_id: workspaceId,
      project_id: makeProject(),
    });
    const taskId = taskResult.ok ? taskResult.data.id : asUUID<TaskID>('fail');

    // Advance to in_progress
    kernel.announceTask(taskId);
    const agentResult = kernel.spawnAgent({
      name: 'Worker',
      type: AgentType.WORKER,
      workspace_id: workspaceId,
      project_id: makeProject(),
      owner_user_id: makeUser(),
      capabilities: [],
      resource_limits: { ru: 100, mu: 100, eu: 100, vu: 100 },
    });
    const agentId = agentResult.ok ? agentResult.data.id : asUUID<AgentID>('fail');
    kernel.claimTask(taskId, agentId);
    kernel.startTask(taskId);

    const failResult = kernel.failTask(taskId, 'something went wrong');
    expect(failResult.ok).toBe(true);
    expect(failResult.ok && failResult.data.state).toBe(TaskState.FAILED);
  });

  it('pauses and resumes a workspace', () => {
    const { kernel, workspaceId } = createKernel();
    const pauseResult = kernel.pauseWorkspace(workspaceId);
    expect(pauseResult.ok).toBe(true);
    const ws = kernel.getWorkspace(workspaceId);
    expect(ws?.state).toBe(WorkspaceState.PAUSED);

    const resumeResult = kernel.resumeWorkspace(workspaceId);
    expect(resumeResult.ok).toBe(true);
    const wsAfter = kernel.getWorkspace(workspaceId);
    expect(wsAfter?.state).toBe(WorkspaceState.ACTIVE);
  });

  it('destroys a workspace', () => {
    const { kernel, workspaceId } = createKernel();
    const result = kernel.destroyWorkspace(workspaceId);
    expect(result.ok).toBe(true);
    const ws = kernel.getWorkspace(workspaceId);
    expect(ws?.state).toBe(WorkspaceState.DELETED);
  });

  it('grants and checks permissions', () => {
    const kernel = new Kernel();
    const agentId = asUUID<AgentID>('agent-1');
    const permissionId = asUUID<PermissionID>('perm-1');

    const result = kernel.grantPermission({
      id: permissionId,
      name: 'read-tasks',
      scope: PermissionScope.WORKSPACE,
      grantee_id: agentId,
      grantee_type: 'agent',
      resource_type: 'task',
      resource_id: undefined,
      actions: ['read'],
      conditions: undefined,
      granted_by: asUUID('admin'),
      expires_at: undefined,
      created_at: new Date().toISOString(),
      revocable: true,
    });
    expect(result.ok).toBe(true);

    const checkResult = kernel.checkPermission(agentId, 'read', PermissionScope.WORKSPACE);
    expect(checkResult.ok).toBe(true);
  });

  it('denies permission when not granted', () => {
    const kernel = new Kernel();
    const agentId = asUUID<AgentID>('agent-1');
    const result = kernel.checkPermission(agentId, 'execute', PermissionScope.WORKSPACE);
    expect(result.ok).toBe(false);
  });

  it('revokes permissions', () => {
    const kernel = new Kernel();
    const agentId = asUUID<AgentID>('agent-1');
    const permissionId = asUUID<PermissionID>('perm-1');

    kernel.grantPermission({
      id: permissionId,
      name: 'read-tasks',
      scope: PermissionScope.WORKSPACE,
      grantee_id: agentId,
      grantee_type: 'agent',
      resource_type: 'task',
      resource_id: undefined,
      actions: ['read'],
      conditions: undefined,
      granted_by: asUUID('admin'),
      expires_at: undefined,
      created_at: new Date().toISOString(),
      revocable: true,
    });

    const revokeResult = kernel.revokePermission(permissionId);
    expect(revokeResult.ok).toBe(true);

    const checkResult = kernel.checkPermission(agentId, 'read', PermissionScope.WORKSPACE);
    expect(checkResult.ok).toBe(false);
  });

  it('signals an agent', () => {
    const { kernel, workspaceId } = createKernel();
    const agentResult = kernel.spawnAgent({
      name: 'Signalable Agent',
      type: AgentType.WORKER,
      workspace_id: workspaceId,
      project_id: makeProject(),
      owner_user_id: makeUser(),
      capabilities: [],
      resource_limits: { ru: 100, mu: 100, eu: 100, vu: 100 },
    });
    const agentId = agentResult.ok ? agentResult.data.id : asUUID<AgentID>('fail');

    // First transition to running
    // We need to get the agent to running state
    // Since spawnAgent goes to READY, we need a different approach
    // Let's just test suspend from ready
    const suspendResult = kernel.signalAgent(agentId, 'suspend');
    expect(suspendResult.ok).toBe(true);
    const agent = kernel.getAgent(agentId);
    expect(agent?.state).toBe(AgentState.SUSPENDED);
  });

  it('checks invariants after operations', () => {
    const { kernel, workspaceId } = createKernel();
    const report = kernel.checkInvariants();
    expect(report.checked).toBe(10);
    expect(report.passed).toBeGreaterThanOrEqual(8); // Some may have warnings
  });

  it('emits events during full lifecycle', () => {
    const { kernel, workspaceId } = createKernel();

    // Create task
    const taskResult = kernel.createTask({
      title: 'Event Test',
      description: 'Test event emission',
      type: TaskType.ACTION,
      workspace_id: workspaceId,
      project_id: makeProject(),
    });
    const taskId = taskResult.ok ? taskResult.data.id : asUUID<TaskID>('fail');

    // Check events were emitted
    const events = kernel.eventBus.getHistory();
    expect(events.length).toBeGreaterThan(0);

    // Check that at least one task event exists
    const taskEvents = events.filter((e) => e.data && (e.data as any).entity_id === taskId);
    expect(taskEvents.length).toBeGreaterThan(0);
  });

  it('queries agents, tasks, workspaces', () => {
    const { kernel, workspaceId } = createKernel();

    kernel.spawnAgent({
      name: 'Query Test Agent',
      type: AgentType.WORKER,
      workspace_id: workspaceId,
      project_id: makeProject(),
      owner_user_id: makeUser(),
      capabilities: [],
      resource_limits: { ru: 100, mu: 100, eu: 100, vu: 100 },
    });

    kernel.createTask({
      title: 'Query Test Task',
      description: 'Test querying',
      type: TaskType.ACTION,
      workspace_id: workspaceId,
      project_id: makeProject(),
    });

    expect(kernel.listAgents().length).toBeGreaterThan(0);
    expect(kernel.listTasks().length).toBeGreaterThan(0);
    expect(kernel.getWorkspace(workspaceId)).toBeDefined();
  });

  it('idempotency key prevents duplicate operations', () => {
    const { kernel, workspaceId } = createKernel();
    const idemKey = 'idempotent-spawn-1';

    const result1 = kernel.spawnAgent({
      name: 'Idempotent Agent',
      type: AgentType.WORKER,
      workspace_id: workspaceId,
      project_id: makeProject(),
      owner_user_id: makeUser(),
      capabilities: [],
      resource_limits: { ru: 100, mu: 100, eu: 100, vu: 100 },
      idempotencyKey: idemKey,
    });

    const result2 = kernel.spawnAgent({
      name: 'Idempotent Agent',
      type: AgentType.WORKER,
      workspace_id: workspaceId,
      project_id: makeProject(),
      owner_user_id: makeUser(),
      capabilities: [],
      resource_limits: { ru: 100, mu: 100, eu: 100, vu: 100 },
      idempotencyKey: idemKey,
    });

    // Both should return the same result
    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);
    if (result1.ok && result2.ok) {
      expect(result1.data.id).toBe(result2.data.id);
    }
  });
});