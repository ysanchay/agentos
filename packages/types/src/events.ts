/**
 * AgentOS Event Types
 * EventDomain, Event interface — from kernel-api-v1.md Section 3.9
 */

import type { ISO8601 } from './temporal.js';
import type { EventID, WorkspaceID } from './primitives.js';

export enum EventDomain {
  AGENT = 'agent',
  TASK = 'task',
  WORKSPACE = 'workspace',
  PROJECT = 'project',
  CAPABILITY = 'capability',
  PERMISSION = 'permission',
  MEMORY = 'memory',
  RESOURCE = 'resource',
  APPROVAL = 'approval',
  SYSTEM = 'system',
  SECURITY = 'security',
}

/** Event — immutable record of every system action */
export interface Event {
  id: EventID;
  domain: EventDomain;
  type: string;
  source: string;
  target?: string;
  data: unknown;
  timestamp: ISO8601;
  correlation_id?: string;
  causation_id?: string;
  workspace_id?: WorkspaceID;
}