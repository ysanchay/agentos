/**
 * @agentos/capabilities — Capability Executor
 * The centerpiece of the capability runtime. Orchestrates the full
 * 13-step invocation lifecycle from request to result.
 */

import type {
  CapabilityPath,
  Capability,
  CapabilityInvocation,
  InvocationID,
  InvocationResult,
  InvocationError,
  InvocationStatus,
  ResolutionRequest,
  ResourceConsumption,
  ResourceBudget,
  AgentID,
  TaskID,
  WorkspaceID,
  ProviderID,
  Outcome,
} from '@agentos/types';
import { createUUID, ok, err, ZERO_CONSUMPTION } from '@agentos/types';
import type { ICapabilityProvider, ProviderExecuteContext, CapabilityExecutorConfig, InvocationEvent } from './types.js';
import { DEFAULT_EXECUTOR_CONFIG } from './types.js';
import type { CapabilityRegistry } from './capability-registry.js';
import type { CapabilityResolver } from './capability-resolver.js';
import type { SecurityHypervisor } from './security-hypervisor.js';
import type { SandboxManager, SandboxHandle } from './sandbox.js';
import type { ConsumptionTracker } from './consumption-tracker.js';
import type { MemoryOrchestrator } from '@agentos/memory';

export interface CapabilityExecutorDeps {
  registry: CapabilityRegistry;
  resolver: CapabilityResolver;
  hypervisor: SecurityHypervisor;
  sandboxManager: SandboxManager;
  consumptionTracker: ConsumptionTracker;
  memory?: MemoryOrchestrator;
  config?: Partial<CapabilityExecutorConfig>;
}

export interface InvocationOptions {
  timeoutMs: number;
  priority: number;
  retryOnFailure: boolean;
  fallbackProviderId?: ProviderID;
}

export class CapabilityExecutor {
  private registry: CapabilityRegistry;
  private resolver: CapabilityResolver;
  private hypervisor: SecurityHypervisor;
  private sandboxManager: SandboxManager;
  private consumptionTracker: ConsumptionTracker;
  private memory?: MemoryOrchestrator;
  private config: CapabilityExecutorConfig;
  private invocationEvents: InvocationEvent[] = [];

