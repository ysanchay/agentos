/**
 * Tests for AgentRegistry
 */

import { describe, it, expect } from 'vitest';
import { AgentState, AgentType, ZERO_BUDGET, ZERO_CONSUMPTION, createUUID, asUUID } from '@agentos/types';
import type { Agent, AgentID } from '@agentos/types';
import { AgentRegistry } from '../src/agent-registry.js';

const makeAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: createUUID() as AgentID,
  name: 'test-agent',
  type: AgentType.WORKER,
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
  ...overrides,
});

describe('AgentRegistry', () => {
  it('registers an agent', () => {
    const reg = new AgentRegistry();
    const agent = makeAgent();
    const result = reg.register(agent);
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.id).toBe(agent.id);
  });

  it('rejects duplicate registration', () => {
    const reg = new AgentRegistry();
    const agent = makeAgent();
    reg.register(agent);
    const result = reg.register(agent);
    expect(result.ok).toBe(false);
  });

  it('gets an agent by ID', () => {
    const reg = new AgentRegistry();
    const agent = makeAgent();
    reg.register(agent);
    const found = reg.get(agent.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(agent.id);
  });

  it('returns undefined for non-existent agent', () => {
    const reg = new AgentRegistry();
    const found = reg.get(asUUID('non-existent'));
    expect(found).toBeUndefined();
  });

  it('deregisters an agent', () => {
    const reg = new AgentRegistry();
    const agent = makeAgent();
    reg.register(agent);
    const result = reg.deregister(agent.id);
    expect(result.ok).toBe(true);
    expect(reg.get(agent.id)).toBeUndefined();
  });

  it('rejects deregister for non-existent agent', () => {
    const reg = new AgentRegistry();
    const result = reg.deregister(asUUID('non-existent'));
    expect(result.ok).toBe(false);
  });

  it('lists all agents', () => {
    const reg = new AgentRegistry();
    reg.register(makeAgent());
    reg.register(makeAgent());
    expect(reg.list()).toHaveLength(2);
  });

  it('lists agents by workspace', () => {
    const reg = new AgentRegistry();
    const ws1 = asUUID('ws-1');
    const ws2 = asUUID('ws-2');
    reg.register(makeAgent({ workspace_id: ws1 }));
    reg.register(makeAgent({ workspace_id: ws1 }));
    reg.register(makeAgent({ workspace_id: ws2 }));
    expect(reg.findByWorkspace(ws1)).toHaveLength(2);
    expect(reg.findByWorkspace(ws2)).toHaveLength(1);
  });

  it('lists agents by capability', () => {
    const reg = new AgentRegistry();
    const cap = asUUID('cap.search');
    reg.register(makeAgent({ capabilities: [cap] }));
    reg.register(makeAgent({ capabilities: [cap] }));
    reg.register(makeAgent({ capabilities: [] }));
    expect(reg.findByCapability('cap.search')).toHaveLength(2);
  });

  it('lists agents by state', () => {
    const reg = new AgentRegistry();
    reg.register(makeAgent({ state: AgentState.READY }));
    reg.register(makeAgent({ state: AgentState.READY }));
    reg.register(makeAgent({ state: AgentState.RUNNING }));
    expect(reg.findByState(AgentState.READY)).toHaveLength(2);
    expect(reg.findByState(AgentState.RUNNING)).toHaveLength(1);
  });

  it('updates an agent', () => {
    const reg = new AgentRegistry();
    const agent = makeAgent();
    reg.register(agent);
    const result = reg.update(agent.id, { name: 'updated-name' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.name).toBe('updated-name');
  });

  it('preserves ID on update', () => {
    const reg = new AgentRegistry();
    const agent = makeAgent();
    reg.register(agent);
    const result = reg.update(agent.id, { id: asUUID('different-id') } as any);
    expect(result.ok && result.data.id).toBe(agent.id);
  });

  it('rejects update for non-existent agent', () => {
    const reg = new AgentRegistry();
    const result = reg.update(asUUID('non-existent'), { name: 'x' });
    expect(result.ok).toBe(false);
  });

  it('returns correct size', () => {
    const reg = new AgentRegistry();
    expect(reg.size()).toBe(0);
    reg.register(makeAgent());
    expect(reg.size()).toBe(1);
  });

  it('clears all agents', () => {
    const reg = new AgentRegistry();
    reg.register(makeAgent());
    reg.register(makeAgent());
    reg.clear();
    expect(reg.size()).toBe(0);
  });
});