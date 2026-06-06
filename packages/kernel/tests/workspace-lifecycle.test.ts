/**
 * Tests for WorkspaceStateMachine
 */

import { describe, it, expect } from 'vitest';
import { WorkspaceState } from '@agentos/types';
import { WorkspaceStateMachine } from '../src/workspace-lifecycle.js';

describe('WorkspaceStateMachine', () => {
  it('starts in creating state', () => {
    const sm = new WorkspaceStateMachine();
    expect(sm.getCurrentState()).toBe(WorkspaceState.CREATING);
  });

  it('transitions creating -> active', () => {
    const sm = new WorkspaceStateMachine();
    const result = sm.transition(WorkspaceState.CREATING, WorkspaceState.ACTIVE, {
      agentsSpawned: true,
      resourcesAllocated: true,
    });
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(WorkspaceState.ACTIVE);
  });

  it('rejects creating -> active without agents spawned', () => {
    const sm = new WorkspaceStateMachine();
    const result = sm.transition(WorkspaceState.CREATING, WorkspaceState.ACTIVE, {
      resourcesAllocated: true,
    });
    expect(result.ok).toBe(false);
  });

  it('transitions creating -> deleting on init failed', () => {
    const sm = new WorkspaceStateMachine();
    const result = sm.transition(WorkspaceState.CREATING, WorkspaceState.DELETING, {
      initFailed: true,
    });
    expect(result.ok).toBe(true);
  });

  it('transitions active -> paused on budget exhausted', () => {
    const sm = new WorkspaceStateMachine();
    sm.transition(WorkspaceState.CREATING, WorkspaceState.ACTIVE, {
      agentsSpawned: true, resourcesAllocated: true,
    });
    const result = sm.transition(WorkspaceState.ACTIVE, WorkspaceState.PAUSED, {
      budgetExhausted: true,
    });
    expect(result.ok).toBe(true);
  });

  it('transitions active -> paused on admin pause', () => {
    const sm = new WorkspaceStateMachine();
    sm.transition(WorkspaceState.CREATING, WorkspaceState.ACTIVE, {
      agentsSpawned: true, resourcesAllocated: true,
    });
    const result = sm.transition(WorkspaceState.ACTIVE, WorkspaceState.PAUSED, {
      adminPause: true,
    });
    expect(result.ok).toBe(true);
  });

  it('transitions active -> locked on security incident', () => {
    const sm = new WorkspaceStateMachine();
    sm.transition(WorkspaceState.CREATING, WorkspaceState.ACTIVE, {
      agentsSpawned: true, resourcesAllocated: true,
    });
    const result = sm.transition(WorkspaceState.ACTIVE, WorkspaceState.LOCKED, {
      securityIncident: true,
    });
    expect(result.ok).toBe(true);
  });

  it('transitions active -> archiving on archive request', () => {
    const sm = new WorkspaceStateMachine();
    sm.transition(WorkspaceState.CREATING, WorkspaceState.ACTIVE, {
      agentsSpawned: true, resourcesAllocated: true,
    });
    const result = sm.transition(WorkspaceState.ACTIVE, WorkspaceState.ARCHIVING, {
      archiveRequest: true,
    });
    expect(result.ok).toBe(true);
  });

  it('transitions paused -> active on budget restored', () => {
    const sm = new WorkspaceStateMachine();
    sm.transition(WorkspaceState.CREATING, WorkspaceState.ACTIVE, {
      agentsSpawned: true, resourcesAllocated: true,
    });
    sm.transition(WorkspaceState.ACTIVE, WorkspaceState.PAUSED, { budgetExhausted: true });
    const result = sm.transition(WorkspaceState.PAUSED, WorkspaceState.ACTIVE, {
      budgetRestored: true,
    });
    expect(result.ok).toBe(true);
  });

  it('transitions locked -> active on incident resolved', () => {
    const sm = new WorkspaceStateMachine();
    sm.transition(WorkspaceState.CREATING, WorkspaceState.ACTIVE, {
      agentsSpawned: true, resourcesAllocated: true,
    });
    sm.transition(WorkspaceState.ACTIVE, WorkspaceState.LOCKED, { securityIncident: true });
    const result = sm.transition(WorkspaceState.LOCKED, WorkspaceState.ACTIVE, {
      incidentResolved: true,
    });
    expect(result.ok).toBe(true);
  });

  it('transitions locked -> deleting on irrecoverable', () => {
    const sm = new WorkspaceStateMachine();
    sm.transition(WorkspaceState.CREATING, WorkspaceState.ACTIVE, {
      agentsSpawned: true, resourcesAllocated: true,
    });
    sm.transition(WorkspaceState.ACTIVE, WorkspaceState.LOCKED, { securityIncident: true });
    const result = sm.transition(WorkspaceState.LOCKED, WorkspaceState.DELETING, {
      irrecoverable: true,
    });
    expect(result.ok).toBe(true);
  });

  it('transitions archiving -> archived', () => {
    const sm = new WorkspaceStateMachine();
    sm.transition(WorkspaceState.CREATING, WorkspaceState.ACTIVE, {
      agentsSpawned: true, resourcesAllocated: true,
    });
    sm.transition(WorkspaceState.ACTIVE, WorkspaceState.ARCHIVING, { archiveRequest: true });
    const result = sm.transition(WorkspaceState.ARCHIVING, WorkspaceState.ARCHIVED, {
      agentsTerminated: true,
    });
    expect(result.ok).toBe(true);
  });

  it('transitions archived -> active on admin restore', () => {
    const sm = new WorkspaceStateMachine();
    sm.transition(WorkspaceState.CREATING, WorkspaceState.ACTIVE, {
      agentsSpawned: true, resourcesAllocated: true,
    });
    sm.transition(WorkspaceState.ACTIVE, WorkspaceState.ARCHIVING, { archiveRequest: true });
    sm.transition(WorkspaceState.ARCHIVING, WorkspaceState.ARCHIVED, { agentsTerminated: true });
    const result = sm.transition(WorkspaceState.ARCHIVED, WorkspaceState.ACTIVE, {
      adminRestore: true,
    });
    expect(result.ok).toBe(true);
  });

  it('transitions deleting -> deleted', () => {
    const sm = new WorkspaceStateMachine();
    sm.transition(WorkspaceState.CREATING, WorkspaceState.DELETING, { initFailed: true });
    const result = sm.transition(WorkspaceState.DELETING, WorkspaceState.DELETED);
    expect(result.ok).toBe(true);
  });

  it('deleted is terminal', () => {
    const sm = new WorkspaceStateMachine();
    sm.transition(WorkspaceState.CREATING, WorkspaceState.DELETING, { initFailed: true });
    sm.transition(WorkspaceState.DELETING, WorkspaceState.DELETED);
    expect(sm.isTerminal()).toBe(true);
    // No transitions from deleted
    const result = sm.transition(WorkspaceState.DELETED, WorkspaceState.ACTIVE);
    expect(result.ok).toBe(false);
  });

  it('reset clears state', () => {
    const sm = new WorkspaceStateMachine();
    sm.transition(WorkspaceState.CREATING, WorkspaceState.ACTIVE, {
      agentsSpawned: true, resourcesAllocated: true,
    });
    sm.reset();
    expect(sm.getCurrentState()).toBe(WorkspaceState.CREATING);
  });
});