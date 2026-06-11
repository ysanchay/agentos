/**
 * @agentos/capabilities — Capability Registry
 * Single source of truth for which capabilities exist and which providers serve them.
 */

import type {
  Capability,
  CapabilityID,
  CapabilityPath,
  CapabilityProvider,
  CapabilityHealth,
  ProviderID,
  RootCapability,
  HealthStatus,
  Outcome,
} from '@agentos/types';
import { ok, err } from '@agentos/types';
import type { ICapabilityProvider } from './types.js';

/** Simplified per-provider health record (internal to registry) */
interface ProviderHealthEntry {
  providerId: ProviderID;
  capabilityPath: CapabilityPath;
  status: HealthStatus;
  lastCheck: string;
  latencyMs: number;
  successRate: number;
  errorRate: number;
  details: Record<string, unknown>;
}

export class CapabilityRegistry {
  /** CapabilityID → Capability record */
  private capabilities = new Map<CapabilityID, Capability>();

  /** CapabilityPath → CapabilityID (latest version) */
  private pathIndex = new Map<string, CapabilityID>();

  /** ProviderID → ICapabilityProvider instance */
  private providers = new Map<ProviderID, ICapabilityProvider>();

  /** CapabilityPath → Set of ProviderIDs */
  private providerIndex = new Map<string, Set<ProviderID>>();

  /** ProviderID → health status (internal simplified format) */
  private providerHealth = new Map<ProviderID, ProviderHealthEntry>();

  /** Health check interval handle */
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Register a capability definition.
   */
  registerCapability(capability: Capability): Outcome<CapabilityID> {
    if (this.capabilities.has(capability.id)) {
      return err('CG_E.ALREADY_EXISTS', `Capability ${capability.id} already registered`, { retryable: false });
    }

    this.capabilities.set(capability.id, capability);
    this.pathIndex.set(capability.path as string, capability.id);

    return ok(capability.id);
  }

  /**
   * Register a provider and bind it to its capability paths.
   * Calls provider.initialize(), adds to indexes.
   */
  async registerProvider(provider: ICapabilityProvider): Promise<Outcome<ProviderID>> {
    const id = provider.providerRecord.id;

    if (this.providers.has(id)) {
      return err('CG_E.ALREADY_EXISTS', `Provider ${id} already registered`, { retryable: false });
    }

    // Verify and auto-register capabilities the provider serves
    for (const cap of provider.capabilities) {
      if (!this.capabilities.has(cap.id)) {
        this.registerCapability(cap);
      }

      // Add to provider index
      const pathKey = cap.path as string;
      if (!this.providerIndex.has(pathKey)) {
        this.providerIndex.set(pathKey, new Set());
      }
      this.providerIndex.get(pathKey)!.add(id);
    }

    // Initialize the provider
    try {
      await provider.initialize();
    } catch (e) {
      return err('CG_E.HEALTH_CHECK_FAILED', `Provider ${id} initialization failed: ${e}`, { retryable: false });
    }

    this.providers.set(id, provider);

    // Set initial health status
    this.providerHealth.set(id, {
      providerId: id,
      capabilityPath: provider.providerRecord.capability_path,
      status: 'healthy',
      lastCheck: new Date().toISOString(),
      latencyMs: 0,
      successRate: 1.0,
      errorRate: 0,
      details: {},
    });

    return ok(id);
  }

