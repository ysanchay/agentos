import { describe, it, expect } from 'vitest';
import { ConnectivityMonitor } from './connectivity-monitor.js';
import { ConnectivityState, type ProbeResult } from './types.js';

const up: ProbeResult = { reachable: true, latencyMs: 50 };
const down: ProbeResult = { reachable: false };
const slow: ProbeResult = { reachable: true, latencyMs: 5000 };

describe('ConnectivityMonitor', () => {
  it('starts FULL by default', () => {
    expect(new ConnectivityMonitor().getState()).toBe(ConnectivityState.FULL);
  });

  it('requires consecutive failures to declare NONE (hysteresis)', () => {
    const m = new ConnectivityMonitor({ failuresToOffline: 3 });
    expect(m.record(down)).toBe(ConnectivityState.PARTIAL); // first drop degrades, not offline
    expect(m.record(down)).toBe(ConnectivityState.PARTIAL);
    expect(m.record(down)).toBe(ConnectivityState.NONE); // third confirms offline
  });

  it('a single recovery probe does not jump straight to FULL from NONE', () => {
    const m = new ConnectivityMonitor({ failuresToOffline: 2, successesToFull: 2 });
    m.record(down);
    m.record(down);
    expect(m.getState()).toBe(ConnectivityState.NONE);
    expect(m.record(up)).toBe(ConnectivityState.PARTIAL); // pass through PARTIAL
    expect(m.record(up)).toBe(ConnectivityState.FULL); // second healthy probe confirms
  });

  it('high latency is treated as PARTIAL (degraded), not NONE', () => {
    const m = new ConnectivityMonitor({ degradedLatencyMs: 2000 });
    expect(m.record(slow)).toBe(ConnectivityState.PARTIAL);
    expect(m.record(slow)).toBe(ConnectivityState.PARTIAL);
  });

  it('partial endpoint reachability is PARTIAL; zero reachable counts as unreachable', () => {
    const m = new ConnectivityMonitor({ failuresToOffline: 2 });
    expect(m.record({ reachable: true, endpointsReachable: 1, endpointsTotal: 3 })).toBe(
      ConnectivityState.PARTIAL,
    );
    // reachable:true but 0 endpoints responded → unreachable classification
    expect(m.record({ reachable: true, endpointsReachable: 0, endpointsTotal: 3 })).toBe(
      ConnectivityState.PARTIAL,
    );
    expect(m.record({ reachable: true, endpointsReachable: 0, endpointsTotal: 3 })).toBe(
      ConnectivityState.NONE,
    );
  });

  it('a degraded probe resets the failure streak (we can still reach something)', () => {
    const m = new ConnectivityMonitor({ failuresToOffline: 3 });
    m.record(down);
    m.record(down); // 2 failures
    m.record(slow); // degraded → resets streak
    m.record(down); // streak back to 1, not enough for NONE
    expect(m.getState()).toBe(ConnectivityState.PARTIAL);
  });

  it('is deterministic: same probe sequence yields same states', () => {
    const seq = [up, down, slow, down, down, up, up];
    const run = () => {
      const m = new ConnectivityMonitor();
      return seq.map((p) => m.record(p));
    };
    expect(run()).toEqual(run());
  });

  it('reset restores a clean state and streaks', () => {
    const m = new ConnectivityMonitor({ failuresToOffline: 2 });
    m.record(down);
    m.record(down);
    expect(m.getState()).toBe(ConnectivityState.NONE);
    m.reset();
    expect(m.getState()).toBe(ConnectivityState.FULL);
  });
});
