/**
 * AgentOS Memory Types
 * MemoryTier, MemoryType, MemoryEntry, MemoryRelation — from kernel-api-v1.md Section 3.7
 */

import type { ISO8601 } from './temporal.js';
import type { AgentID, MemoryID, WorkspaceID } from './primitives.js';
import type { Tags } from './common.js';

export enum MemoryTier {
  L0 = 'l0_hot',
  L1 = 'l1_working',
  L2 = 'l2_persistent',
  L3 = 'l3_archival',
}

export enum MemoryType {
  FACT = 'fact',
  CONTEXT = 'context',
  DECISION = 'decision',
  OBSERVATION = 'observation',
  INSTRUCTION = 'instruction',
  RELATIONSHIP = 'relationship',
  RESULT = 'result',
  FEEDBACK = 'feedback',
}

export interface MemoryEntry {
  id: MemoryID;
  type: MemoryType;
  tier: MemoryTier;
  content: unknown;
  summary?: string;
  workspace_id: WorkspaceID;
  source_agent_id: AgentID;
  source_type: 'user' | 'agent' | 'external' | 'system';
  confidence: number; // 0.0 - 1.0
  tags: Tags;
  embeddings?: number[];
  relations: MemoryRelation[];
  access_count: number;
  last_accessed_at: ISO8601;
  expires_at?: ISO8601;
  version: number;
  previous_version_id?: MemoryID;
  created_at: ISO8601;
  updated_at: ISO8601;
}

export interface MemoryRelation {
  target_id: MemoryID;
  relation_type: 'causes' | 'relates_to' | 'contradicts' | 'depends_on' | 'extends' | 'supersedes';
  confidence: number;
}