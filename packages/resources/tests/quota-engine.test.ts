import { describe, it, expect, beforeEach } from 'vitest';
import { QuotaEngine, type AgentUsage, type WorkspaceUsage, type UserUsage, type EnterpriseUsage } from '../src/quota-engine.js';
import { KER } from '@agentos/types';
import type { AgentQuota, WorkspaceQuota, UserQuota, EnterpriseQuota, ResourceRequest } from '@agentos/types';
import { createUUID } from '@agentos/types';

function makeAgentId() { return createUUID() as unknown as import('@agentos/types').AgentID; }
function makeWorkspaceId() { return createUUID() as unknown as import('@agentos/types').WorkspaceID; }
function makeUserId() { return createUUID() as unknown as import('@agentos/types').UserID; }
function makeOrgId() { return createUUID() as unknown as import('@agentos/types').OrgID; }

const defaultAgentUsage: AgentUsage = {
  ru_this_hour: 0,
  mu_current: 0,
  eu_this_hour: 0,
  vu_this_hour: 0,
  ru_total: 0,
  eu_total: 0,
  current_rpm: 0,
  concurrent_tasks: 0,
};

const defaultWorkspaceUsage: WorkspaceUsage = {
  agent_count: 0,
  task_count: 0,
  memory_entries: 0,
  ru_this_hour: 0,
  mu_current: 0,
  eu_this_hour: 0,
  vu_this_hour: 0,
  ru_monthly: 0,
  eu_monthly: 0,
};

const defaultUserUsage: UserUsage = {
  workspace_count: 0,
  agent_count: 0,
  ru_today: 0,
  eu_today: 0,
};

const defaultEnterpriseUsage: EnterpriseUsage = {
  user_count: 0,
  workspace_count: 0,
  ru_this_month: 0,
  mu_current: 0,
  eu_this_month: 0,
  vu_this_month: 0,
};

function makeRequest(overrides: Partial<ResourceRequest> = {}): ResourceRequest {
  return {
    requester: makeAgentId(),
    workspace_id: makeWorkspaceId(),
    priority: 3,
    ru: 10,
    mu: 5,
    eu: 2,
    vu: 1,
    duration_ms: 3600000,
    preemptible: true,
    reason: 'test',
    ...overrides,
  };
}

