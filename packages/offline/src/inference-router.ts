/**
 * @agentos/offline — Inference Router
 * Selects Local / Cloud / Queue execution for every reasoning request based on
 * connectivity (current ExecutionMode), policy, cost, and model availability
 * (ADR-008 Batch 2, resolutions R3/R4/R6).
 *
 * TRANSPARENCY CONTRACT (the Batch 2 success criterion): agents, capabilities, and
 * workflows request reasoning *exactly as they do today* — by capability path. They do
 * not know or care where it runs. This router is the only thing that decides location,
 * so Swarm/Memory/Browser/Desktop/Capability/Security need no changes.
 *
 * ZERO AI logic: the router never inspects the prompt. Actual model calls are injected
 * (localExecutor/cloudExecutor), keeping this layer deterministic and decoupled from
 * @agentos/llm. The durable queue (Batch 3) is injected via `enqueue`.
 */

import { EventDomain, createUUID, type Event, type EventID } from '@agentos/types';
import type { IEventStore } from '@agentos/eventstore';
import { ModeController } from './mode-controller.js';
import { LocalModelRegistry } from './local-model-registry.js';
import {
  ExecutionMode,
  OFF,
  DEFAULT_ROUTING_POLICY,
  type HostProfile,
  type InferenceOutcome,
  type InferenceRequest,
  type LocalModel,
  type QueuedOperation,
  type RoutingDecision,
  type RoutingPolicy,
} from './types.js';

/** Injected adapter that runs a request on a local model. Returns the raw output + tokens used. */
export type LocalExecutor = (
  model: LocalModel,
  request: InferenceRequest,
) => Promise<{ data: unknown; tokensUsed: number }>;

/** Injected adapter that runs a request against the cloud model router (@agentos/llm). */
export type CloudExecutor = (request: InferenceRequest) => Promise<{ data: unknown; tokensUsed: number }>;

/** Injected durable-queue sink (Batch 3 provides the real implementation). */
export type EnqueueFn = (op: QueuedOperation) => void | Promise<void>;

/** Injected resource-accounting sink — offline inference is NOT free (R6). */
export type ConsumptionSink = (record: {
  workspaceId: string;
  taskType: string;
  ru: number;
  producedOffline: boolean;
}) => void | Promise<void>;

export interface InferenceRouterConfig {
  registry: LocalModelRegistry;
  modeController: ModeController;
  localExecutor: LocalExecutor;
  cloudExecutor: CloudExecutor;
  policy?: RoutingPolicy;
  enqueue?: EnqueueFn;
  onConsumption?: ConsumptionSink;
  host?: HostProfile;
  /** When present, every routing decision is emitted as a SYSTEM event (transparency/audit). */
  eventStore?: IEventStore;
  now?: () => string;
  idFactory?: () => string;
}

export class InferenceRouter {
  private readonly registry: LocalModelRegistry;
  private readonly modeController: ModeController;
  private readonly localExecutor: LocalExecutor;
  private readonly cloudExecutor: CloudExecutor;
  private readonly policy: RoutingPolicy;
  private readonly enqueue?: EnqueueFn;
  private readonly onConsumption?: ConsumptionSink;
  private readonly host?: HostProfile;
  private readonly eventStore?: IEventStore;
  private readonly now: () => string;
  private readonly idFactory: () => string;

  constructor(config: InferenceRouterConfig) {
    this.registry = config.registry;
    this.modeController = config.modeController;
    this.localExecutor = config.localExecutor;
    this.cloudExecutor = config.cloudExecutor;
    this.policy = config.policy ?? DEFAULT_ROUTING_POLICY;
    this.enqueue = config.enqueue;
    this.onConsumption = config.onConsumption;
    this.host = config.host;
    this.eventStore = config.eventStore;
    this.now = config.now ?? (() => new Date().toISOString());
    this.idFactory = config.idFactory ?? (() => createUUID());
  }

