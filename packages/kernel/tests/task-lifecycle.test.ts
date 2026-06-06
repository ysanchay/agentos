/**
 * Tests for TaskStateMachine
 */

import { describe, it, expect } from 'vitest';
import { TaskState, MAX_TASK_RETRIES } from '@agentos/types';
import { TaskStateMachine, type TaskTransitionContext } from '../src/task-lifecycle.js';

describe('TaskStateMachine', () => {
  it('starts in draft state', () => {
    const sm = new TaskStateMachine();
    expect(sm.getCurrentState()).toBe(TaskState.DRAFT);
  });

  it('transitions draft -> announced when fully defined with valid deps', () => {
    const sm = new TaskStateMachine();
    const result = sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true,
      depsValid: true,
      creatorHasPermission: true,
    });
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(TaskState.ANNOUNCED);
  });

  it('rejects draft -> announced without fullyDefined', () => {
    const sm = new TaskStateMachine();
    const result = sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: false,
      depsValid: true,
      creatorHasPermission: true,
    });
    expect(result.ok).toBe(false);
  });

  it('transitions draft -> cancelled', () => {
    const sm = new TaskStateMachine();
    const result = sm.transition(TaskState.DRAFT, TaskState.CANCELLED, { goalCancelled: true });
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(TaskState.CANCELLED);
  });

  it('transitions announced -> claimed', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    const result = sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(TaskState.CLAIMED);
  });

  it('transitions announced -> cancelled', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    const result = sm.transition(TaskState.ANNOUNCED, TaskState.CANCELLED, { goalCancelled: true });
    expect(result.ok).toBe(true);
  });

  it('transitions claimed -> in_progress', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    const result = sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    expect(result.ok).toBe(true);
  });

  it('transitions claimed -> announced on claim released', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    const result = sm.transition(TaskState.CLAIMED, TaskState.ANNOUNCED, { claimReleased: true });
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe(TaskState.ANNOUNCED);
  });

  it('transitions claimed -> announced on timeout', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    const result = sm.transition(TaskState.CLAIMED, TaskState.ANNOUNCED, { claimTimeout: true });
    expect(result.ok).toBe(true);
  });

  it('transitions in_progress -> blocked', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    const result = sm.transition(TaskState.IN_PROGRESS, TaskState.BLOCKED, { missingDependency: true });
    expect(result.ok).toBe(true);
  });

  it('transitions in_progress -> review', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    const result = sm.transition(TaskState.IN_PROGRESS, TaskState.REVIEW, { resultSubmitted: true });
    expect(result.ok).toBe(true);
  });

  it('transitions in_progress -> completed', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    const result = sm.transition(TaskState.IN_PROGRESS, TaskState.COMPLETED, { resultAccepted: true });
    expect(result.ok).toBe(true);
  });

  it('transitions in_progress -> failed', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    const result = sm.transition(TaskState.IN_PROGRESS, TaskState.FAILED, { unrecoverableFailure: true });
    expect(result.ok).toBe(true);
    expect(sm.getRetryCount()).toBe(1);
  });

  it('transitions blocked -> in_progress when resolved', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    sm.transition(TaskState.IN_PROGRESS, TaskState.BLOCKED, { missingDependency: true });
    const result = sm.transition(TaskState.BLOCKED, TaskState.IN_PROGRESS, { blockerResolved: true });
    expect(result.ok).toBe(true);
  });

  it('transitions blocked -> failed when unresolvable', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    sm.transition(TaskState.IN_PROGRESS, TaskState.BLOCKED, { missingDependency: true });
    const result = sm.transition(TaskState.BLOCKED, TaskState.FAILED, { blockerUnresolvable: true });
    expect(result.ok).toBe(true);
  });

  it('transitions blocked -> announced when agent gives up', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    sm.transition(TaskState.IN_PROGRESS, TaskState.BLOCKED, { missingDependency: true });
    const result = sm.transition(TaskState.BLOCKED, TaskState.ANNOUNCED, { agentGivesUp: true });
    expect(result.ok).toBe(true);
  });

  it('transitions review -> completed when approved', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    sm.transition(TaskState.IN_PROGRESS, TaskState.REVIEW, { resultSubmitted: true });
    const result = sm.transition(TaskState.REVIEW, TaskState.COMPLETED, { validatorApproves: true });
    expect(result.ok).toBe(true);
  });

  it('transitions review -> failed when rejected', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    sm.transition(TaskState.IN_PROGRESS, TaskState.REVIEW, { resultSubmitted: true });
    const result = sm.transition(TaskState.REVIEW, TaskState.FAILED, { validatorRejects: true });
    expect(result.ok).toBe(true);
    expect(sm.getRetryCount()).toBe(1);
  });

  it('transitions failed -> announced when retries available', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    sm.transition(TaskState.IN_PROGRESS, TaskState.FAILED, { unrecoverableFailure: true });
    const result = sm.transition(TaskState.FAILED, TaskState.ANNOUNCED, {
      retryCount: 1,
      maxRetries: 3,
      retryApproved: true,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects failed -> announced when retries exhausted', () => {
    const sm = new TaskStateMachine(2); // Already 2 retries
    // Force into failed state
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    sm.transition(TaskState.IN_PROGRESS, TaskState.FAILED, { unrecoverableFailure: true });
    // retryCount is now 3 (2 initial + 1 from this failure)
    const result = sm.transition(TaskState.FAILED, TaskState.ANNOUNCED, {
      retryApproved: true,
    });
    expect(result.ok).toBe(false);
  });

  it('completed is terminal', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    sm.transition(TaskState.IN_PROGRESS, TaskState.COMPLETED, { resultAccepted: true });
    expect(sm.isTerminal()).toBe(true);
  });

  it('cancelled is terminal', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.CANCELLED, { goalCancelled: true });
    expect(sm.isTerminal()).toBe(true);
  });

  it('failed is terminal when max retries exhausted', () => {
    const sm = new TaskStateMachine(MAX_TASK_RETRIES - 1);
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    sm.transition(TaskState.IN_PROGRESS, TaskState.FAILED, { unrecoverableFailure: true });
    expect(sm.isTerminal()).toBe(true);
  });

  it('reset clears state and retry count', () => {
    const sm = new TaskStateMachine();
    sm.transition(TaskState.DRAFT, TaskState.ANNOUNCED, {
      fullyDefined: true, depsValid: true, creatorHasPermission: true,
    });
    sm.transition(TaskState.ANNOUNCED, TaskState.CLAIMED, { claimAccepted: true });
    sm.transition(TaskState.CLAIMED, TaskState.IN_PROGRESS, { workStarted: true });
    sm.transition(TaskState.IN_PROGRESS, TaskState.FAILED, { unrecoverableFailure: true });
    sm.reset();
    expect(sm.getCurrentState()).toBe(TaskState.DRAFT);
    expect(sm.getRetryCount()).toBe(0);
  });
});