/**
 * @agentos/capabilities — Consumption Tracker Tests
 */

import { describe, it, expect } from 'vitest';
import { ConsumptionTracker } from '../src/consumption-tracker.js';
import { ZERO_CONSUMPTION } from '@agentos/types';
import { createUUID } from '@agentos/types';
import type { AgentID, WorkspaceID, CapabilityPath, InvocationID } from '@agentos/types';

function aid(): AgentID { return createUUID() as unknown as AgentID; }
function wid(): WorkspaceID { return createUUID() as unknown as WorkspaceID; }
function iid(): InvocationID { return createUUID() as unknown as InvocationID; }
function cpath(p: string): CapabilityPath { return p as CapabilityPath; }

describe('ConsumptionTracker', () => {
  it('should start with zero totals', () => {
    const tracker = new ConsumptionTracker();
    expect(tracker.count).toBe(0);
    expect(tracker.getTotal()).toEqual(ZERO_CONSUMPTION);
  });

  it('should record a single invocation', () => {
    const tracker = new ConsumptionTracker();
    const agentId = aid();
    const wsId = wid();
    const invId = iid();
    const path = cpath('actuate.filesystem.read');

    tracker.record(invId, agentId, wsId, path, { ru: 10, mu: 5, eu: 1, vu: 0 });

    expect(tracker.count).toBe(1);
    expect(tracker.getTotal()).toEqual({ ru: 10, mu: 5, eu: 1, vu: 0 });
  });

  it('should aggregate consumption by agent', () => {
    const tracker = new ConsumptionTracker();
    const agent1 = aid();
    const agent2 = aid();
    const wsId = wid();
    const path = cpath('actuate.filesystem.read');

    tracker.record(iid(), agent1, wsId, path, { ru: 10, mu: 5, eu: 1, vu: 0 });
    tracker.record(iid(), agent1, wsId, path, { ru: 20, mu: 10, eu: 2, vu: 0 });
    tracker.record(iid(), agent2, wsId, path, { ru: 5, mu: 2, eu: 1, vu: 0 });

    expect(tracker.getByAgent(agent1)).toEqual({ ru: 30, mu: 15, eu: 3, vu: 0 });
    expect(tracker.getByAgent(agent2)).toEqual({ ru: 5, mu: 2, eu: 1, vu: 0 });
  });

  it('should aggregate consumption by workspace', () => {
    const tracker = new ConsumptionTracker();
    const agentId = aid();
    const ws1 = wid();
    const ws2 = wid();
    const path = cpath('actuate.filesystem.read');

    tracker.record(iid(), agentId, ws1, path, { ru: 10, mu: 5, eu: 1, vu: 0 });
    tracker.record(iid(), agentId, ws2, path, { ru: 5, mu: 2, eu: 1, vu: 0 });

    expect(tracker.getByWorkspace(ws1)).toEqual({ ru: 10, mu: 5, eu: 1, vu: 0 });
    expect(tracker.getByWorkspace(ws2)).toEqual({ ru: 5, mu: 2, eu: 1, vu: 0 });
  });

  it('should aggregate consumption by capability path', () => {
    const tracker = new ConsumptionTracker();
    const agentId = aid();
    const wsId = wid();

    tracker.record(iid(), agentId, wsId, cpath('actuate.filesystem.read'), { ru: 10, mu: 5, eu: 1, vu: 0 });
    tracker.record(iid(), agentId, wsId, cpath('actuate.shell.exec'), { ru: 50, mu: 20, eu: 5, vu: 0 });
    tracker.record(iid(), agentId, wsId, cpath('actuate.filesystem.read'), { ru: 5, mu: 2, eu: 1, vu: 0 });

    expect(tracker.getByPath(cpath('actuate.filesystem.read'))).toEqual({ ru: 15, mu: 7, eu: 2, vu: 0 });
    expect(tracker.getByPath(cpath('actuate.shell.exec'))).toEqual({ ru: 50, mu: 20, eu: 5, vu: 0 });
  });

  it('should return zero for unknown agent/workspace/path', () => {
    const tracker = new ConsumptionTracker();
    expect(tracker.getByAgent(aid())).toEqual(ZERO_CONSUMPTION);
    expect(tracker.getByWorkspace(wid())).toEqual(ZERO_CONSUMPTION);
    expect(tracker.getByPath(cpath('unknown'))).toEqual(ZERO_CONSUMPTION);
  });

  it('should return read-only records', () => {
    const tracker = new ConsumptionTracker();
    tracker.record(iid(), aid(), wid(), cpath('actuate.filesystem.read'), { ru: 10, mu: 5, eu: 1, vu: 0 });
    const records = tracker.getRecords();
    expect(records.length).toBe(1);
    expect(records[0]!.consumed).toEqual({ ru: 10, mu: 5, eu: 1, vu: 0 });
  });

  it('should reset all tracking data', () => {
    const tracker = new ConsumptionTracker();
    tracker.record(iid(), aid(), wid(), cpath('actuate.filesystem.read'), { ru: 10, mu: 5, eu: 1, vu: 0 });

    tracker.reset();
    expect(tracker.count).toBe(0);
    expect(tracker.getTotal()).toEqual(ZERO_CONSUMPTION);
  });

  it('should compute total across multiple invocations', () => {
    const tracker = new ConsumptionTracker();
    tracker.record(iid(), aid(), wid(), cpath('a'), { ru: 10, mu: 5, eu: 1, vu: 0 });
    tracker.record(iid(), aid(), wid(), cpath('b'), { ru: 20, mu: 10, eu: 2, vu: 1 });
    tracker.record(iid(), aid(), wid(), cpath('c'), { ru: 30, mu: 15, eu: 3, vu: 2 });

    const total = tracker.getTotal();
    expect(total).toEqual({ ru: 60, mu: 30, eu: 6, vu: 3 });
  });
});