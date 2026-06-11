/**
 * @agentos/resources — Quota Engine
 * 4-level quota check: Agent -> Workspace -> User -> Enterprise
 * From resource-model-v1.md Section 6.
 */

import type {
  AgentID,
  WorkspaceID,
  UserID,
  OrgID,
  Outcome,
  ResourceRequest,
  ResourceConsumption,
} from '@agentos/types';
import type { AgentQuota, WorkspaceQuota, UserQuota, EnterpriseQuota } from '@agentos/types';
import { ok, err, KER } from '@agentos/types';

export interface QuotaCheckResult {
  allowed: boolean;
  violated_level?: 'agent' | 'workspace' | 'user' | 'enterprise';
  violated_quota?: string;
  message?: string;
}

export interface UsageSnapshot {
  agent: Map<string, AgentUsage>;
  workspace: Map<string, WorkspaceUsage>;
  user: Map<string, UserUsage>;
  enterprise: Map<string, EnterpriseUsage>;
}

export interface AgentUsage {
  ru_this_hour: number;
  mu_current: number;
  eu_this_hour: number;
  vu_this_hour: number;
  ru_total: number;
  eu_total: number;
  current_rpm: number;
  concurrent_tasks: number;
}

export interface WorkspaceUsage {
  agent_count: number;
  task_count: number;
  memory_entries: number;
  ru_this_hour: number;
  mu_current: number;
  eu_this_hour: number;
  vu_this_hour: number;
  ru_monthly: number;
  eu_monthly: number;
}

export interface UserUsage {
  workspace_count: number;
  agent_count: number;
  ru_today: number;
  eu_today: number;
}

export interface EnterpriseUsage {
  user_count: number;
  workspace_count: number;
  ru_this_month: number;
  mu_current: number;
  eu_this_month: number;
  vu_this_month: number;
}

export class QuotaEngine {
  private agentQuotas: Map<string, AgentQuota> = new Map();
  private workspaceQuotas: Map<string, WorkspaceQuota> = new Map();
  private userQuotas: Map<string, UserQuota> = new Map();
  private enterpriseQuotas: Map<string, EnterpriseQuota> = new Map();
  private usage: UsageSnapshot;

  constructor() {
    this.usage = {
      agent: new Map(),
      workspace: new Map(),
      user: new Map(),
      enterprise: new Map(),
    };
  }

  // ─── Quota Registration ─────────────────────────────────────────────

  setAgentQuota(quota: AgentQuota): void {
    this.agentQuotas.set(quota.agent_id, quota);
  }

  setWorkspaceQuota(quota: WorkspaceQuota): void {
    this.workspaceQuotas.set(quota.workspace_id, quota);
  }

  setUserQuota(quota: UserQuota): void {
    this.userQuotas.set(quota.user_id, quota);
  }

  setEnterpriseQuota(quota: EnterpriseQuota): void {
    this.enterpriseQuotas.set(quota.org_id, quota);
  }

  // ─── Usage Tracking ─────────────────────────────────────────────────

  setAgentUsage(agentId: string, usage: AgentUsage): void {
    this.usage.agent.set(agentId, usage);
  }

  setWorkspaceUsage(workspaceId: string, usage: WorkspaceUsage): void {
    this.usage.workspace.set(workspaceId, usage);
  }

  setUserUsage(userId: string, usage: UserUsage): void {
    this.usage.user.set(userId, usage);
  }

  setEnterpriseUsage(orgId: string, usage: EnterpriseUsage): void {
    this.usage.enterprise.set(orgId, usage);
  }

  // ─── 4-Level Check ─────────────────────────────────────────────────

  /**
   * Check a resource request against all 4 quota levels.
   * Returns the check result with details on which level failed.
   */
  check(
    request: ResourceRequest,
    agentUsage: AgentUsage,
    workspaceUsage: WorkspaceUsage,
    userUsage: UserUsage,
    enterpriseUsage: EnterpriseUsage,
  ): QuotaCheckResult {
    // Level 1: Agent quota
    const agentResult = this.checkAgentQuota(request, agentUsage);
    if (!agentResult.allowed) return agentResult;

    // Level 2: Workspace quota
    const workspaceResult = this.checkWorkspaceQuota(request, workspaceUsage);
    if (!workspaceResult.allowed) return workspaceResult;

    // Level 3: User quota
    const userResult = this.checkUserQuota(request, userUsage);
    if (!userResult.allowed) return userResult;

    // Level 4: Enterprise quota
    const enterpriseResult = this.checkEnterpriseQuota(request, enterpriseUsage);
    if (!enterpriseResult.allowed) return enterpriseResult;

    return { allowed: true };
  }

