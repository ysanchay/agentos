/**
 * AgentOS Permission Types
 * PermissionScope, Permission interface — from kernel-api-v1.md Section 3.6
 */

import type { ISO8601 } from './temporal.js';
import type { PermissionID } from './primitives.js';

export enum PermissionScope {
  GLOBAL = 'global',
  ORGANIZATION = 'organization',
  PROJECT = 'project',
  WORKSPACE = 'workspace',
  TASK = 'task',
}

export interface Permission {
  id: PermissionID;
  name: string;
  scope: PermissionScope;
  grantee_id: string;
  grantee_type: 'agent' | 'user' | 'role';
  resource_type: string;
  resource_id?: string;
  actions: string[];
  conditions?: PermissionConditions;
  granted_by: string;
  expires_at?: ISO8601;
  created_at: ISO8601;
  revocable: boolean;
}

export interface PermissionConditions {
  time_restriction?: { start: string; end: string };
  ip_restriction?: string[];
  approval_required?: boolean;
  max_uses?: number;
}