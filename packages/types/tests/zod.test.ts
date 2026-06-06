import { describe, it, expect } from 'vitest';
import { zAgentState, zAgentType, zAgent } from '../zod/agents.js';
import { zTaskState, zTaskType, zTask } from '../zod/tasks.js';
import { zWorkspaceState } from '../zod/workspaces.js';
import { zResourceBudget, zResourceConsumption } from '../zod/resource-types.js';
import { zCapabilityPath, zRootCapability, zCostModel } from '../zod/capabilities.js';
import { zACPMessage, zMessageType } from '../zod/acp.js';
import { zPriority } from '../zod/common.js';
import { zAllocationState } from '../zod/allocations.js';
import { zEventDomain } from '../zod/events.js';
import { zApprovalType } from '../zod/approvals.js';

const makeAgent = () => ({
  id: crypto.randomUUID(),
  name: 'test-agent',
  type: 'worker' as const,
  state: 'running' as const,
  workspace_id: crypto.randomUUID(),
  project_id: crypto.randomUUID(),
  capabilities: [],
  permissions: [],
  resources_allocated: { ru: 0, mu: 0, eu: 0, vu: 0 },
  resources_consumed: { ru: 0, mu: 0, eu: 0, vu: 0 },
  resource_limits: { ru: 100, mu: 50, eu: 200, vu: 10 },
  child_agent_ids: [],
  active_task_ids: [],
  completed_task_count: 0,
  failed_task_count: 0,
  owner_user_id: crypto.randomUUID(),
  public_key: 'test-public-key',
  metadata: {},
  tags: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

describe('Zod Schemas', () => {
  it('validates a valid Agent', () => {
    const result = zAgent.safeParse(makeAgent());
    expect(result.success).toBe(true);
  });

  it('rejects invalid Agent state', () => {
    const agent = { ...makeAgent(), state: 'flying' };
    const result = zAgent.safeParse(agent);
    expect(result.success).toBe(false);
  });

  it('validates AgentState enum', () => {
    expect(zAgentState.safeParse('running').success).toBe(true);
    expect(zAgentState.safeParse('flying').success).toBe(false);
  });

  it('validates TaskState enum', () => {
    expect(zTaskState.safeParse('in_progress').success).toBe(true);
    expect(zTaskState.safeParse('sleeping').success).toBe(false);
  });

  it('validates ResourceBudget', () => {
    expect(zResourceBudget.safeParse({ ru: 10, mu: 20, eu: 30, vu: 40 }).success).toBe(true);
    expect(zResourceBudget.safeParse({ ru: -1, mu: 0, eu: 0, vu: 0 }).success).toBe(false);
  });

  it('validates Priority', () => {
    expect(zPriority.safeParse(3).success).toBe(true);
    expect(zPriority.safeParse(6).success).toBe(false);
    expect(zPriority.safeParse(-1).success).toBe(false);
  });

  it('validates CapabilityPath', () => {
    expect(zCapabilityPath.safeParse('compute.math').success).toBe(true);
    expect(zCapabilityPath.safeParse('INVALID').success).toBe(false);
  });

  it('validates CostModel discriminated union', () => {
    expect(zCostModel.safeParse({ type: 'free' }).success).toBe(true);
    expect(zCostModel.safeParse({ type: 'per_call', cost: { ru: 1, mu: 0, eu: 0, vu: 0 } }).success).toBe(true);
    expect(zCostModel.safeParse({ type: 'invalid' }).success).toBe(false);
  });

  it('validates ACP MessageType', () => {
    expect(zMessageType.safeParse('agent.spawn').success).toBe(true);
    expect(zMessageType.safeParse('agent.fly').success).toBe(false);
  });

  it('validates EventDomain', () => {
    expect(zEventDomain.safeParse('task').success).toBe(true);
    expect(zEventDomain.safeParse('unknown').success).toBe(false);
  });

  it('validates AllocationState', () => {
    expect(zAllocationState.safeParse('active').success).toBe(true);
    expect(zAllocationState.safeParse('pending_approval').success).toBe(false);
  });

  it('validates ApprovalType', () => {
    expect(zApprovalType.safeParse('agent_spawn').success).toBe(true);
  });
});