  constructor(deps: CapabilityExecutorDeps) {
    this.registry = deps.registry;
    this.resolver = deps.resolver;
    this.hypervisor = deps.hypervisor;
    this.sandboxManager = deps.sandboxManager;
    this.consumptionTracker = deps.consumptionTracker;
    this.memory = deps.memory;
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...deps.config };
  }

  /**
   * Execute a capability invocation — the full 13-step lifecycle.
   */
  async invoke(
    request: ResolutionRequest,
    input: unknown,
    caller: { agentId: AgentID; taskId?: TaskID; workspaceId: WorkspaceID },
    options?: Partial<InvocationOptions>,
  ): Promise<Outcome<InvocationResult>> {
    const opts: InvocationOptions = {
      timeoutMs: options?.timeoutMs ?? this.config.defaultTimeoutMs,
      priority: options?.priority ?? 3,
      retryOnFailure: options?.retryOnFailure ?? true,
      fallbackProviderId: options?.fallbackProviderId,
    };

    // Step 1: Create invocation record
    const invocationId = createUUID() as unknown as InvocationID;
    const invocation: CapabilityInvocation = {
      id: invocationId,
      capability_path: request.capability_path,
      provider_id: '' as ProviderID,
      caller: {
        agent_id: caller.agentId,
        task_id: caller.taskId,
        workspace_id: caller.workspaceId,
      },
      input,
      options: {
        timeout_ms: opts.timeoutMs,
        priority: opts.priority,
        retry_on_failure: opts.retryOnFailure,
        fallback_provider: opts.fallbackProviderId,
      },
      status: 'pending' as InvocationStatus,
      created_at: new Date().toISOString(),
    };

    this.emitEvent(invocation, 'created');

    // Step 2: Resolve
    const resolveResult = this.resolver.resolve(request);
    if (!resolveResult.ok) {
      invocation.status = 'failed';
      invocation.error = {
        error_code: 'CG_E.CAPABILITY_NOT_FOUND',
        error_message: (resolveResult as any).error_message ?? 'Resolution failed',
        retryable: (resolveResult as any).retryable ?? false,
      };

      // Try fallback provider if specified
      if (opts.fallbackProviderId) {
        const fallbackResult = await this.tryFallbackProvider(
          invocation, opts.fallbackProviderId, caller, opts,
        );
        if (fallbackResult.ok) return fallbackResult;
      }

      this.emitEvent(invocation, 'failed');
      return err(invocation.error!.error_code, invocation.error!.error_message, { retryable: invocation.error!.retryable });
    }

    const resolution = resolveResult.data;
    invocation.provider_id = resolution.provider.id;
    invocation.status = 'accepted';

    const provider = this.registry.getProvider(resolution.provider.id);
    if (!provider) {
      invocation.status = 'failed';
      invocation.error = { error_code: 'CG_E.NO_PROVIDER_AVAILABLE', error_message: 'Provider not found after resolution', retryable: true };
      this.emitEvent(invocation, 'failed');
      return err('CG_E.NO_PROVIDER_AVAILABLE', 'Provider not found after resolution', { retryable: true });
    }

    this.emitEvent(invocation, 'resolved');

    // Step 3: Security Gate
    const securityResult = this.hypervisor.preInvoke(invocation, provider, resolution.capability);
    if (!securityResult.ok) {
      invocation.status = 'failed';
      invocation.error = {
        error_code: 'CG_E.PERMISSION_DENIED',
        error_message: (securityResult as any).error_message ?? 'Security check failed',
        retryable: (securityResult as any).retryable ?? false,
      };
      this.emitEvent(invocation, 'failed');
      return err(invocation.error!.error_code, invocation.error!.error_message, { retryable: invocation.error!.retryable });
    }

    this.emitEvent(invocation, 'approved');

    // Step 5: Sandbox Setup
    let sandboxHandle: SandboxHandle | undefined;
    try {
      if (provider.sandboxConfig.filesystem.enabled || provider.sandboxConfig.process.enabled) {
        sandboxHandle = await this.sandboxManager.createSandbox(provider.sandboxConfig);
      }
    } catch (e) {
      invocation.status = 'failed';
      invocation.error = { error_code: 'CG_E.COMPOSITE_PIPELINE_FAILED', error_message: `Sandbox creation failed: ${e}`, retryable: false };
      this.emitEvent(invocation, 'failed');
      return err('CG_E.COMPOSITE_PIPELINE_FAILED', invocation.error!.error_message, { retryable: false });
    }

    // Step 6: Execute
    let executeResult: InvocationResult | undefined;
    let executeError: InvocationError | undefined;
    const startTime = Date.now();

    try {
      invocation.status = 'accepted' as InvocationStatus;
      this.emitEvent(invocation, 'executing');

      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), opts.timeoutMs);

      const context: ProviderExecuteContext = {
        invocation,
        capability: resolution.capability,
        sandboxRoot: sandboxHandle?.root,
        allowedHosts: provider.sandboxConfig.network.enabled ? provider.sandboxConfig.network.allowedHosts : [],
        env: {},
        deadlineMs: opts.timeoutMs,
        log: () => {},
        signal: abortController.signal,
      };

      const providerResult = await provider.execute(context);
      clearTimeout(timeoutId);

      executeResult = {
        output: providerResult.output,
        duration_ms: providerResult.durationMs,
        resources_consumed: providerResult.resourcesConsumed,
      };

      invocation.status = 'completed';
      invocation.result = executeResult;
    } catch (e) {
      const durationMs = Date.now() - startTime;
      const isTimeout = e instanceof Error && (e.name === 'AbortError' || e.message.includes('abort'));

      if (isTimeout) {
        invocation.status = 'timeout';
        executeError = {
          error_code: 'CG_E.INVOCATION_TIMEOUT',
          error_message: `Invocation timed out after ${opts.timeoutMs}ms`,
          retryable: true,
          retry_after_ms: 1000,
        };
      } else {
        invocation.status = 'failed';
        executeError = {
          error_code: 'CG_E.PROVIDER_ERROR',
          error_message: e instanceof Error ? e.message : String(e),
          retryable: true,
          retry_after_ms: 500,
        };
      }

      invocation.error = executeError;

      // Retry logic
      if (opts.retryOnFailure && executeError.retryable) {
        const retryResult = await this.retryInvocation(
          provider, resolution.capability, invocation, sandboxHandle, opts,
        );

        if (retryResult) {
          executeResult = retryResult;
          executeError = undefined;
          invocation.status = 'completed';
          invocation.result = retryResult;
          invocation.error = undefined;
        }
      }
    }

    // Step 8: Sandbox Teardown
    if (sandboxHandle) {
      await this.sandboxManager.destroySandbox(sandboxHandle.id).catch(() => {});
    }

    // Step 9: Consumption Reporting
    if (executeResult?.resources_consumed) {
      this.consumptionTracker.record(
        invocationId,
        caller.agentId,
        caller.workspaceId,
        request.capability_path,
        executeResult.resources_consumed,
      );
    }

    // Step 10: Security Post-Check
    this.hypervisor.postInvoke(invocation, executeResult, executeError);

    // Step 11: Memory Artifact
    if (this.memory && this.config.generateMemoryArtifacts && executeResult) {
      try {
        this.memory.generateArtifact(
          {
            type: 'task_result',
            taskId: (caller.taskId ?? createUUID() as unknown as TaskID),
            agentId: caller.agentId,
            output: executeResult.output,
            confidence: 0.85,
          },
          caller.workspaceId,
        );
      } catch {
        // Memory artifact generation failure should not fail the invocation
      }
    }

    // Step 12: Emit Events
    if (executeResult) {
      this.emitEvent(invocation, 'completed', executeResult.duration_ms, executeResult.resources_consumed);
    } else {
      this.emitEvent(invocation, 'failed');
    }

    // Step 13: Return Result
    if (executeResult) {
      return ok(executeResult);
    }

    return err(
      executeError!.error_code,
      executeError!.error_message,
      { retryable: executeError!.retryable, retry_after: executeError!.retry_after_ms },
    );
  }

  /**
   * Get all invocation events for auditing.
   */
  getEvents(): ReadonlyArray<InvocationEvent> {
    return this.invocationEvents;
  }

  /**
   * Get the consumption tracker.
   */
  getConsumptionTracker(): ConsumptionTracker {
    return this.consumptionTracker;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private async tryFallbackProvider(
    invocation: CapabilityInvocation,
    fallbackProviderId: ProviderID,
    caller: { agentId: AgentID; taskId?: TaskID; workspaceId: WorkspaceID },
    opts: InvocationOptions,
  ): Promise<Outcome<InvocationResult>> {
    const fallbackProvider = this.registry.getProvider(fallbackProviderId);
    if (!fallbackProvider) {
      return err('CG_E.NO_PROVIDER_AVAILABLE', 'Fallback provider not found', { retryable: false });
    }

    invocation.provider_id = fallbackProviderId;
    invocation.status = 'accepted';

    const securityResult = this.hypervisor.preInvoke(invocation, fallbackProvider, fallbackProvider.capabilities[0]!);
    if (!securityResult.ok) {
      return err('CG_E.PERMISSION_DENIED', 'Fallback provider denied by security', { retryable: false });
    }

    try {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), opts.timeoutMs);

      const context: ProviderExecuteContext = {
        invocation,
        capability: fallbackProvider.capabilities[0]!,
        env: {},
        deadlineMs: opts.timeoutMs,
        log: () => {},
        signal: abortController.signal,
      };

      const result = await fallbackProvider.execute(context);
      clearTimeout(timeoutId);

      return ok({
        output: result.output,
        duration_ms: result.durationMs,
        resources_consumed: result.resourcesConsumed,
      });
    } catch (e) {
      return err('CG_E.PROVIDER_ERROR', `Fallback provider failed: ${e}`, { retryable: false });
    }
  }

  private async retryInvocation(
    provider: ICapabilityProvider,
    capability: Capability,
    invocation: CapabilityInvocation,
    sandboxHandle: SandboxHandle | undefined,
    opts: InvocationOptions,
  ): Promise<InvocationResult | undefined> {
    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      const backoffMs = this.config.retryBackoffMs * (2 ** attempt) + Math.random() * 500;
      await new Promise(resolve => setTimeout(resolve, backoffMs));

      try {
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), opts.timeoutMs);

        const context: ProviderExecuteContext = {
          invocation,
          capability,
          sandboxRoot: sandboxHandle?.root,
          allowedHosts: provider.sandboxConfig.network.enabled ? provider.sandboxConfig.network.allowedHosts : [],
          env: {},
          deadlineMs: opts.timeoutMs,
          log: () => {},
          signal: abortController.signal,
        };

        const result = await provider.execute(context);
        clearTimeout(timeoutId);

        return {
          output: result.output,
          duration_ms: result.durationMs,
          resources_consumed: result.resourcesConsumed,
        };
      } catch {
        // Continue retrying
      }
    }

    return undefined;
  }

  private emitEvent(
    invocation: CapabilityInvocation,
    phase: InvocationEvent['phase'],
    durationMs?: number,
    resourcesConsumed?: ResourceConsumption,
  ): void {
    if (!this.config.emitEvents) return;

    this.invocationEvents.push({
      invocationId: invocation.id,
      capabilityPath: invocation.capability_path,
      providerId: invocation.provider_id,
      callerAgentId: invocation.caller.agent_id,
      taskId: invocation.caller.task_id,
      workspaceId: invocation.caller.workspace_id,
      phase,
      timestamp: Date.now(),
      durationMs,
      resourcesConsumed,
      error: invocation.error,
    });
  }
}