  /**
   * Pure routing decision for a task-type under the current mode + policy.
   * Exposed for simulation/tests and for callers that want the plan without executing.
   */
  decide(taskType: string): RoutingDecision {
    const mode = this.modeController.getMode();
    const local = this.registry.resolve(taskType, this.host);
    const considered = this.registry
      .list()
      .filter((m) => m.servesTaskTypes.includes(taskType))
      .map((m) => m.id);

    const queueDecision = (reason: string): RoutingDecision => ({
      taskType,
      target: 'queue',
      mode,
      consideredModelIds: considered,
      reason,
      errorCode: OFF.NO_LOCAL_PROVIDER,
    });
    const localDecision = (reason: string): RoutingDecision => ({
      taskType,
      target: 'local',
      mode,
      model: local,
      consideredModelIds: considered,
      reason,
    });
    const cloudDecision = (reason: string): RoutingDecision => ({
      taskType,
      target: 'cloud',
      mode,
      consideredModelIds: considered,
      reason,
    });

    switch (mode) {
      case ExecutionMode.OFFLINE:
        // No network: local or nothing. Unsupported → queue for later (R4).
        return local
          ? localDecision('offline: served by local model')
          : queueDecision('offline and no local provider for task-type — queued for later');

      case ExecutionMode.ONLINE:
        if (!this.policy.allowCloud) {
          return local
            ? localDecision('cloud disallowed by policy; served locally')
            : queueDecision('cloud disallowed by policy and no local provider');
        }
        if (this.policy.optimizeFor === 'accuracy') {
          return cloudDecision('online: optimizing for accuracy → cloud (R3)');
        }
        // latency or cost: prefer local when available (no network hop, cheaper), else cloud.
        return local
          ? localDecision(`online: optimizing for ${this.policy.optimizeFor} → local`)
          : cloudDecision(`online: optimizing for ${this.policy.optimizeFor} but no local provider → cloud`);

      case ExecutionMode.HYBRID:
      default:
        // Partial connectivity: prefer local (the reliable side); fall to cloud, else queue.
        if (local) return localDecision('hybrid: preferring local under partial connectivity');
        if (this.policy.allowCloud) return cloudDecision('hybrid: no local provider → attempting cloud');
        return queueDecision('hybrid: no local provider and cloud disallowed — queued');
    }
  }

  /**
   * Execute a reasoning request, routing transparently. Handles the two behaviors the
   * Batch 2 success criteria require:
   *   - falls back to a local model if a cloud call fails (connectivity lost mid-flight),
   *   - queues an unsupported request for later execution.
   */
  async infer<T = unknown>(request: InferenceRequest): Promise<InferenceOutcome<T>> {
    const decision = this.decide(request.taskType);
    await this.emitDecision(decision, request);

    if (decision.target === 'local') {
      return this.runLocal<T>(decision, decision.model!, request);
    }

    if (decision.target === 'cloud') {
      try {
        const { data } = await this.cloudExecutor(request);
        return { ok: true, data: data as T, decision, producedOffline: false, ruConsumed: 0 };
      } catch (e) {
        // Cloud failed — most likely connectivity dropped mid-call. Fall back to local if we can.
        const local = this.registry.resolve(request.taskType, this.host);
        if (local) {
          const fallback: RoutingDecision = {
            ...decision,
            target: 'local',
            model: local,
            reason: `cloud call failed (${errMsg(e)}); fell back to local model (invariant #2: logged substitution)`,
          };
          await this.emitDecision(fallback, request);
          return this.runLocal<T>(fallback, local, request);
        }
        // No local fallback → queue for later.
        return this.queueRequest<T>(decision, request, `cloud failed (${errMsg(e)}) and no local fallback`);
      }
    }

    // target === 'queue'
    if (this.policy.whenUnavailable === 'error') {
      return {
        ok: false,
        decision,
        producedOffline: false,
        ruConsumed: 0,
        errorCode: OFF.NO_LOCAL_PROVIDER,
        errorMessage: decision.reason,
      };
    }
    return this.queueRequest<T>(decision, request, decision.reason);
  }

  private async runLocal<T>(
    decision: RoutingDecision,
    model: LocalModel,
    request: InferenceRequest,
  ): Promise<InferenceOutcome<T>> {
    const { data, tokensUsed } = await this.localExecutor(model, request);
    const ru = (tokensUsed / 1000) * model.ruPer1kTokens;
    if (this.onConsumption) {
      await this.onConsumption({
        workspaceId: request.workspaceId,
        taskType: request.taskType,
        ru,
        producedOffline: true,
      });
    }
    return { ok: true, data: data as T, decision, producedOffline: true, ruConsumed: ru };
  }

  private async queueRequest<T>(
    decision: RoutingDecision,
    request: InferenceRequest,
    reason: string,
  ): Promise<InferenceOutcome<T>> {
    if (this.enqueue) {
      const op: QueuedOperation = {
        id: this.idFactory(),
        kind: 'inference',
        idempotencyKey: request.correlationId ?? this.idFactory(),
        capabilityPath: request.capabilityPath,
        workspaceId: request.workspaceId,
        payload: request.payload,
        correlationId: request.correlationId,
        causationId: request.causationId,
        enqueuedAt: this.now(),
        priority: 3,
      };
      await this.enqueue(op);
    }
    return {
      ok: false,
      decision: { ...decision, target: 'queue' },
      producedOffline: false,
      ruConsumed: 0,
      errorCode: OFF.NO_LOCAL_PROVIDER,
      errorMessage: reason,
    };
  }

  private async emitDecision(decision: RoutingDecision, request: InferenceRequest): Promise<void> {
    if (!this.eventStore) return;
    const event: Event = {
      id: this.idFactory() as EventID,
      domain: EventDomain.SYSTEM,
      type: 'system.inference.routed',
      source: 'offline.inference-router',
      data: { decision, capabilityPath: request.capabilityPath, taskType: request.taskType },
      timestamp: this.now(),
      correlation_id: request.correlationId,
      causation_id: request.causationId,
    };
    await this.eventStore.append(event);
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
