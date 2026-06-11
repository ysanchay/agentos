/**
 * @agentos/capabilities — Capability Resolver
 * 7-step resolution algorithm: lookup → filter → permission →
 * constraint → score → rank → result.
 */

import type {
  CapabilityPath,
  Capability,
  CapabilityProvider,
  ResolutionRequest,
  ResolutionResult,
  MatchType,
  OptimizationTarget,
  ResourceBudget,
  Outcome,
} from '@agentos/types';
import { ok, err } from '@agentos/types';
import type { CapabilityRegistry } from './capability-registry.js';
import type { ICapabilityProvider } from './types.js';

// ─── Scoring Weights ──────────────────────────────────────────────────────

interface ScoringWeights {
  latency: number;
  cost: number;
  reliability: number;
  load: number;
}

const OPTIMIZATION_WEIGHTS: Record<OptimizationTarget, ScoringWeights> = {
  latency: { latency: 0.5, cost: 0.1, reliability: 0.2, load: 0.2 },
  cost: { latency: 0.1, cost: 0.5, reliability: 0.2, load: 0.2 },
  reliability: { latency: 0.1, cost: 0.1, reliability: 0.6, load: 0.2 },
  quality: { latency: 0.1, cost: 0.1, reliability: 0.4, load: 0.4 },
  balanced: { latency: 0.25, cost: 0.25, reliability: 0.25, load: 0.25 },
};

interface ScoredProvider {
  provider: ICapabilityProvider;
  capability: Capability;
  matchType: MatchType;
  score: number;
}

export class CapabilityResolver {
  private registry: CapabilityRegistry;

  constructor(registry: CapabilityRegistry) {
    this.registry = registry;
  }

  /**
   * Resolve a capability request to the best provider.
   */
  resolve(request: ResolutionRequest): Outcome<ResolutionResult> {
    // Step 1: Capability Lookup
    const lookup = this.lookupCapability(request.capability_path);
    if (!lookup) {
      return err('CG_E.CAPABILITY_NOT_FOUND', `No capability found for path: ${request.capability_path}`, { retryable: false });
    }
    const { capability, matchType } = lookup;

    // Step 2: Provider Filtering
    let providers = this.registry.getProviders(request.capability_path);
    if (providers.length === 0) {
      return err('CG_E.NO_PROVIDER_AVAILABLE', `No providers available for: ${request.capability_path}`, { retryable: true });
    }

    // Filter out excluded providers
    if (request.constraints.exclude_providers && request.constraints.exclude_providers.length > 0) {
      const excluded = new Set(request.constraints.exclude_providers);
      providers = providers.filter(p => !excluded.has(p.providerRecord.id));
    }

    // Filter by require_local
    if (request.constraints.require_local) {
      providers = providers.filter(p => p.providerRecord.agent_id !== undefined);
    }

    // Filter by require_agent
    if (request.constraints.require_agent) {
      providers = providers.filter(p => p.providerRecord.agent_id !== undefined);
    }

    // Filter over-capacity providers
    providers = providers.filter(p => p.providerRecord.current_load < p.providerRecord.max_concurrent);

    if (providers.length === 0) {
      return err('CG_E.NO_PROVIDER_AVAILABLE', `All providers filtered for: ${request.capability_path}`, { retryable: true });
    }

    // Step 3: Constraint Filtering
    providers = this.applyConstraints(providers, request);
    if (providers.length === 0) {
      return err('CG_E.NO_PROVIDER_AVAILABLE', `No providers meet constraints for: ${request.capability_path}`, { retryable: true });
    }

    // Step 4 + 5: Scoring and Ranking
    const scored = this.scoreAndRank(providers, capability, matchType, request);

    if (scored.length === 0) {
      return err('CG_E.NO_PROVIDER_AVAILABLE', `No viable providers for: ${request.capability_path}`, { retryable: true });
    }

    // Step 6: Build Result
    const top = scored[0]!;
    const alternatives = scored.slice(1, 6).map(s => ({
      provider: s.provider.providerRecord,
      score: s.score,
    }));

    const result: ResolutionResult = {
      request,
      provider: top.provider.providerRecord,
      capability: top.capability,
      match_type: top.matchType,
      confidence: top.score,
      estimated_latency_ms: top.provider.providerRecord.avg_latency_ms,
      estimated_cost: this.estimateCost(top.provider.providerRecord),
      alternatives,
      resolved_at: new Date().toISOString(),
    };

    return ok(result);
  }

