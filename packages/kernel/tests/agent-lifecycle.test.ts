/**
 * Tests for AgentStateMachine
 */

import { describe, it, expect } from 'vitest';
import { AgentState } from '@agentos/types';
import { AgentStateMachine, type AgentTransitionContext } from '../src/agent-lifecycle.js';

describe('AgentStateMachine', () => {
  it('starts in spawning state', () => {
    const sm = new AgentStateMachine();
    expect(sm.getCurrentState()).toBe(AgentState.SPAWNING);
  });

  it('transitions spawning -> initializing when processCreated', () => {
    const sm = new AgentStateMachine();
    const result = sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(AgentState.INITIALIZING);
  });

  it('rejects spawning -> initializing without processCreated', () => {
    const sm = new AgentStateMachine();
    const result = sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING);
    expect(result.ok).toBe(false);
  });

  it('transitions spawning -> errored when creationFailed', () => {
    const sm = new AgentStateMachine();
    const result = sm.transition(AgentState.SPAWNING, AgentState.ERRORED, { creationFailed: true });
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(AgentState.ERRORED);
    expect(sm.getFailureCount()).toBe(1);
  });

  it('transitions initializing -> ready when capabilitiesLoaded', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    const result = sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(AgentState.READY);
  });

  it('transitions initializing -> errored on crash', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    const result = sm.transition(AgentState.INITIALIZING, AgentState.ERRORED, { crashed: true });
    expect(result.ok).toBe(true);
    expect(sm.getFailureCount()).toBe(1);
  });

  it('transitions initializing -> errored on timeout', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    const result = sm.transition(AgentState.INITIALIZING, AgentState.ERRORED, { timedOut: true });
    expect(result.ok).toBe(true);
  });

  it('transitions ready -> running when taskAssigned AND resourcesAllocated', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    const result = sm.transition(AgentState.READY, AgentState.RUNNING, { taskAssigned: true, resourcesAllocated: true });
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(AgentState.RUNNING);
  });

  it('rejects ready -> running without resourcesAllocated', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    const result = sm.transition(AgentState.READY, AgentState.RUNNING, { taskAssigned: true });
    expect(result.ok).toBe(false);
  });

  it('transitions ready -> terminating on shutdownSignal', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    const result = sm.transition(AgentState.READY, AgentState.TERMINATING, { shutdownSignal: true });
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(AgentState.TERMINATING);
  });

  it('transitions running -> paused on pauseSignal', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    sm.transition(AgentState.READY, AgentState.RUNNING, { taskAssigned: true, resourcesAllocated: true });
    const result = sm.transition(AgentState.RUNNING, AgentState.PAUSED, { pauseSignal: true });
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(AgentState.PAUSED);
  });

  it('transitions running -> paused on preemption', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    sm.transition(AgentState.READY, AgentState.RUNNING, { taskAssigned: true, resourcesAllocated: true });
    const result = sm.transition(AgentState.RUNNING, AgentState.PAUSED, { preemption: true });
    expect(result.ok).toBe(true);
  });

  it('transitions running -> errored on crash', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    sm.transition(AgentState.READY, AgentState.RUNNING, { taskAssigned: true, resourcesAllocated: true });
    const result = sm.transition(AgentState.RUNNING, AgentState.ERRORED, { crashed: true });
    expect(result.ok).toBe(true);
    expect(sm.getFailureCount()).toBe(1);
  });

  it('transitions running -> ready when task unassigned', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    sm.transition(AgentState.READY, AgentState.RUNNING, { taskAssigned: true, resourcesAllocated: true });
    const result = sm.transition(AgentState.RUNNING, AgentState.READY, { taskAssigned: false });
    expect(result.ok).toBe(true);
  });

  it('transitions paused -> running on resume with resources', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    sm.transition(AgentState.READY, AgentState.RUNNING, { taskAssigned: true, resourcesAllocated: true });
    sm.transition(AgentState.RUNNING, AgentState.PAUSED, { pauseSignal: true });
    const result = sm.transition(AgentState.PAUSED, AgentState.RUNNING, { resumeSignal: true, resourcesAvailable: true });
    expect(result.ok).toBe(true);
  });

  it('rejects paused -> running without resourcesAvailable', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    sm.transition(AgentState.READY, AgentState.RUNNING, { taskAssigned: true, resourcesAllocated: true });
    sm.transition(AgentState.RUNNING, AgentState.PAUSED, { pauseSignal: true });
    const result = sm.transition(AgentState.PAUSED, AgentState.RUNNING, { resumeSignal: true, resourcesAvailable: false });
    expect(result.ok).toBe(false);
  });

  it('transitions paused -> terminating on killSignal', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    sm.transition(AgentState.READY, AgentState.PAUSED);
    const result = sm.transition(AgentState.PAUSED, AgentState.TERMINATING, { killSignal: true });
    expect(result.ok).toBe(true);
  });

  it('transitions suspended -> ready on suspensionLifted', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    sm.suspend();
    expect(sm.getCurrentState()).toBe(AgentState.SUSPENDED);
    const result = sm.transition(AgentState.SUSPENDED, AgentState.READY, { suspensionLifted: true });
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(AgentState.READY);
  });

  it('transitions errored -> recovering when failureCount < MAX_RETRIES', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.ERRORED, { crashed: true });
    expect(sm.getFailureCount()).toBe(1);
    const result = sm.transition(AgentState.ERRORED, AgentState.RECOVERING, { budgetAllows: true });
    expect(result.ok).toBe(true);
  });

  it('transitions errored -> terminating when failureCount >= MAX_RETRIES', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.ERRORED, { crashed: true }); // failure 1
    sm.transition(AgentState.ERRORED, AgentState.RECOVERING, { budgetAllows: true });
    sm.transition(AgentState.RECOVERING, AgentState.INITIALIZING);
    sm.transition(AgentState.INITIALIZING, AgentState.ERRORED, { crashed: true }); // failure 2
    sm.transition(AgentState.ERRORED, AgentState.RECOVERING, { budgetAllows: true });
    sm.transition(AgentState.RECOVERING, AgentState.INITIALIZING);
    sm.transition(AgentState.INITIALIZING, AgentState.ERRORED, { crashed: true }); // failure 3
    // Now failureCount = 3 = MAX_RETRIES
    const result = sm.transition(AgentState.ERRORED, AgentState.TERMINATING);
    expect(result.ok).toBe(true);
  });

  it('transitions errored -> terminating when budget exhausted', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.ERRORED, { crashed: true });
    const result = sm.transition(AgentState.ERRORED, AgentState.TERMINATING, { budgetAllows: false });
    expect(result.ok).toBe(true);
  });

  it('transitions recovering -> initializing', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.ERRORED, { crashed: true });
    sm.transition(AgentState.ERRORED, AgentState.RECOVERING, { budgetAllows: true });
    const result = sm.transition(AgentState.RECOVERING, AgentState.INITIALIZING);
    expect(result.ok).toBe(true);
  });

  it('transitions terminating -> terminated on cleanup complete', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    sm.transition(AgentState.READY, AgentState.TERMINATING, { shutdownSignal: true });
    const result = sm.transition(AgentState.TERMINATING, AgentState.TERMINATED, { cleanupComplete: true });
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(AgentState.TERMINATED);
  });

  it('terminated state rejects all transitions', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    sm.transition(AgentState.READY, AgentState.TERMINATING, { shutdownSignal: true });
    sm.transition(AgentState.TERMINATING, AgentState.TERMINATED, { cleanupComplete: true });
    const result = sm.transition(AgentState.TERMINATED, AgentState.READY);
    expect(result.ok).toBe(false);
  });

  it('ANY -> suspended override works from running', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    sm.transition(AgentState.READY, AgentState.RUNNING, { taskAssigned: true, resourcesAllocated: true });
    const result = sm.suspend();
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(AgentState.SUSPENDED);
  });

  it('ANY -> suspended override works from paused', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    sm.transition(AgentState.READY, AgentState.PAUSED);
    const result = sm.suspend();
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(AgentState.SUSPENDED);
  });

  it('suspend rejects from terminated', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    sm.transition(AgentState.READY, AgentState.TERMINATING, { shutdownSignal: true });
    sm.transition(AgentState.TERMINATING, AgentState.TERMINATED, { cleanupComplete: true });
    const result = sm.suspend();
    expect(result.ok).toBe(false);
  });

  it('isTerminal returns true for terminated', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.READY, { capabilitiesLoaded: true });
    sm.transition(AgentState.READY, AgentState.TERMINATING, { shutdownSignal: true });
    sm.transition(AgentState.TERMINATING, AgentState.TERMINATED, { cleanupComplete: true });
    expect(sm.isTerminal()).toBe(true);
  });

  it('reset clears state and failure count', () => {
    const sm = new AgentStateMachine();
    sm.transition(AgentState.SPAWNING, AgentState.INITIALIZING, { processCreated: true });
    sm.transition(AgentState.INITIALIZING, AgentState.ERRORED, { crashed: true });
    sm.reset();
    expect(sm.getCurrentState()).toBe(AgentState.SPAWNING);
    expect(sm.getFailureCount()).toBe(0);
  });
});