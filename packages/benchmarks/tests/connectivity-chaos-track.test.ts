import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ModeController, ExecutionQueue, ConnectivityState } from '@agentos/offline';
import { ConnectivityChaosTrack } from '../src/connectivity-chaos-track.js';

describe('ConnectivityChaosTrack — basic drop and restore', () => {
  let mc: ModeController;
  let queue: ExecutionQueue;
  let track: ConnectivityChaosTrack;

  beforeEach(() => {
    mc = new ModeController();
    queue = new ExecutionQueue();
    track = new ConnectivityChaosTrack(mc, queue, {
      dropIntervalMs: 100,
      minDropDurationMs: 50,
      maxDropDurationMs: 100,
      totalDrops: 1,
      saturationProbability: 0,
      modelOutageProbability: 0,
    });
  });

  afterEach(() => {
    track.cleanup();
  });

  it('injects a drop and restores connectivity', async () => {
    await track.injectDrop(100);
    // After drop, mode should be OFFLINE
    expect(mc.getMode()).toBe('offline');

    // Wait for restore
    await new Promise((r) => setTimeout(r, 200));

    const report = track.getReport();
    expect(report.totalDrops).toBe(1);
    expect(report.totalRestores).toBe(1);
    expect(report.totalModeTransitions).toBeGreaterThanOrEqual(1);
  });
});

describe('ConnectivityChaosTrack — queue saturation', () => {
  let mc: ModeController;
  let queue: ExecutionQueue;
  let track: ConnectivityChaosTrack;

  beforeEach(() => {
    mc = new ModeController();
    queue = new ExecutionQueue({ maxSize: 1000 });
    track = new ConnectivityChaosTrack(mc, queue, {
      dropIntervalMs: 100,
      minDropDurationMs: 50,
      maxDropDurationMs: 100,
      totalDrops: 1,
      saturationProbability: 1.0, // always saturate
      saturationBatchSize: 20,
      modelOutageProbability: 0,
    });
  });

  afterEach(() => {
    track.cleanup();
  });

  it('saturates the queue during a drop', async () => {
    await track.injectDrop(100);
    await new Promise((r) => setTimeout(r, 200));

    const report = track.getReport();
    expect(report.totalQueueSaturationEvents).toBe(1);
    expect(report.maxQueueDepth).toBeGreaterThanOrEqual(20);
  });
});

describe('ConnectivityChaosTrack — mode transition tracking', () => {
  let mc: ModeController;
  let queue: ExecutionQueue;
  let track: ConnectivityChaosTrack;

  beforeEach(() => {
    mc = new ModeController();
    queue = new ExecutionQueue();
    track = new ConnectivityChaosTrack(mc, queue, {
      dropIntervalMs: 100,
      minDropDurationMs: 50,
      maxDropDurationMs: 100,
      totalDrops: 3,
      saturationProbability: 0,
      modelOutageProbability: 0,
    });
  });

  afterEach(() => {
    track.cleanup();
  });

  it('tracks multiple drops and mode transitions', async () => {
    // Inject 3 drops manually
    for (let i = 0; i < 3; i++) {
      await track.injectDrop(50);
      await new Promise((r) => setTimeout(r, 100));
    }

    const report = track.getReport();
    expect(report.totalDrops).toBe(3);
    expect(report.totalRestores).toBe(3);
    expect(report.totalModeTransitions).toBeGreaterThanOrEqual(3);
    expect(report.events.length).toBeGreaterThanOrEqual(6); // drops + restores minimum
  });
});

describe('ConnectivityChaosTrack — report generation', () => {
  let mc: ModeController;
  let queue: ExecutionQueue;
  let track: ConnectivityChaosTrack;

  beforeEach(() => {
    mc = new ModeController();
    queue = new ExecutionQueue();
    track = new ConnectivityChaosTrack(mc, queue, {
      dropIntervalMs: 100,
      minDropDurationMs: 50,
      maxDropDurationMs: 100,
      totalDrops: 2,
      saturationProbability: 0.5,
      modelOutageProbability: 0.5,
    });
  });

  afterEach(() => {
    track.cleanup();
  });

  it('generates a complete report with all metrics', async () => {
    await track.injectDrop(100);
    await new Promise((r) => setTimeout(r, 200));

    const report = track.getReport();
    expect(report).toHaveProperty('totalDrops');
    expect(report).toHaveProperty('totalRestores');
    expect(report).toHaveProperty('totalModeTransitions');
    expect(report).toHaveProperty('maxQueueDepth');
    expect(report).toHaveProperty('totalQueueSaturationEvents');
    expect(report).toHaveProperty('totalModelOutages');
    expect(report).toHaveProperty('totalRecoveries');
    expect(report).toHaveProperty('events');
    expect(Array.isArray(report.events)).toBe(true);
  });

  it('resets state correctly', async () => {
    await track.injectDrop(50);
    await new Promise((r) => setTimeout(r, 100));

    track.reset();
    const report = track.getReport();
    expect(report.totalDrops).toBe(0);
    expect(report.totalRestores).toBe(0);
    expect(report.events).toHaveLength(0);
  });
});