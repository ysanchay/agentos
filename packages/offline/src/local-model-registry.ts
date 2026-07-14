/**
 * @agentos/offline — Local Model Registry
 * The authority on "what can I run with no network." Maintains metadata, capability
 * (task-type) mappings, hardware requirements, health status, versions, and fallback
 * relationships for every local model (ADR-008 Batch 2, resolutions R3/R5).
 *
 * ZERO AI logic and ZERO network I/O. Hosts and model health are reported in, not probed.
 * Resolution is deterministic: the same registry state always yields the same model choice.
 */

import {
  LocalModelSchema,
  type HostProfile,
  type LocalModel,
  type ModelReadiness,
} from './types.js';

export class LocalModelRegistry {
  /** Insertion-ordered map of model id → model. */
  private readonly models: Map<string, LocalModel> = new Map();

  /**
   * Register (or replace) a local model. Input is validated against the Zod schema,
   * which also applies defaults (concurrencySlots=1, requiresGpu=false).
   */
  register(model: unknown): LocalModel {
    const parsed = LocalModelSchema.parse(model);
    this.models.set(parsed.id, parsed);
    return parsed;
  }

  unregister(id: string): boolean {
    return this.models.delete(id);
  }

  get(id: string): LocalModel | undefined {
    return this.models.get(id);
  }

  list(): LocalModel[] {
    return [...this.models.values()];
  }

  /** Update a model's health/readiness (e.g. 'loading' → 'available'). */
  setReadiness(id: string, readiness: ModelReadiness): boolean {
    const m = this.models.get(id);
    if (!m) return false;
    this.models.set(id, { ...m, readiness });
    return true;
  }

  /**
   * Resolve the best *available* local model for a task-type, honoring fallback chains.
   *
   * Selection (deterministic):
   *   1. Candidates = models whose `servesTaskTypes` includes the task-type.
   *   2. Prefer `readiness === 'available'`; if none available, follow the fallback
   *      relationship of the most-preferred candidate to find an available substitute.
   *   3. Among available candidates, pick lowest `ruPer1kTokens` (cheapest), ties broken
   *      by id for stability.
   *
   * Returns undefined when nothing can serve the task-type offline (router → OFF-0001).
   */
  resolve(taskType: string, host?: HostProfile): LocalModel | undefined {
    const candidates = this.list()
      .filter((m) => m.servesTaskTypes.includes(taskType))
      .filter((m) => (host ? this.meetsHardware(m, host) : true));

    if (candidates.length === 0) return undefined;

    const available = candidates
      .filter((m) => m.readiness === 'available')
      .sort((a, b) => a.ruPer1kTokens - b.ruPer1kTokens || a.id.localeCompare(b.id));

    if (available[0]) return available[0];

    // No direct candidate is available — walk the fallback chain of the preferred one.
    const preferred = candidates.sort(
      (a, b) => a.ruPer1kTokens - b.ruPer1kTokens || a.id.localeCompare(b.id),
    )[0]!;
    return this.firstAvailableInChain(preferred, host);
  }

  /** Walk fallbackModelId links and return the first 'available' model (cycle-safe). */
  getFallbackChain(id: string): LocalModel[] {
    const chain: LocalModel[] = [];
    const seen = new Set<string>();
    let current = this.models.get(id);
    while (current && !seen.has(current.id)) {
      chain.push(current);
      seen.add(current.id);
      current = current.fallbackModelId ? this.models.get(current.fallbackModelId) : undefined;
    }
    return chain;
  }

  /** Does the host satisfy a model's declared hardware floor? (R5) */
  meetsHardware(model: LocalModel, host: HostProfile): boolean {
    const req = model.hardwareRequirements;
    if (!req) return true;
    if (host.ramMb < req.minRamMb) return false;
    if (req.requiresGpu && !host.hasGpu) return false;
    if (req.minVramMb !== undefined && (host.vramMb ?? 0) < req.minVramMb) return false;
    return true;
  }

  /**
   * Total concurrent local inference slots across all *available* models.
   * This is the bound the Chief uses to size the offline swarm (R5).
   */
  totalInferenceSlots(host?: HostProfile): number {
    return this.list()
      .filter((m) => m.readiness === 'available')
      .filter((m) => (host ? this.meetsHardware(m, host) : true))
      .reduce((sum, m) => sum + m.concurrencySlots, 0);
  }

  private firstAvailableInChain(start: LocalModel, host?: HostProfile): LocalModel | undefined {
    for (const m of this.getFallbackChain(start.id)) {
      if (m.readiness !== 'available') continue;
      if (host && !this.meetsHardware(m, host)) continue;
      return m;
    }
    return undefined;
  }
}
