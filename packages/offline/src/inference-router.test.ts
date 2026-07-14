import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryEventStore } from '@agentos/eventstore';
import { EventDomain } from '@agentos/types';
import { InferenceRouter, type CloudExecutor, type LocalExecutor } from './inference-router.js';
import { LocalModelRegistry } from './local-model-registry.js';
import { ModeController } from './mode-controller.js';
import {
  ExecutionMode,
  OFF,
  type InferenceRequest,
  type LocalModel,
  type QueuedOperation,
  type RoutingPolicy,
} from './types.js';

function localModel(id: string, taskType: string, ru = 1): LocalModel {
  return {
    id,
    name: id,
    version: '1.0.0',
    modality: 'text',
    servesTaskTypes: [taskType],
    location: `/m/${id}`,
    readiness: 'available',
    ruPer1kTokens: ru,
    concurrencySlots: 1,
  };
}

function req(taskType = 'reasoning'): InferenceRequest {
  return {
    capabilityPath: 'reason.infer.text',
    taskType,
    workspaceId: 'ws-1',
    payload: { prompt: 'hi' },
    estimatedTokens: 1000,
    correlationId: 'corr-1',
  };
}

const okLocal: LocalExecutor = async () => ({ data: 'local-answer', tokensUsed: 2000 });
const okCloud: CloudExecutor = async () => ({ data: 'cloud-answer', tokensUsed: 500 });

function build(mode: ExecutionMode, policy?: Partial<RoutingPolicy>, withModel = true) {
  const registry = new LocalModelRegistry();
  if (withModel) registry.register(localModel('local-reasoner', 'reasoning', 2));
  const modeController = new ModeController({ initialMode: mode });
  const enqueued: QueuedOperation[] = [];
  const consumption: Array<{ ru: number; producedOffline: boolean }> = [];
  const localExecutor = vi.fn(okLocal);
  const cloudExecutor = vi.fn(okCloud);
  const router = new InferenceRouter({
    registry,
    modeController,
    localExecutor,
    cloudExecutor,
    policy: { allowCloud: true, optimizeFor: 'accuracy', whenUnavailable: 'queue', ...policy },
    enqueue: (op) => void enqueued.push(op),
    onConsumption: (r) => void consumption.push({ ru: r.ru, producedOffline: r.producedOffline }),
  });
  return { router, registry, localExecutor, cloudExecutor, enqueued, consumption };
}

describe('InferenceRouter.decide', () => {
  it('OFFLINE → local when a model exists', () => {
    expect(build(ExecutionMode.OFFLINE).router.decide('reasoning').target).toBe('local');
  });

  it('OFFLINE → queue (OFF-0001) when no local provider', () => {
    const d = build(ExecutionMode.OFFLINE, {}, false).router.decide('reasoning');
    expect(d.target).toBe('queue');
    expect(d.errorCode).toBe(OFF.NO_LOCAL_PROVIDER);
  });

  it('ONLINE + accuracy → cloud (R3)', () => {
    expect(build(ExecutionMode.ONLINE, { optimizeFor: 'accuracy' }).router.decide('reasoning').target).toBe(
      'cloud',
    );
  });

  it('ONLINE + cost/latency → local when available', () => {
    expect(build(ExecutionMode.ONLINE, { optimizeFor: 'cost' }).router.decide('reasoning').target).toBe('local');
    expect(build(ExecutionMode.ONLINE, { optimizeFor: 'latency' }).router.decide('reasoning').target).toBe(
      'local',
    );
  });

  it('ONLINE + allowCloud:false → local (enterprise local-only)', () => {
    expect(build(ExecutionMode.ONLINE, { allowCloud: false }).router.decide('reasoning').target).toBe('local');
  });

  it('HYBRID → prefers local under partial connectivity', () => {
    expect(build(ExecutionMode.HYBRID).router.decide('reasoning').target).toBe('local');
  });

  it('HYBRID → cloud when no local provider', () => {
    expect(build(ExecutionMode.HYBRID, {}, false).router.decide('reasoning').target).toBe('cloud');
  });
});

describe('InferenceRouter.infer', () => {
  it('runs locally and records RU consumption (offline is not free, R6)', async () => {
    const { router, localExecutor, consumption } = build(ExecutionMode.OFFLINE);
    const out = await router.infer(req());
    expect(out.ok).toBe(true);
    expect(out.data).toBe('local-answer');
    expect(out.producedOffline).toBe(true);
    expect(localExecutor).toHaveBeenCalledOnce();
    // 2000 tokens × 2 RU/1k = 4 RU
    expect(out.ruConsumed).toBe(4);
    expect(consumption).toEqual([{ ru: 4, producedOffline: true }]);
  });

  it('runs on cloud in ONLINE/accuracy and does not mark producedOffline', async () => {
    const { router, cloudExecutor } = build(ExecutionMode.ONLINE);
    const out = await router.infer(req());
    expect(out.ok).toBe(true);
    expect(out.data).toBe('cloud-answer');
    expect(out.producedOffline).toBe(false);
    expect(cloudExecutor).toHaveBeenCalledOnce();
  });

  it('falls back to local when the cloud call fails (connectivity lost mid-flight)', async () => {
    const { router, localExecutor } = build(ExecutionMode.ONLINE);
    // make cloud throw
    (router as unknown as { cloudExecutor: CloudExecutor }).cloudExecutor = async () => {
      throw new Error('ECONNREFUSED');
    };
    const out = await router.infer(req());
    expect(out.ok).toBe(true);
    expect(out.producedOffline).toBe(true);
    expect(out.decision.reason).toContain('fell back to local');
    expect(localExecutor).toHaveBeenCalledOnce();
  });

  it('queues an unsupported request for later execution', async () => {
    const { router, enqueued } = build(ExecutionMode.OFFLINE, { whenUnavailable: 'queue' }, false);
    const out = await router.infer(req());
    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe(OFF.NO_LOCAL_PROVIDER);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.kind).toBe('inference');
    expect(enqueued[0]!.idempotencyKey).toBe('corr-1');
  });

  it('fails fast (no queue) when policy.whenUnavailable is "error"', async () => {
    const { router, enqueued } = build(ExecutionMode.OFFLINE, { whenUnavailable: 'error' }, false);
    const out = await router.infer(req());
    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe(OFF.NO_LOCAL_PROVIDER);
    expect(enqueued).toHaveLength(0);
  });

  it('cloud failure with no local fallback queues the request', async () => {
    const { router, enqueued } = build(ExecutionMode.HYBRID, {}, false);
    (router as unknown as { cloudExecutor: CloudExecutor }).cloudExecutor = async () => {
      throw new Error('offline');
    };
    const out = await router.infer(req());
    expect(out.ok).toBe(false);
    expect(enqueued).toHaveLength(1);
  });

  it('emits a transparent system.inference.routed event per decision when an event store is present', async () => {
    const registry = new LocalModelRegistry();
    registry.register(localModel('lr', 'reasoning'));
    const store = new InMemoryEventStore();
    const router = new InferenceRouter({
      registry,
      modeController: new ModeController({ initialMode: ExecutionMode.OFFLINE }),
      localExecutor: okLocal,
      cloudExecutor: okCloud,
      eventStore: store,
      idFactory: (() => {
        let n = 0;
        return () => `evt-${(n += 1)}`;
      })(),
    });
    await router.infer(req());
    const page = await store.query({ domain: EventDomain.SYSTEM });
    expect(page.items[0]!.type).toBe('system.inference.routed');
    expect(page.items[0]!.correlation_id).toBe('corr-1');
  });
});