  /**
   * Deregister a provider.
   */
  async deregisterProvider(providerId: ProviderID): Promise<Outcome<true>> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      return err('CG_E.NOT_FOUND', `Provider ${providerId} not found`, { retryable: false });
    }

    try {
      await provider.shutdown();
    } catch {
      // Continue with deregistration even if shutdown fails
    }

    // Remove from provider index
    for (const cap of provider.capabilities) {
      const pathKey = cap.path as string;
      const providerSet = this.providerIndex.get(pathKey);
      if (providerSet) {
        providerSet.delete(providerId);
        if (providerSet.size === 0) {
          this.providerIndex.delete(pathKey);
        }
      }
    }

    this.providers.delete(providerId);
    this.providerHealth.delete(providerId);

    return ok(true);
  }

  /**
   * Get a capability by its ID.
   */
  getCapability(id: CapabilityID): Capability | undefined {
    return this.capabilities.get(id);
  }

  /**
   * Get a capability by its path (returns latest registered).
   */
  getCapabilityByPath(path: CapabilityPath): Capability | undefined {
    const id = this.pathIndex.get(path as string);
    return id ? this.capabilities.get(id) : undefined;
  }

  /**
   * Get all capabilities under a root.
   */
  getCapabilitiesByRoot(root: RootCapability): Capability[] {
    const result: Capability[] = [];
    for (const cap of this.capabilities.values()) {
      if (cap.root === root) {
        result.push(cap);
      }
    }
    return result;
  }

  /**
   * Get all providers for a capability path.
   * Falls back to parent path if no exact match.
   */
  getProviders(path: CapabilityPath): ICapabilityProvider[] {
    // Try exact match
    const exactSet = this.providerIndex.get(path as string);
    if (exactSet && exactSet.size > 0) {
      return this.getAvailableProviders(exactSet);
    }

    // Try parent path fallback
    const parts = (path as string).split('.');
    for (let depth = parts.length - 1; depth >= 1; depth--) {
      const parentPath = parts.slice(0, depth).join('.');
      const parentSet = this.providerIndex.get(parentPath);
      if (parentSet && parentSet.size > 0) {
        return this.getAvailableProviders(parentSet);
      }
    }

    return [];
  }

  /**
   * Get a specific provider by ID.
   */
  getProvider(id: ProviderID): ICapabilityProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Get health status for a capability path (CapabilityHealth format from @agentos/types).
   */
  getHealth(capabilityPath: CapabilityPath): CapabilityHealth | undefined {
    const providers: CapabilityHealth['providers'] = [];
    for (const [id, entry] of this.providerHealth) {
      if (entry.capabilityPath === capabilityPath) {
        providers.push({
          provider_id: id,
          status: entry.status,
          last_check: entry.lastCheck,
          latency_ms: entry.latencyMs,
          success_rate: entry.successRate,
          error_rate: entry.errorRate,
        });
      }
    }

    if (providers.length === 0) return undefined;

    const healthyCount = providers.filter(p => p.status === 'healthy').length;
    const overallStatus: CapabilityHealth['overall_status'] =
      healthyCount === providers.length ? 'available' :
      healthyCount === 0 ? 'unavailable' : 'degraded';

    return {
      capability_path: capabilityPath,
      providers,
      overall_status: overallStatus,
      last_updated: new Date().toISOString(),
    };
  }

  /**
   * Get provider health entry (internal format).
   */
  getProviderHealth(providerId: ProviderID): ProviderHealthEntry | undefined {
    return this.providerHealth.get(providerId);
  }

  /**
   * List child capability paths under a given parent.
   */
  getChildren(parentPath: CapabilityPath): CapabilityPath[] {
    const prefix = (parentPath as string) + '.';
    const children: CapabilityPath[] = [];
    for (const pathStr of this.pathIndex.keys()) {
      if (pathStr.startsWith(prefix)) {
        const remaining = pathStr.slice(prefix.length);
        const childSegment = remaining.split('.')[0];
        if (childSegment && !children.some(c => (c as string) === prefix + childSegment)) {
          children.push((prefix + childSegment) as CapabilityPath);
        }
      }
    }
    return children;
  }

  /**
   * Walk the tree from root to deepest match.
   */
  walkPath(path: CapabilityPath): CapabilityPath[] {
    const parts = (path as string).split('.');
    const result: CapabilityPath[] = [];
    let current = '';
    for (const part of parts) {
      current = current ? `${current}.${part}` : part;
      if (this.pathIndex.has(current)) {
        result.push(current as CapabilityPath);
      }
    }
    return result;
  }

  /**
   * Run health checks on all providers.
   */
  async runHealthChecks(): Promise<void> {
    const checkPromises: Promise<void>[] = [];

    for (const [id, provider] of this.providers) {
      checkPromises.push(
        (async () => {
          const start = Date.now();
          try {
            const result = await Promise.race([
              provider.healthCheck(),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Health check timeout')), 10_000),
              ),
            ]);
            const latencyMs = Date.now() - start;
            this.providerHealth.set(id, {
              providerId: id,
              capabilityPath: provider.providerRecord.capability_path,
              status: result.healthy ? 'healthy' : 'degraded',
              lastCheck: new Date().toISOString(),
              latencyMs,
              successRate: 1.0,
              errorRate: 0,
              details: (result.details ?? {}) as Record<string, unknown>,
            });
          } catch {
            this.providerHealth.set(id, {
              providerId: id,
              capabilityPath: provider.providerRecord.capability_path,
              status: 'unhealthy',
              lastCheck: new Date().toISOString(),
              latencyMs: Date.now() - start,
              successRate: 0,
              errorRate: 1,
              details: { error: 'Health check failed or timed out' },
            });
          }
        })(),
      );
    }

    await Promise.all(checkPromises);
  }

  /**
   * Start periodic health checking.
   */
  startHealthCheckLoop(intervalMs: number = 60_000): void {
    this.stopHealthCheckLoop();
    this.healthCheckInterval = setInterval(() => {
      this.runHealthChecks().catch(() => {});
    }, intervalMs);
  }

  /**
   * Stop health checking.
   */
  stopHealthCheckLoop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  get capabilityCount(): number {
    return this.capabilities.size;
  }

  get providerCount(): number {
    return this.providers.size;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────

  private getAvailableProviders(providerIds: Set<ProviderID>): ICapabilityProvider[] {
    const result: ICapabilityProvider[] = [];
    for (const id of providerIds) {
      const provider = this.providers.get(id);
      if (!provider) continue;

      const status = provider.providerRecord.status;
      if (status === 'offline') continue;

      const health = this.providerHealth.get(id);
      if (health?.status === 'offline') continue;

      result.push(provider);
    }
    return result;
  }
}