  /** Validate a full request and return an Outcome */
  validate(
    request: ResourceRequest,
    agentUsage: AgentUsage,
    workspaceUsage: WorkspaceUsage,
    userUsage: UserUsage,
    enterpriseUsage: EnterpriseUsage,
  ): Outcome<true> {
    const result = this.check(request, agentUsage, workspaceUsage, userUsage, enterpriseUsage);
    if (result.allowed) return ok(true);
    return err(KER.QUOTA_EXCEEDED, result.message ?? 'Quota exceeded', {
      details: {
        violated_level: result.violated_level,
        violated_quota: result.violated_quota,
      },
    });
  }

  // ─── Individual Level Checks ───────────────────────────────────────

  private checkAgentQuota(request: ResourceRequest, usage: AgentUsage): QuotaCheckResult {
    const quota = this.agentQuotas.get(request.requester);
    if (!quota) return { allowed: true }; // No quota set = unlimited

    // RU per hour
    if (quota.ru_per_hour > 0 && usage.ru_this_hour + request.ru > quota.ru_per_hour) {
      return {
        allowed: false,
        violated_level: 'agent',
        violated_quota: 'ru_per_hour',
        message: `Agent RU per hour quota exceeded: ${usage.ru_this_hour + request.ru} > ${quota.ru_per_hour}`,
      };
    }

    // MU max
    if (quota.mu_max > 0 && usage.mu_current + request.mu > quota.mu_max) {
      return {
        allowed: false,
        violated_level: 'agent',
        violated_quota: 'mu_max',
        message: `Agent MU max quota exceeded: ${usage.mu_current + request.mu} > ${quota.mu_max}`,
      };
    }

    // EU per hour
    if (quota.eu_per_hour > 0 && usage.eu_this_hour + request.eu > quota.eu_per_hour) {
      return {
        allowed: false,
        violated_level: 'agent',
        violated_quota: 'eu_per_hour',
        message: `Agent EU per hour quota exceeded: ${usage.eu_this_hour + request.eu} > ${quota.eu_per_hour}`,
      };
    }

    // VU per hour
    if (quota.vu_per_hour > 0 && usage.vu_this_hour + request.vu > quota.vu_per_hour) {
      return {
        allowed: false,
        violated_level: 'agent',
        violated_quota: 'vu_per_hour',
        message: `Agent VU per hour quota exceeded: ${usage.vu_this_hour + request.vu} > ${quota.vu_per_hour}`,
      };
    }

    // Total RU budget (-1 = unlimited)
    if (quota.total_ru_budget >= 0 && usage.ru_total + request.ru > quota.total_ru_budget) {
      return {
        allowed: false,
        violated_level: 'agent',
        violated_quota: 'total_ru_budget',
        message: `Agent total RU budget exceeded`,
      };
    }

    // Total EU budget (-1 = unlimited)
    if (quota.total_eu_budget >= 0 && usage.eu_total + request.eu > quota.total_eu_budget) {
      return {
        allowed: false,
        violated_level: 'agent',
        violated_quota: 'total_eu_budget',
        message: `Agent total EU budget exceeded`,
      };
    }

    return { allowed: true };
  }