  // ─── Step 1: Capability Lookup ──────────────────────────────────────────

  private lookupCapability(path: CapabilityPath): { capability: Capability; matchType: MatchType } | null {
    // Exact match
    const exact = this.registry.getCapabilityByPath(path);
    if (exact) {
      return { capability: exact, matchType: 'exact' };
    }

    // Parent fallback
    const parts = (path as string).split('.');
    for (let depth = parts.length - 1; depth >= 1; depth--) {
      const parentPath = parts.slice(0, depth).join('.') as CapabilityPath;
      const parent = this.registry.getCapabilityByPath(parentPath);
      if (parent) {
        return { capability: parent, matchType: 'parent_fallback' };
      }
    }

    return null;
  }

  // ─── Step 3: Constraint Filtering ───────────────────────────────────────

  private applyConstraints(providers: ICapabilityProvider[], request: ResolutionRequest): ICapabilityProvider[] {
    return providers.filter(provider => {
      const rec = provider.providerRecord;

      // Max latency
      if (request.constraints.max_latency_ms !== undefined && rec.avg_latency_ms > request.constraints.max_latency_ms) {
        return false;
      }

      // Min reliability
      if (request.constraints.min_reliability !== undefined && rec.reliability_score < request.constraints.min_reliability) {
        return false;
      }

      // Max cost
      if (request.constraints.max_cost) {
        const estimated = this.estimateCost(rec);
        if (this.exceedsBudget(estimated, request.constraints.max_cost)) {
          return false;
        }
      }

      return true;
    });
  }

  // ─── Step 4 + 5: Scoring and Ranking ────────────────────────────────────

  private scoreAndRank(
    providers: ICapabilityProvider[],
    capability: Capability,
    matchType: MatchType,
    request: ResolutionRequest,
  ): ScoredProvider[] {
    const weights = OPTIMIZATION_WEIGHTS[request.preferences.optimize_for] ?? OPTIMIZATION_WEIGHTS.balanced;

    // Collect stats for normalization
    let maxLatency = 0;
    let maxCost = 0;
    for (const p of providers) {
      maxLatency = Math.max(maxLatency, p.providerRecord.avg_latency_ms || 1);
      const cost = this.estimateCostValue(p.providerRecord);
      maxCost = Math.max(maxCost, cost || 1);
    }

    const scored: ScoredProvider[] = providers.map(provider => {
      const rec = provider.providerRecord;

      const latencyScore = 1 - ((rec.avg_latency_ms || 0) / maxLatency);
      const costScore = 1 - ((this.estimateCostValue(rec) || 0) / maxCost);
      const reliabilityScore = rec.reliability_score;
      const loadScore = rec.max_concurrent > 0
        ? 1 - (rec.current_load / rec.max_concurrent)
        : 0.5;

      const score =
        weights.latency * latencyScore +
        weights.cost * costScore +
        weights.reliability * reliabilityScore +
        weights.load * loadScore;

      return {
        provider,
        capability,
        matchType,
        score: Math.max(0, Math.min(1, score)),
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  // ─── Cost Estimation ────────────────────────────────────────────────────

  private estimateCost(provider: CapabilityProvider): ResourceBudget {
    const model = provider.cost_model;
    switch (model.type) {
      case 'free':
        return { ru: 0, mu: 0, eu: 0, vu: 0 };
      case 'per_call':
        return model.cost;
      case 'per_unit':
        return model.cost;
      case 'tiered':
        return model.tiers[0]?.cost ?? { ru: 0, mu: 0, eu: 0, vu: 0 };
      case 'subscription':
        return { ru: 0, mu: 0, eu: 0, vu: 0 };
      default:
        return { ru: 0, mu: 0, eu: 0, vu: 0 };
    }
  }

  private estimateCostValue(provider: CapabilityProvider): number {
    const cost = this.estimateCost(provider);
    return cost.ru + cost.mu + cost.eu + cost.vu;
  }

  private exceedsBudget(estimated: ResourceBudget, limit: ResourceBudget): boolean {
    return estimated.ru > limit.ru || estimated.mu > limit.mu ||
           estimated.eu > limit.eu || estimated.vu > limit.vu;
  }
}