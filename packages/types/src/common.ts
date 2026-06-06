/**
 * AgentOS Common Types
 * Priority system, Result/Error unions, provenance, pagination
 */

import type { Duration, ISO8601 } from './temporal.js';
import type { AgentID } from './primitives.js';

// ─── Priority System ───────────────────────────────────────────────

/** Universal priority: 0-5 (kernel-api scale) */
export type Priority = 0 | 1 | 2 | 3 | 4 | 5;

export const PRIORITY_SYSTEM: Priority = 0;
export const PRIORITY_CRITICAL: Priority = 1;
export const PRIORITY_HIGH: Priority = 2;
export const PRIORITY_NORMAL: Priority = 3;
export const PRIORITY_LOW: Priority = 4;
export const PRIORITY_IDLE: Priority = 5;

/** ACP wire format priority: 0-4 */
export type ACPPriority = 0 | 1 | 2 | 3 | 4;

/** Task-specific priority: 1-5 (tasks cannot be SYSTEM) */
export type TaskPriority = 1 | 2 | 3 | 4 | 5;

export const TASK_PRIORITY_CRITICAL: TaskPriority = 1;
export const TASK_PRIORITY_HIGH: TaskPriority = 2;
export const TASK_PRIORITY_NORMAL: TaskPriority = 3;
export const TASK_PRIORITY_LOW: TaskPriority = 4;
export const TASK_PRIORITY_BACKGROUND: TaskPriority = 5;

// ─── Common Value Types ────────────────────────────────────────────

export type Tags = string[];
export type Metadata = Record<string, string>;

/** Source provenance for memory and results */
export interface Provenance {
  source_type: 'user' | 'agent' | 'external' | 'system' | 'memory';
  source_id: string;
  confidence: number; // 0.0 - 1.0
  timestamp: ISO8601;
}

// ─── Result/Error Union ─────────────────────────────────────────────

export interface Result<T> {
  ok: true;
  data: T;
}

export interface AgentError {
  ok: false;
  error_code: string; // e.g., KER-0001
  error_message: string;
  retryable: boolean;
  retry_after?: Duration;
  details?: unknown;
}

/** The universal outcome type — every operation returns this */
export type Outcome<T> = Result<T> | AgentError;

/** Helper to create a success result */
export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/** Helper to create an error result */
export function err(code: string, message: string, opts?: { retryable?: boolean; retry_after?: Duration; details?: unknown }): AgentError {
  return {
    ok: false,
    error_code: code,
    error_message: message,
    retryable: opts?.retryable ?? false,
    retry_after: opts?.retry_after,
    details: opts?.details,
  };
}

// ─── Pagination ─────────────────────────────────────────────────────

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}

// ─── Priority Conversion ────────────────────────────────────────────

/** Convert ACP priority (0-4) to kernel Priority (0-5). ACP 4 maps to IDLE(5). */
export function acpToPriority(p: ACPPriority): Priority {
  // ACP 0→0, 1→1, 2→2, 3→3, 4→5 (ACP has no IDLE distinction, 4=lowest)
  return p === 4 ? 5 : p;
}

/** Convert kernel Priority (0-5) to ACP priority (0-4). SYSTEM(0) maps to 0. */
export function priorityToAcp(p: Priority): ACPPriority {
  // Priority 5(IDLE)→4, everything else maps directly
  return p === 5 ? 4 : (p as ACPPriority);
}

/** Convert TaskPriority (1-5) to kernel Priority. Direct mapping. */
export function taskToPriority(tp: TaskPriority): Priority {
  return tp as Priority;
}

/** Convert kernel Priority to TaskPriority. Returns null for SYSTEM(0). */
export function priorityToTask(p: Priority): TaskPriority | null {
  if (p === 0) return null;
  return p as TaskPriority;
}