/**
 * Tests for GenericStateMachine
 */

import { describe, it, expect, vi } from 'vitest';
import { GenericStateMachine } from '../src/state-machine.js';

type TestState = 'idle' | 'running' | 'done' | 'failed';

describe('GenericStateMachine', () => {
  const createMachine = (onTransition?: (from: TestState, to: TestState) => void) => {
    return new GenericStateMachine<TestState>(
      'idle',
      [
        { from: 'idle', to: 'running', guard: (ctx?: { canStart?: boolean }) => ctx?.canStart === true },
        { from: 'idle', to: 'failed' },
        { from: 'running', to: 'done', sideEffect: (ctx?: { log?: string[] }) => { if (ctx?.log) ctx.log.push('completed'); } },
        { from: 'running', to: 'failed' },
      ],
      ['done', 'failed'],
      onTransition,
    );
  };

  it('starts at the initial state', () => {
    const sm = createMachine();
    expect(sm.getCurrentState()).toBe('idle');
  });

  it('performs a valid transition', () => {
    const sm = createMachine();
    const result = sm.transition('idle', 'failed');
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe('failed');
  });

  it('performs a guarded transition when guard passes', () => {
    const sm = createMachine();
    const result = sm.transition('idle', 'running', { canStart: true });
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe('running');
  });

  it('rejects a guarded transition when guard fails', () => {
    const sm = createMachine();
    const result = sm.transition('idle', 'running', { canStart: false });
    expect(result.ok).toBe(false);
    expect(sm.getCurrentState()).toBe('idle');
  });

  it('rejects transitions with no matching definition', () => {
    const sm = createMachine();
    const result = sm.transition('idle', 'done');
    expect(result.ok).toBe(false);
  });

  it('rejects transitions from wrong current state', () => {
    const sm = createMachine();
    const result = sm.transition('running', 'done'); // current is idle, not running
    expect(result.ok).toBe(false);
  });

  it('rejects transitions from terminal states', () => {
    const sm = createMachine();
    sm.transition('idle', 'failed');
    // Now in terminal state 'failed'
    const result = sm.transition('failed', 'idle');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error_code).toBe('KER-0004');
  });

  it('fires side effects on transition', () => {
    const log: string[] = [];
    const sm = createMachine();
    sm.transition('idle', 'running', { canStart: true });
    sm.transition('running', 'done', { log });
    expect(log).toContain('completed');
  });

  it('records transition history', () => {
    const sm = createMachine();
    sm.transition('idle', 'failed');
    const history = sm.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.from).toBe('idle');
    expect(history[0]!.to).toBe('failed');
  });

  it('calls onTransition callback', () => {
    const callback = vi.fn();
    const sm = createMachine(callback);
    sm.transition('idle', 'failed');
    expect(callback).toHaveBeenCalledWith('idle', 'failed', undefined);
  });

  it('canTransition returns true for valid guarded transition', () => {
    const sm = createMachine();
    expect(sm.canTransition('idle', 'running', { canStart: true })).toBe(true);
  });

  it('canTransition returns false when guard rejects', () => {
    const sm = createMachine();
    expect(sm.canTransition('idle', 'running', { canStart: false })).toBe(false);
  });

  it('canTransition returns false from terminal state', () => {
    const sm = createMachine();
    sm.transition('idle', 'failed');
    expect(sm.canTransition('failed', 'idle')).toBe(false);
  });

  it('isTerminal returns true for terminal state', () => {
    const sm = createMachine();
    sm.transition('idle', 'failed');
    expect(sm.isTerminal()).toBe(true);
  });

  it('isTerminal returns false for non-terminal state', () => {
    const sm = createMachine();
    expect(sm.isTerminal()).toBe(false);
  });

  it('getValidTargets returns correct targets', () => {
    const sm = createMachine();
    expect(sm.getValidTargets('idle')).toEqual(['running', 'failed']);
  });

  it('reset clears state and history', () => {
    const sm = createMachine();
    sm.transition('idle', 'failed');
    expect(sm.getCurrentState()).toBe('failed');
    sm.reset('idle');
    expect(sm.getCurrentState()).toBe('idle');
    expect(sm.getHistory()).toHaveLength(0);
  });

  it('forceTransition bypasses guards', () => {
    const sm = createMachine();
    // idle -> running without guard context
    const result = sm.forceTransition('running');
    expect(result.ok).toBe(true);
    expect(sm.getCurrentState()).toBe('running');
  });

  it('forceTransition still rejects from terminal state', () => {
    const sm = createMachine();
    sm.transition('idle', 'failed');
    const result = sm.forceTransition('idle');
    expect(result.ok).toBe(false);
  });
});