  private checkWorkspaceQuota(request: ResourceRequest, usage: WorkspaceUsage): QuotaCheckResult {
    const quota = this.workspaceQuotas.get(request.workspace_id);
    if (!quota) return { allowed: true };

    // Total RU per hour
    if (quota.total_ru_per_hour > 0 && usage.ru_this_hour + request.ru > quota.total_ru_per_hour) {
      return {
        allowed: false,
        violated_level: 'workspace',
        violated_quota: 'total_ru_per_hour',
        message: `Workspace RU per hour quota exceeded`,
      };
    }

    // Total MU
    if (quota.total_mu > 0 && usage.mu_current + request.mu > quota.total_mu) {
      return {
        allowed: false,
        violated_level: 'workspace',
        violated_quota: 'total_mu',
        message: `Workspace MU quota exceeded`,
      };
    }

    // Total EU per hour
    if (quota.total_eu_per_hour > 0 && usage.eu_this_hour + request.eu > quota.total_eu_per_hour) {
      return {
        allowed: false,
        violated_level: 'workspace',
        violated_quota: 'total_eu_per_hour',
        message: `Workspace EU per hour quota exceeded`,
      };
    }

    // Total VU per hour
    if (quota.total_vu_per_hour > 0 && usage.vu_this_hour + request.vu > quota.total_vu_per_hour) {
      return {
        allowed: false,
        violated_level: 'workspace',
        violated_quota: 'total_vu_per_hour',
        message: `Workspace VU per hour quota exceeded`,
      };
    }

    return { allowed: true };
  }

  private checkUserQuota(request: ResourceRequest, usage: UserUsage): QuotaCheckResult {
    // Find user quota - iterate to find matching one for this workspace
    // In practice, the caller passes the correct user usage
    let quota: UserQuota | undefined;
    for (const [, q] of this.userQuotas) {
      quota = q;
      break;
    }
    if (!quota) return { allowed: true };

    // Total RU per day
    if (quota.total_ru_per_day > 0 && usage.ru_today + request.ru > quota.total_ru_per_day) {
      return {
        allowed: false,
        violated_level: 'user',
        violated_quota: 'total_ru_per_day',
        message: `User RU per day quota exceeded`,
      };
    }

    // Total EU per day
    if (quota.total_eu_per_day > 0 && usage.eu_today + request.eu > quota.total_eu_per_day) {
      return {
        allowed: false,
        violated_level: 'user',
        violated_quota: 'total_eu_per_day',
        message: `User EU per day quota exceeded`,
      };
    }

    return { allowed: true };
  }

  private checkEnterpriseQuota(request: ResourceRequest, usage: EnterpriseUsage): QuotaCheckResult {
    let quota: EnterpriseQuota | undefined;
    for (const [, q] of this.enterpriseQuotas) {
      quota = q;
      break;
    }
    if (!quota) return { allowed: true };

    // Total RU per month
    if (quota.total_ru_per_month > 0 && usage.ru_this_month + request.ru > quota.total_ru_per_month) {
      return {
        allowed: false,
        violated_level: 'enterprise',
        violated_quota: 'total_ru_per_month',
        message: `Enterprise RU per month quota exceeded`,
      };
    }

    // Total MU
    if (quota.total_mu > 0 && usage.mu_current + request.mu > quota.total_mu) {
      return {
        allowed: false,
        violated_level: 'enterprise',
        violated_quota: 'total_mu',
        message: `Enterprise MU quota exceeded`,
      };
    }

    // Total EU per month
    if (quota.total_eu_per_month > 0 && usage.eu_this_month + request.eu > quota.total_eu_per_month) {
      return {
        allowed: false,
        violated_level: 'enterprise',
        violated_quota: 'total_eu_per_month',
        message: `Enterprise EU per month quota exceeded`,
      };
    }

    // Total VU per month
    if (quota.total_vu_per_month > 0 && usage.vu_this_month + request.vu > quota.total_vu_per_month) {
      return {
        allowed: false,
        violated_level: 'enterprise',
        violated_quota: 'total_vu_per_month',
        message: `Enterprise VU per month quota exceeded`,
      };
    }

    // Check max priority
    if (request.priority > quota.max_priority) {
      return {
        allowed: false,
        violated_level: 'enterprise',
        violated_quota: 'max_priority',
        message: `Enterprise max priority exceeded: ${request.priority} > ${quota.max_priority}`,
      };
    }

    return { allowed: true };
  }

  // ─── Getters ────────────────────────────────────────────────────────

  getAgentQuota(agentId: string): AgentQuota | undefined {
    return this.agentQuotas.get(agentId);
  }

  getWorkspaceQuota(workspaceId: string): WorkspaceQuota | undefined {
    return this.workspaceQuotas.get(workspaceId);
  }
}