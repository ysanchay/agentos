/**
 * Tests for WorkspaceRegistry
 */

import { describe, it, expect } from 'vitest';
import { WorkspaceState, ZERO_BUDGET, ZERO_CONSUMPTION, createUUID, asUUID, TASK_PRIORITY_NORMAL } from '@agentos/types';
import type { Workspace, WorkspaceID } from '@agentos/types';
import { WorkspaceRegistry } from '../src/workspace-registry.js';

const makeWorkspace = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: createUUID() as WorkspaceID,
  name: 'Test Workspace',
  description: 'A test workspace',
  state: WorkspaceState.ACTIVE,
  project_id: asUUID('proj-1'),
  owner_id: asUUID('user-1'),
  agent_ids: [],
  task_ids: [],
  resource_quota: ZERO_BUDGET,
  resource_consumed: ZERO_CONSUMPTION,
  max_agents: 10,
  memory_scope: 'workspace',
  default_priority: TASK_PRIORITY_NORMAL,
  auto_pause_on_budget_exhaustion: true,
  metadata: {},
  tags: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe('WorkspaceRegistry', () => {
  it('creates a workspace', () => {
    const reg = new WorkspaceRegistry();
    const ws = makeWorkspace();
    const result = reg.create(ws);
    expect(result.ok).toBe(true);
  });

  it('rejects duplicate creation', () => {
    const reg = new WorkspaceRegistry();
    const ws = makeWorkspace();
    reg.create(ws);
    const result = reg.create(ws);
    expect(result.ok).toBe(false);
  });

  it('gets a workspace by ID', () => {
    const reg = new WorkspaceRegistry();
    const ws = makeWorkspace();
    reg.create(ws);
    const found = reg.get(ws.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(ws.id);
  });

  it('returns undefined for non-existent workspace', () => {
    const reg = new WorkspaceRegistry();
    expect(reg.get(asUUID('non-existent'))).toBeUndefined();
  });

  it('lists all workspaces', () => {
    const reg = new WorkspaceRegistry();
    reg.create(makeWorkspace());
    reg.create(makeWorkspace());
    expect(reg.list()).toHaveLength(2);
  });

  it('updates a workspace', () => {
    const reg = new WorkspaceRegistry();
    const ws = makeWorkspace();
    reg.create(ws);
    const result = reg.update(ws.id, { name: 'Updated' });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.name).toBe('Updated');
  });

  it('preserves ID on update', () => {
    const reg = new WorkspaceRegistry();
    const ws = makeWorkspace();
    reg.create(ws);
    const result = reg.update(ws.id, { id: asUUID('different') } as any);
    expect(result.ok && result.data.id).toBe(ws.id);
  });

  it('rejects update for non-existent workspace', () => {
    const reg = new WorkspaceRegistry();
    const result = reg.update(asUUID('non-existent'), { name: 'x' });
    expect(result.ok).toBe(false);
  });

  it('deletes a workspace', () => {
    const reg = new WorkspaceRegistry();
    const ws = makeWorkspace();
    reg.create(ws);
    const result = reg.delete(ws.id);
    expect(result.ok).toBe(true);
    expect(reg.get(ws.id)).toBeUndefined();
  });

  it('rejects delete for non-existent workspace', () => {
    const reg = new WorkspaceRegistry();
    const result = reg.delete(asUUID('non-existent'));
    expect(result.ok).toBe(false);
  });

  it('returns correct size', () => {
    const reg = new WorkspaceRegistry();
    expect(reg.size()).toBe(0);
    reg.create(makeWorkspace());
    expect(reg.size()).toBe(1);
  });

  it('clears all workspaces', () => {
    const reg = new WorkspaceRegistry();
    reg.create(makeWorkspace());
    reg.create(makeWorkspace());
    reg.clear();
    expect(reg.size()).toBe(0);
  });
});