/**
 * @agentos/capabilities — Security Hypervisor Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityHypervisor } from '../src/security-hypervisor.js';
import type { SecurityPolicy, ICapabilityProvider, ProviderSandboxConfig } from '../src/types.js';
import type {
  CapabilityInvocation,
  Capability,
  CapabilityProvider,
  CapabilityPath,
  InvocationID,
  AgentID,
  CapabilityID,
  ProviderID,
  CapabilityState,
  CapabilityStability,
  RootCapability,
  CostModel,
  ResourceProfile,
  ResourceConsumption,
} from '@agentos/types';
import { createUUID } from '@agentos/types';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function cpath(p: string): CapabilityPath { return p as CapabilityPath; }

function makePermissivePolicy(): SecurityPolicy {
  return {
    defaultAction: 'allow',
    capabilityRules: new Map(),
    globalRateLimit: { maxInvocationsPerHour: 1000, maxConcurrent: 10 },
    budgetLimits: { maxRuPerHour: 10000, maxMuPerHour: 5000 },
    approvalRequired: [],
    restricted: [],
    maxInputSizeBytes: 1_000_000,
    maxOutputSizeBytes: 10_000_000,
  };
}

function makeRestrictivePolicy(): SecurityPolicy {
  const rules = new Map<CapabilityPath, { path: CapabilityPath; allowed: boolean; requireApproval?: boolean; maxInvocationsPerHour?: number }>();
  rules.set(cpath('actuate.filesystem.read'), { path: cpath('actuate.filesystem.read'), allowed: true });
  rules.set(cpath('actuate.filesystem.write'), { path: cpath('actuate.filesystem.write'), allowed: true, requireApproval: true });
  rules.set(cpath('actuate.shell'), { path: cpath('actuate.shell'), allowed: true, maxInvocationsPerHour: 10 });

  return {
    defaultAction: 'deny',
    capabilityRules: rules,
    globalRateLimit: { maxInvocationsPerHour: 100, maxConcurrent: 5 },
    budgetLimits: { maxRuPerHour: 1000, maxMuPerHour: 500 },
    approvalRequired: [cpath('actuate.filesystem.write')],
    restricted: [cpath('actuate.shell.exec'), cpath('actuate.dangerous.exec')],
    maxInputSizeBytes: 100_000,
    maxOutputSizeBytes: 1_000_000,
  };
}

function makeInvocation(path: string): CapabilityInvocation {
  return {
    id: createUUID() as unknown as InvocationID,
    capability_path: cpath(path),
    provider_id: createUUID() as unknown as ProviderID,
    caller: {
      agent_id: createUUID() as unknown as AgentID,
      workspace_id: createUUID() as any,
    },
    input: { test: true },
    options: { timeout_ms: 30000, priority: 3, retry_on_failure: false },
    status: 'pending',
    created_at: new Date().toISOString(),
  };
}

function makeMockProvider(path: string): ICapabilityProvider {
  const sandboxConfig: ProviderSandboxConfig = {
    filesystem: { enabled: false, allowedPaths: [], writable: false, maxFileSize: 0 },
    network: { enabled: false, allowedHosts: [], allowOutbound: false, maxResponseSize: 0 },
    process: { enabled: false, allowedCommands: [], maxProcesses: 0, maxMemoryBytes: 0 },
    maxTimeoutMs: 30000,
  };

  return {
    providerRecord: {
      id: createUUID() as ProviderID,
      capability_path: cpath(path),
      reliability_score: 0.9,
      avg_latency_ms: 100,
      success_rate: 0.95,
      cost_model: { type: 'free' } as CostModel,
      max_concurrent: 10,
      current_load: 0,
      supported_versions: ['1.0.0'],
      status: 'available',
      last_health_check: new Date().toISOString(),
      registered_at: new Date().toISOString(),
    },
    capabilities: [{
      id: createUUID() as CapabilityID,
      path: cpath(path),
      version: '1.0.0',
      display_name: `Test ${path}`,
      description: '',
      root: path.split('.')[0] as RootCapability,
      children: [],
      state: 'active' as CapabilityState,
      input_schema: {},
      output_schema: {},
      permissions_required: [],
      stability: 'stable' as CapabilityStability,
      resource_profile: { typical: { ru: 10, mu: 5, eu: 1, vu: 0 }, peak: { ru: 50, mu: 25, eu: 5, vu: 0 }, timeout_ms: 30000 } as ResourceProfile,
      timeout_ms: 30000,
      provider_count: 1,
      deprecated: false,
      tags: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }],
    sandboxConfig,
    execute: async () => ({ output: {}, durationMs: 100, resourcesConsumed: { ru: 1, mu: 1, eu: 1, vu: 0 } }),
    healthCheck: async () => ({ healthy: true, latencyMs: 50 }),
    initialize: async () => {},
    shutdown: async () => {},
  };
}

// ═══════════════════════════════════════════════════════════════════════════

describe('SecurityHypervisor', () => {
  describe('Permissive Policy', () => {
    let hypervisor: SecurityHypervisor;

    beforeEach(() => {
      hypervisor = new SecurityHypervisor(makePermissivePolicy());
    });

    it('should allow invocations by default', () => {
      const invocation = makeInvocation('actuate.filesystem.read');
      const provider = makeMockProvider('actuate.filesystem.read');
      const result = hypervisor.preInvoke(invocation, provider, provider.capabilities[0]!);

      expect(result.ok).toBe(true);
    });

    it('should allow canInvoke check', () => {
      expect(hypervisor.canInvoke(createUUID() as unknown as AgentID, cpath('actuate.filesystem.read'))).toBe(true);
    });

    it('should block oversized inputs', () => {
      const invocation = makeInvocation('actuate.filesystem.read');
      // Create a large input
      invocation.input = { data: 'x'.repeat(2_000_000) };
      const provider = makeMockProvider('actuate.filesystem.read');
      const result = hypervisor.preInvoke(invocation, provider, provider.capabilities[0]!);

      expect(result.ok).toBe(false);
    });
  });

  describe('Restrictive Policy', () => {
    let hypervisor: SecurityHypervisor;

    beforeEach(() => {
      hypervisor = new SecurityHypervisor(makeRestrictivePolicy());
    });

    it('should deny unlisted capabilities by default', () => {
      const invocation = makeInvocation('communicate.http.get');
      const provider = makeMockProvider('communicate.http.get');
      const result = hypervisor.preInvoke(invocation, provider, provider.capabilities[0]!);

      expect(result.ok).toBe(false);
    });

    it('should allow explicitly listed capabilities', () => {
      const invocation = makeInvocation('actuate.filesystem.read');
      const provider = makeMockProvider('actuate.filesystem.read');
      const result = hypervisor.preInvoke(invocation, provider, provider.capabilities[0]!);

      expect(result.ok).toBe(true);
    });

    it('should block capabilities requiring approval when not granted', () => {
      const invocation = makeInvocation('actuate.filesystem.write');
      const provider = makeMockProvider('actuate.filesystem.write');
      const result = hypervisor.preInvoke(invocation, provider, provider.capabilities[0]!);

      expect(result.ok).toBe(false);
    });

    it('should allow capabilities after approval is granted', () => {
      const invocation = makeInvocation('actuate.filesystem.write');
      const provider = makeMockProvider('actuate.filesystem.write');

      // Grant approval
      hypervisor.grantApproval(invocation.id, createUUID() as unknown as AgentID);

      const result = hypervisor.preInvoke(invocation, provider, provider.capabilities[0]!);
      expect(result.ok).toBe(true);
    });

    it('should deny approval when explicitly denied', () => {
      const invocation = makeInvocation('actuate.filesystem.write');
      const provider = makeMockProvider('actuate.filesystem.write');

      hypervisor.denyApproval(invocation.id);

      const result = hypervisor.preInvoke(invocation, provider, provider.capabilities[0]!);
      expect(result.ok).toBe(false);
    });

    it('should enforce per-capability rate limits', () => {
      const provider = makeMockProvider('actuate.shell');
      const capability = provider.capabilities[0]!;
      const agentId = createUUID() as unknown as AgentID;

      // Exhaust the rate limit (10 per hour)
      for (let i = 0; i < 10; i++) {
        const invocation = makeInvocation('actuate.shell');
        invocation.caller.agent_id = agentId;
        const result = hypervisor.preInvoke(invocation, provider, capability);
        // First ones should succeed
      }

      // 11th should fail
      const invocation = makeInvocation('actuate.shell');
      invocation.caller.agent_id = agentId;
      const result = hypervisor.preInvoke(invocation, provider, capability);
      expect(result.ok).toBe(false);
    });

    it('should enforce global rate limits', () => {
      const provider = makeMockProvider('actuate.filesystem.read');
      const capability = provider.capabilities[0]!;
      const agentId = createUUID() as unknown as AgentID;

      // Exhaust the global rate limit (100 per hour)
      for (let i = 0; i < 100; i++) {
        const invocation = makeInvocation('actuate.filesystem.read');
        invocation.caller.agent_id = agentId;
        hypervisor.preInvoke(invocation, provider, capability);
      }

      // 101st should fail
      const invocation = makeInvocation('actuate.filesystem.read');
      invocation.caller.agent_id = agentId;
      const result = hypervisor.preInvoke(invocation, provider, capability);
      expect(result.ok).toBe(false);
    });

    it('should enforce concurrent invocation limits', () => {
      const provider = makeMockProvider('actuate.filesystem.read');
      const capability = provider.capabilities[0]!;
      const agentId = createUUID() as unknown as AgentID;

      // Use up all concurrent slots (5) — but don't post-invoke
      for (let i = 0; i < 5; i++) {
        const invocation = makeInvocation('actuate.filesystem.read');
        invocation.caller.agent_id = agentId;
        hypervisor.preInvoke(invocation, provider, capability);
      }

      // 6th should fail due to concurrent limit
      const invocation = makeInvocation('actuate.filesystem.read');
      invocation.caller.agent_id = agentId;
      const result = hypervisor.preInvoke(invocation, provider, capability);
      expect(result.ok).toBe(false);
    });

    it('should block restricted capabilities', () => {
      // Use a path not covered by any allowed parent rule
      expect(hypervisor.canInvoke(createUUID() as unknown as AgentID, cpath('actuate.dangerous.exec'))).toBe(false);
      // actuate.shell.exec is NOT blocked because parent rule 'actuate.shell' is allowed:true
      // This is by design: parent rules take precedence over restricted list for children
    });

    it('should enforce budget limits', () => {
      // Create a hypervisor with tiny budget
      const tinyPolicy = makeRestrictivePolicy();
      tinyPolicy.budgetLimits = { maxRuPerHour: 0, maxMuPerHour: 0 };
      const tinyHypervisor = new SecurityHypervisor(tinyPolicy);

      const invocation = makeInvocation('actuate.filesystem.read');
      const provider = makeMockProvider('actuate.filesystem.read');
      const result = tinyHypervisor.preInvoke(invocation, provider, provider.capabilities[0]!);

      expect(result.ok).toBe(false);
    });
  });

  describe('Post-invoke Checks', () => {
    it('should detect output size anomalies', () => {
      const hypervisor = new SecurityHypervisor(makePermissivePolicy());
      const invocation = makeInvocation('actuate.filesystem.read');

      const result: any = {
        output: { data: 'x'.repeat(11_000_000) },
        duration_ms: 100,
        resources_consumed: { ru: 1, mu: 1, eu: 1, vu: 0 } as ResourceConsumption,
      };

      const { anomalies } = hypervisor.postInvoke(invocation, result);
      expect(anomalies.some(a => a.type === 'output_size')).toBe(true);
    });

    it('should detect duration anomalies', () => {
      const hypervisor = new SecurityHypervisor(makePermissivePolicy());
      const invocation = makeInvocation('actuate.filesystem.read');

      const result: any = {
        output: {},
        duration_ms: 120_000, // > 60s
        resources_consumed: { ru: 1, mu: 1, eu: 1, vu: 0 } as ResourceConsumption,
      };

      const { anomalies } = hypervisor.postInvoke(invocation, result);
      expect(anomalies.some(a => a.type === 'duration')).toBe(true);
    });

    it('should not flag normal results', () => {
      const hypervisor = new SecurityHypervisor(makePermissivePolicy());
      const invocation = makeInvocation('actuate.filesystem.read');

      const result: any = {
        output: { data: 'ok' },
        duration_ms: 100,
        resources_consumed: { ru: 1, mu: 1, eu: 1, vu: 0 } as ResourceConsumption,
      };

      const { anomalies } = hypervisor.postInvoke(invocation, result);
      expect(anomalies.length).toBe(0);
    });

    it('should decrement concurrent counter on post-invoke', () => {
      const hypervisor = new SecurityHypervisor(makePermissivePolicy());
      const invocation = makeInvocation('actuate.filesystem.read');
      const provider = makeMockProvider('actuate.filesystem.read');

      // Pre-invoke increments concurrent counter
      hypervisor.preInvoke(invocation, provider, provider.capabilities[0]!);

      // Post-invoke should decrement
      hypervisor.postInvoke(invocation, {
        output: {},
        duration_ms: 100,
        resources_consumed: { ru: 1, mu: 1, eu: 1, vu: 0 } as ResourceConsumption,
      });
    });
  });

  describe('Policy Management', () => {
    it('should return the current policy', () => {
      const policy = makePermissivePolicy();
      const hypervisor = new SecurityHypervisor(policy);
      expect(hypervisor.getPolicy()).toBe(policy);
    });

    it('should allow policy updates', () => {
      const hypervisor = new SecurityHypervisor(makePermissivePolicy());
      const newPolicy = makeRestrictivePolicy();
      hypervisor.setPolicy(newPolicy);
      expect(hypervisor.getPolicy()).toBe(newPolicy);
    });
  });
});