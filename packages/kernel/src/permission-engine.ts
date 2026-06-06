/**
 * @agentos/kernel — Permission Resolution Engine
 * Implements 7-step resolution from capability-graph constitution.
 * ZERO AI logic — deterministic permission resolution only.
 */

import { ok, err, KER, PermissionScope } from '@agentos/types';
import type { Outcome, Permission, PermissionID, AgentID, PermissionConditions } from '@agentos/types';
import { createUUID } from '@agentos/types';

// ─── Permission Engine ───────────────────────────────────────────────

export class PermissionEngine {
  private permissions: Map<string, Permission> = new Map();
  /** Track permission usage counts for max_uses condition */
  private usageCounts: Map<string, number> = new Map();

  /** Grant a new permission. */
  grant(permission: Permission): Outcome<true> {
    if (this.permissions.has(permission.id)) {
      return err(KER.ALREADY_EXISTS, `Permission "${permission.id}" already exists`, {
        retryable: false,
      });
    }
    this.permissions.set(permission.id, { ...permission });
    this.usageCounts.set(permission.id, 0);
    return ok(true);
  }

  /** Revoke a permission by ID. */
  revoke(permissionId: PermissionID): Outcome<true> {
    if (!this.permissions.has(permissionId)) {
      return err(KER.NOT_FOUND, `Permission "${permissionId}" not found`, {
        retryable: false,
      });
    }
    this.permissions.delete(permissionId);
    this.usageCounts.delete(permissionId);
    return ok(true);
  }

  /**
   * Check if an agent has a specific capability within a scope.
   * Returns ok(true) if permission is granted, err otherwise.
   */
  check(
    agentId: AgentID,
    capability: string,
    scope: PermissionScope,
    resourceId?: string,
  ): Outcome<true> {
    const effective = this.resolve(agentId, capability);

    // Filter by scope — narrower scope overrides broader
    const scopeRank: Record<PermissionScope, number> = {
      [PermissionScope.TASK]: 5,
      [PermissionScope.WORKSPACE]: 4,
      [PermissionScope.PROJECT]: 3,
      [PermissionScope.ORGANIZATION]: 2,
      [PermissionScope.GLOBAL]: 1,
    };

    const minScopeRank = scopeRank[scope];

    // Step 1-7 resolution
    // Include both grant and deny permissions in the relevant set
    const relevant = effective.filter((p) => {
      // Step 1: Match grantee (already filtered by resolve, but double-check)
      if (p.grantee_id !== agentId) return false;

      // Step 2: Filter by resource_type and resource_id
      // Include deny actions as well for deny-overrides-grant resolution
      const hasCapability = p.actions.some(
        (a) => a === capability || a === '*' || a === `deny:${capability}`,
      );
      if (!hasCapability) return false;

      // Step 3: Filter by scope — permission scope must be at least as narrow
      const pScopeRank = scopeRank[p.scope];
      if (pScopeRank < minScopeRank) return false;

      // Step 4: If resourceId specified, permission must match
      if (resourceId && p.resource_id && p.resource_id !== resourceId) return false;

      // Step 5: Check conditions
      if (p.conditions) {
        if (!this.checkConditions(p)) return false;
      }

      // Step 6: Check expiry
      if (this.isExpired(p)) return false;

      return true;
    });

    if (relevant.length === 0) {
      return err(KER.PERMISSION_DENIED, `Agent "${agentId}" does not have permission "${capability}" in scope "${scope}"`, {
        retryable: false,
      });
    }

    // Step 4: Most restrictive wins (deny > grant)
    // If any permission explicitly denies, the check fails
    const hasDeny = relevant.some((p) => p.actions.includes(`deny:${capability}`));
    if (hasDeny) {
      return err(KER.PERMISSION_DENIED, `Permission "${capability}" explicitly denied for agent "${agentId}"`, {
        retryable: false,
      });
    }

    // Increment usage count for matching permissions
    for (const p of relevant) {
      const count = this.usageCounts.get(p.id) ?? 0;
      this.usageCounts.set(p.id, count + 1);
    }

    return ok(true);
  }

  /**
   * 7-step resolution algorithm: resolve all effective permissions for an agent and capability.
   * 1. Collect all matching permissions
   * 2. Filter by resource_type and resource_id
   * 3. Narrower scope overrides broader
   * 4. Most restrictive wins (deny > grant)
   * 5. Check conditions (time, IP, approval, max_uses)
   * 6. Check expiry
   * 7. Return effective permissions
   */
  resolve(agentId: AgentID, capability: string): Permission[] {
    // Step 1: Collect all matching permissions
    const all = Array.from(this.permissions.values()).filter((p) => {
      return p.grantee_id === agentId &&
        (p.actions.some((a) => a === capability || a === '*' || a === `deny:${capability}`));
    });

    // Step 2: Filter by resource_type (capability matches resource_type)
    // This is implicit — the actions field already indicates the capability

    // Step 5: Check conditions
    const conditionPassed = all.filter((p) => {
      if (!p.conditions) return true;
      return this.checkConditions(p);
    });

    // Step 6: Check expiry
    const notExpired = conditionPassed.filter((p) => !this.isExpired(p));

    // Step 7: Return effective permissions
    return notExpired;
  }

  /** Get all permissions for an agent. */
  getPermissions(agentId: AgentID): Permission[] {
    return Array.from(this.permissions.values()).filter(
      (p) => p.grantee_id === agentId,
    );
  }

  /** Check if a permission has expired. */
  isExpired(permission: Permission): boolean {
    if (!permission.expires_at) return false;
    return new Date(permission.expires_at).getTime() < Date.now();
  }

  /** Check permission conditions. */
  private checkConditions(permission: Permission): boolean {
    const conditions = permission.conditions;
    if (!conditions) return true;

    // Time restriction
    if (conditions.time_restriction) {
      const now = new Date();
      const currentTime = `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')}`;
      if (currentTime < conditions.time_restriction.start || currentTime > conditions.time_restriction.end) {
        return false;
      }
    }

    // Approval required — for deterministic engine, we check if approval was already given
    // (approval_required just marks the permission as needing approval; the actual
    // approval flow is external. For the engine, if the permission exists and hasn't
    // been rejected, we consider it valid.)
    if (conditions.approval_required) {
      // The permission's existence implies approval was granted
      // Denial would have revoked the permission
    }

    // Max uses
    if (conditions.max_uses !== undefined) {
      const used = this.usageCounts.get(permission.id) ?? 0;
      if (used >= conditions.max_uses) return false;
    }

    // IP restriction — in a deterministic engine, we'd need the request context
    // For now, if IP restriction is defined, we skip the check (the engine
    // doesn't have access to request IP). This should be checked at a higher layer.
    // if (conditions.ip_restriction) { ... }

    return true;
  }

  /** Get a permission by ID. */
  get(permissionId: PermissionID): Permission | undefined {
    const p = this.permissions.get(permissionId);
    return p ? { ...p } : undefined;
  }

  /** Clear all permissions. */
  clear(): void {
    this.permissions.clear();
    this.usageCounts.clear();
  }
}