describe('QuotaEngine', () => {
  let engine: QuotaEngine;

  beforeEach(() => {
    engine = new QuotaEngine();
  });

  describe('setAgentQuota / getAgentQuota', () => {
    it('should store and retrieve agent quota', () => {
      const agentId = makeAgentId();
      const quota: AgentQuota = {
        agent_id: agentId,
        ru_per_hour: 1000,
        mu_max: 500,
        eu_per_hour: 200,
        vu_per_hour: 100,
        total_ru_budget: 10000,
        total_eu_budget: 5000,
        max_rpm: 60,
        max_concurrent_tasks: 10,
        burst_ru_per_minute: 100,
        burst_eu_per_minute: 50,
      };

      engine.setAgentQuota(quota);
      const retrieved = engine.getAgentQuota(agentId);
      expect(retrieved).toEqual(quota);
    });
  });

  describe('check - agent level', () => {
    it('should allow when no agent quota is set', () => {
      const result = engine.check(makeRequest(), defaultAgentUsage, defaultWorkspaceUsage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(true);
    });

    it('should deny when agent RU per hour quota exceeded', () => {
      const agentId = makeAgentId();
      const quota: AgentQuota = {
        agent_id: agentId,
        ru_per_hour: 100,
        mu_max: 0,
        eu_per_hour: 0,
        vu_per_hour: 0,
        total_ru_budget: -1,
        total_eu_budget: -1,
        max_rpm: 0,
        max_concurrent_tasks: 0,
        burst_ru_per_minute: 0,
        burst_eu_per_minute: 0,
      };
      engine.setAgentQuota(quota);

      const usage: AgentUsage = { ...defaultAgentUsage, ru_this_hour: 95 };
      const request = makeRequest({ requester: agentId, ru: 10 });

      const result = engine.check(request, usage, defaultWorkspaceUsage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(false);
      expect(result.violated_level).toBe('agent');
      expect(result.violated_quota).toBe('ru_per_hour');
    });

    it('should deny when agent MU max exceeded', () => {
      const agentId = makeAgentId();
      const quota: AgentQuota = {
        agent_id: agentId,
        ru_per_hour: 0,
        mu_max: 50,
        eu_per_hour: 0,
        vu_per_hour: 0,
        total_ru_budget: -1,
        total_eu_budget: -1,
        max_rpm: 0,
        max_concurrent_tasks: 0,
        burst_ru_per_minute: 0,
        burst_eu_per_minute: 0,
      };
      engine.setAgentQuota(quota);

      const usage: AgentUsage = { ...defaultAgentUsage, mu_current: 45 };
      const request = makeRequest({ requester: agentId, mu: 10 });

      const result = engine.check(request, usage, defaultWorkspaceUsage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(false);
      expect(result.violated_level).toBe('agent');
      expect(result.violated_quota).toBe('mu_max');
    });

    it('should deny when agent EU per hour exceeded', () => {
      const agentId = makeAgentId();
      const quota: AgentQuota = {
        agent_id: agentId,
        ru_per_hour: 0,
        mu_max: 0,
        eu_per_hour: 50,
        vu_per_hour: 0,
        total_ru_budget: -1,
        total_eu_budget: -1,
        max_rpm: 0,
        max_concurrent_tasks: 0,
        burst_ru_per_minute: 0,
        burst_eu_per_minute: 0,
      };
      engine.setAgentQuota(quota);

      const usage: AgentUsage = { ...defaultAgentUsage, eu_this_hour: 45 };
      const request = makeRequest({ requester: agentId, eu: 10 });

      const result = engine.check(request, usage, defaultWorkspaceUsage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(false);
      expect(result.violated_quota).toBe('eu_per_hour');
    });

    it('should deny when agent VU per hour exceeded', () => {
      const agentId = makeAgentId();
      const quota: AgentQuota = {
        agent_id: agentId,
        ru_per_hour: 0,
        mu_max: 0,
        eu_per_hour: 0,
        vu_per_hour: 20,
        total_ru_budget: -1,
        total_eu_budget: -1,
        max_rpm: 0,
        max_concurrent_tasks: 0,
        burst_ru_per_minute: 0,
        burst_eu_per_minute: 0,
      };
      engine.setAgentQuota(quota);

      const usage: AgentUsage = { ...defaultAgentUsage, vu_this_hour: 15 };
      const request = makeRequest({ requester: agentId, vu: 10 });

      const result = engine.check(request, usage, defaultWorkspaceUsage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(false);
      expect(result.violated_quota).toBe('vu_per_hour');
    });

    it('should deny when total RU budget exceeded', () => {
      const agentId = makeAgentId();
      const quota: AgentQuota = {
        agent_id: agentId,
        ru_per_hour: 0,
        mu_max: 0,
        eu_per_hour: 0,
        vu_per_hour: 0,
        total_ru_budget: 1000,
        total_eu_budget: -1,
        max_rpm: 0,
        max_concurrent_tasks: 0,
        burst_ru_per_minute: 0,
        burst_eu_per_minute: 0,
      };
      engine.setAgentQuota(quota);

      const usage: AgentUsage = { ...defaultAgentUsage, ru_total: 950 };
      const request = makeRequest({ requester: agentId, ru: 100 });

      const result = engine.check(request, usage, defaultWorkspaceUsage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(false);
      expect(result.violated_quota).toBe('total_ru_budget');
    });

    it('should deny when total EU budget exceeded', () => {
      const agentId = makeAgentId();
      const quota: AgentQuota = {
        agent_id: agentId,
        ru_per_hour: 0,
        mu_max: 0,
        eu_per_hour: 0,
        vu_per_hour: 0,
        total_ru_budget: -1,
        total_eu_budget: 500,
        max_rpm: 0,
        max_concurrent_tasks: 0,
        burst_ru_per_minute: 0,
        burst_eu_per_minute: 0,
      };
      engine.setAgentQuota(quota);

      const usage: AgentUsage = { ...defaultAgentUsage, eu_total: 450 };
      const request = makeRequest({ requester: agentId, eu: 100 });

      const result = engine.check(request, usage, defaultWorkspaceUsage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(false);
      expect(result.violated_quota).toBe('total_eu_budget');
    });

    it('should allow when within quota', () => {
      const agentId = makeAgentId();
      const quota: AgentQuota = {
        agent_id: agentId,
        ru_per_hour: 1000,
        mu_max: 500,
        eu_per_hour: 200,
        vu_per_hour: 100,
        total_ru_budget: 10000,
        total_eu_budget: 5000,
        max_rpm: 60,
        max_concurrent_tasks: 10,
        burst_ru_per_minute: 100,
        burst_eu_per_minute: 50,
      };
      engine.setAgentQuota(quota);

      const usage: AgentUsage = { ...defaultAgentUsage, ru_this_hour: 50, mu_current: 20 };
      const request = makeRequest({ requester: agentId, ru: 10, mu: 5 });

      const result = engine.check(request, usage, defaultWorkspaceUsage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(true);
    });

    it('should allow when quota value is 0 (disabled)', () => {
      const agentId = makeAgentId();
      const quota: AgentQuota = {
        agent_id: agentId,
        ru_per_hour: 0, // 0 means no limit
        mu_max: 0,
        eu_per_hour: 0,
        vu_per_hour: 0,
        total_ru_budget: -1,
        total_eu_budget: -1,
        max_rpm: 0,
        max_concurrent_tasks: 0,
        burst_ru_per_minute: 0,
        burst_eu_per_minute: 0,
      };
      engine.setAgentQuota(quota);

      const usage: AgentUsage = { ...defaultAgentUsage };
      const request = makeRequest({ requester: agentId, ru: 99999 });

      const result = engine.check(request, usage, defaultWorkspaceUsage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(true);
    });
  });

  describe('check - workspace level', () => {
    it('should deny when workspace RU per hour exceeded', () => {
      const workspaceId = makeWorkspaceId();
      const quota: WorkspaceQuota = {
        workspace_id: workspaceId,
        max_agents: 10,
        max_tasks: 100,
        max_memory_entries: 1000,
        total_ru_per_hour: 500,
        total_mu: 200,
        total_eu_per_hour: 100,
        total_vu_per_hour: 50,
        max_priority: 5 as any,
        monthly_ru_budget: -1,
        monthly_eu_budget: -1,
      };
      engine.setWorkspaceQuota(quota);

      const usage: WorkspaceUsage = { ...defaultWorkspaceUsage, ru_this_hour: 490 };
      const request = makeRequest({ workspace_id: workspaceId, ru: 20 });

      const result = engine.check(request, defaultAgentUsage, usage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(false);
      expect(result.violated_level).toBe('workspace');
    });
  });

  describe('check - user level', () => {
    it('should deny when user RU per day exceeded', () => {
      const userId = makeUserId();
      const quota: UserQuota = {
        user_id: userId,
        total_workspaces: 5,
        total_agents_all_workspaces: 20,
        total_ru_per_day: 1000,
        total_eu_per_day: 500,
        billing_limit: -1,
        billing_alert_threshold: 80,
      };
      engine.setUserQuota(quota);

      const usage: UserUsage = { ...defaultUserUsage, ru_today: 990 };
      const request = makeRequest({ ru: 20 });

      const result = engine.check(request, defaultAgentUsage, defaultWorkspaceUsage, usage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(false);
      expect(result.violated_level).toBe('user');
      expect(result.violated_quota).toBe('total_ru_per_day');
    });

    it('should deny when user EU per day exceeded', () => {
      const userId = makeUserId();
      const quota: UserQuota = {
        user_id: userId,
        total_workspaces: 5,
        total_agents_all_workspaces: 20,
        total_ru_per_day: 0,
        total_eu_per_day: 500,
        billing_limit: -1,
        billing_alert_threshold: 80,
      };
      engine.setUserQuota(quota);

      const usage: UserUsage = { ...defaultUserUsage, eu_today: 490 };
      const request = makeRequest({ eu: 20 });

      const result = engine.check(request, defaultAgentUsage, defaultWorkspaceUsage, usage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(false);
      expect(result.violated_quota).toBe('total_eu_per_day');
    });
  });

  describe('check - enterprise level', () => {
    it('should deny when enterprise RU per month exceeded', () => {
      const orgId = makeOrgId();
      const quota: EnterpriseQuota = {
        org_id: orgId,
        total_users: 100,
        total_workspaces: 50,
        total_ru_per_month: 100000,
        total_mu: 5000,
        total_eu_per_month: 50000,
        total_vu_per_month: 10000,
        sla_tier: 'standard',
        dedicated_resources: false,
        max_priority: 5 as any,
        support_response_sla: 24,
      };
      engine.setEnterpriseQuota(quota);

      const usage: EnterpriseUsage = { ...defaultEnterpriseUsage, ru_this_month: 99900 };
      const request = makeRequest({ ru: 200 });

      const result = engine.check(request, defaultAgentUsage, defaultWorkspaceUsage, defaultUserUsage, usage);
      expect(result.allowed).toBe(false);
      expect(result.violated_level).toBe('enterprise');
      expect(result.violated_quota).toBe('total_ru_per_month');
    });

    it('should deny when request priority exceeds enterprise max_priority', () => {
      const orgId = makeOrgId();
      const quota: EnterpriseQuota = {
        org_id: orgId,
        total_users: 100,
        total_workspaces: 50,
        total_ru_per_month: 0,
        total_mu: 0,
        total_eu_per_month: 0,
        total_vu_per_month: 0,
        sla_tier: 'standard',
        dedicated_resources: false,
        max_priority: 2 as any, // HIGH max
        support_response_sla: 24,
      };
      engine.setEnterpriseQuota(quota);

      const request = makeRequest({ priority: 3 }); // NORMAL > HIGH

      const result = engine.check(request, defaultAgentUsage, defaultWorkspaceUsage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(false);
      expect(result.violated_quota).toBe('max_priority');
    });
  });

  describe('check - cascading through levels', () => {
    it('should pass all 4 levels when within quota', () => {
      const agentId = makeAgentId();
      const workspaceId = makeWorkspaceId();
      const userId = makeUserId();
      const orgId = makeOrgId();

      const agentQuota: AgentQuota = {
        agent_id: agentId, ru_per_hour: 1000, mu_max: 500, eu_per_hour: 200, vu_per_hour: 100,
        total_ru_budget: -1, total_eu_budget: -1, max_rpm: 60, max_concurrent_tasks: 10,
        burst_ru_per_minute: 100, burst_eu_per_minute: 50,
      };
      const workspaceQuota: WorkspaceQuota = {
        workspace_id: workspaceId, max_agents: 10, max_tasks: 100, max_memory_entries: 1000,
        total_ru_per_hour: 5000, total_mu: 2000, total_eu_per_hour: 1000, total_vu_per_hour: 500,
        max_priority: 5 as any, monthly_ru_budget: -1, monthly_eu_budget: -1,
      };
      const userQuota: UserQuota = {
        user_id: userId, total_workspaces: 5, total_agents_all_workspaces: 20,
        total_ru_per_day: 10000, total_eu_per_day: 5000, billing_limit: -1, billing_alert_threshold: 80,
      };
      const enterpriseQuota: EnterpriseQuota = {
        org_id: orgId, total_users: 100, total_workspaces: 50,
        total_ru_per_month: 100000, total_mu: 5000, total_eu_per_month: 50000,
        total_vu_per_month: 10000, sla_tier: 'standard', dedicated_resources: false,
        max_priority: 5 as any, support_response_sla: 24,
      };

      engine.setAgentQuota(agentQuota);
      engine.setWorkspaceQuota(workspaceQuota);
      engine.setUserQuota(userQuota);
      engine.setEnterpriseQuota(enterpriseQuota);

      const request = makeRequest({ requester: agentId, workspace_id: workspaceId, ru: 10, mu: 5 });
      const result = engine.check(request, defaultAgentUsage, defaultWorkspaceUsage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(true);
    });

    it('should stop at first violation level', () => {
      const agentId = makeAgentId();
      const agentQuota: AgentQuota = {
        agent_id: agentId, ru_per_hour: 10, mu_max: 0, eu_per_hour: 0, vu_per_hour: 0,
        total_ru_budget: -1, total_eu_budget: -1, max_rpm: 0, max_concurrent_tasks: 0,
        burst_ru_per_minute: 0, burst_eu_per_minute: 0,
      };
      engine.setAgentQuota(agentQuota);

      const usage: AgentUsage = { ...defaultAgentUsage, ru_this_hour: 5 };
      const request = makeRequest({ requester: agentId, ru: 10 });

      const result = engine.check(request, usage, defaultWorkspaceUsage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.allowed).toBe(false);
      expect(result.violated_level).toBe('agent');
      // Should not check workspace, user, or enterprise levels
    });
  });

  describe('validate', () => {
    it('should return ok(true) when check passes', () => {
      const result = engine.validate(makeRequest(), defaultAgentUsage, defaultWorkspaceUsage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(true);
      }
    });

    it('should return error when check fails', () => {
      const agentId = makeAgentId();
      const quota: AgentQuota = {
        agent_id: agentId, ru_per_hour: 10, mu_max: 0, eu_per_hour: 0, vu_per_hour: 0,
        total_ru_budget: -1, total_eu_budget: -1, max_rpm: 0, max_concurrent_tasks: 0,
        burst_ru_per_minute: 0, burst_eu_per_minute: 0,
      };
      engine.setAgentQuota(quota);

      const usage: AgentUsage = { ...defaultAgentUsage, ru_this_hour: 5 };
      const request = makeRequest({ requester: agentId, ru: 10 });

      const result = engine.validate(request, usage, defaultWorkspaceUsage, defaultUserUsage, defaultEnterpriseUsage);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe(KER.QUOTA_EXCEEDED);
      }
    });
  });

  describe('usage tracking', () => {
    it('should store and retrieve agent usage', () => {
      const agentId = makeAgentId();
      const usage: AgentUsage = { ...defaultAgentUsage, ru_this_hour: 500 };
      engine.setAgentUsage(agentId, usage);
      // Usage is used in check(), not stored for later retrieval
    });
  });
});