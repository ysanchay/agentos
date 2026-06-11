/**
 * @agentos/blackboard — AuditChain Tests
 * Full coverage of append, verify, getEntries, getRecent, lastHash
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuditChain } from '../src/audit-chain.js';
import { createUUID } from '@agentos/types';
import type { AgentID } from '@agentos/types';

describe('AuditChain', () => {
  let chain: AuditChain;

  beforeEach(() => {
    chain = new AuditChain();
  });

  // ─── append ───────────────────────────────────────────────────────

  describe('append', () => {
    it('should append an entry and return its hash', () => {
      const agentId = createUUID() as unknown as AgentID;
      const hash = chain.append({
        agent_id: agentId,
        action: 'publish',
        target: 'task-1',
        previous_value: null,
        new_value: { title: 'Test Task' },
      });

      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA-256 hex digest
    });

    it('should use genesis hash for the first entry', () => {
      const agentId = createUUID() as unknown as AgentID;
      chain.append({
        agent_id: agentId,
        action: 'create',
        target: 'workspace-1',
        previous_value: null,
        new_value: { name: 'test' },
      });

      const entries = chain.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0]!.prev_hash).toBe('0'.repeat(64));
    });

    it('should link entries via prev_hash', () => {
      const agentId = createUUID() as unknown as AgentID;

      const hash1 = chain.append({
        agent_id: agentId,
        action: 'create',
        target: 'task-1',
        previous_value: null,
        new_value: { title: 'Task 1' },
      });

      const hash2 = chain.append({
        agent_id: agentId,
        action: 'claim',
        target: 'task-1',
        previous_value: { state: 'announced' },
        new_value: { state: 'claimed' },
      });

      const entries = chain.getEntries();
      expect(entries[1]!.prev_hash).toBe(hash1);
      expect(entries[1]!.hash).toBe(hash2);
    });

    it('should increment sequence numbers', () => {
      const agentId = createUUID() as unknown as AgentID;
      chain.append({
        agent_id: agentId,
        action: 'create',
        target: 'task-1',
        previous_value: null,
        new_value: {},
      });
      chain.append({
        agent_id: agentId,
        action: 'claim',
        target: 'task-1',
        previous_value: null,
        new_value: {},
      });
      chain.append({
        agent_id: agentId,
        action: 'release',
        target: 'task-1',
        previous_value: null,
        new_value: {},
      });

      const entries = chain.getEntries();
      expect(entries[0]!.sequence).toBe(0);
      expect(entries[1]!.sequence).toBe(1);
      expect(entries[2]!.sequence).toBe(2);
    });

    it('should store all entry fields correctly', () => {
      const agentId = createUUID() as unknown as AgentID;
      chain.append({
        agent_id: agentId,
        action: 'update',
        target: 'task-42',
        previous_value: { status: 'draft' },
        new_value: { status: 'announced' },
      });

      const entry = chain.getEntries()[0]!;
      expect(entry.agent_id).toBe(agentId);
      expect(entry.action).toBe('update');
      expect(entry.target).toBe('task-42');
      expect(entry.previous_value).toEqual({ status: 'draft' });
      expect(entry.new_value).toEqual({ status: 'announced' });
      expect(entry.timestamp).toBeTruthy();
    });

    it('should handle entries with null previous_value', () => {
      const agentId = createUUID() as unknown as AgentID;
      const hash = chain.append({
        agent_id: agentId,
        action: 'create',
        target: 'task-1',
        previous_value: null,
        new_value: { title: 'New' },
      });

      expect(hash).toBeTruthy();
      const entry = chain.getEntries()[0]!;
      expect(entry.previous_value).toBeNull();
    });

    it('should produce different hashes for different entries', () => {
      const agentId = createUUID() as unknown as AgentID;
      const hash1 = chain.append({
        agent_id: agentId,
        action: 'create',
        target: 'task-1',
        previous_value: null,
        new_value: { title: 'Task 1' },
      });
      const hash2 = chain.append({
        agent_id: agentId,
        action: 'create',
        target: 'task-2',
        previous_value: null,
        new_value: { title: 'Task 2' },
      });

      expect(hash1).not.toBe(hash2);
    });
  });

  // ─── verify ───────────────────────────────────────────────────────

  describe('verify', () => {
    it('should verify an empty chain', () => {
      const result = chain.verify();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(true);
      }
    });

    it('should verify a valid single-entry chain', () => {
      const agentId = createUUID() as unknown as AgentID;
      chain.append({
        agent_id: agentId,
        action: 'create',
        target: 'task-1',
        previous_value: null,
        new_value: {},
      });

      const result = chain.verify();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(true);
      }
    });

    it('should verify a valid multi-entry chain', () => {
      const agentId = createUUID() as unknown as AgentID;
      for (let i = 0; i < 10; i++) {
        chain.append({
          agent_id: agentId,
          action: 'update',
          target: `task-${i}`,
          previous_value: { i },
          new_value: { i: i + 1 },
        });
      }

      const result = chain.verify();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(true);
      }
    });

    it('should detect broken genesis hash', () => {
      const agentId = createUUID() as unknown as AgentID;
      chain.append({
        agent_id: agentId,
        action: 'create',
        target: 'task-1',
        previous_value: null,
        new_value: {},
      });

      // Tamper with the genesis hash link
      const entries = chain.getEntries();
      (entries[0] as any).prev_hash = '1'.repeat(64);

      const result = chain.verify();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('BB-AUDIT-001');
        expect(result.error_message).toContain('Genesis hash mismatch');
      }
    });

    it('should detect broken chain link (prev_hash mismatch)', () => {
      const agentId = createUUID() as unknown as AgentID;
      chain.append({
        agent_id: agentId,
        action: 'create',
        target: 'task-1',
        previous_value: null,
        new_value: {},
      });
      chain.append({
        agent_id: agentId,
        action: 'claim',
        target: 'task-1',
        previous_value: null,
        new_value: {},
      });

      // Tamper with the prev_hash of the second entry
      const entries = chain.getEntries();
      (entries[1] as any).prev_hash = 'X'.repeat(64);

      const result = chain.verify();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('BB-AUDIT-003');
        expect(result.error_message).toContain('Chain link broken');
      }
    });

    it('should detect tampered entry data (hash mismatch)', () => {
      const agentId = createUUID() as unknown as AgentID;
      chain.append({
        agent_id: agentId,
        action: 'create',
        target: 'task-1',
        previous_value: null,
        new_value: { important: 'data' },
      });

      // Tamper with the entry's action
      const entries = chain.getEntries();
      (entries[0] as any).action = 'DELETE'; // modified!

      const result = chain.verify();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('BB-AUDIT-002');
        expect(result.error_message).toContain('Hash mismatch');
      }
    });

    it('should detect tampered middle entry in multi-entry chain', () => {
      const agentId = createUUID() as unknown as AgentID;
      for (let i = 0; i < 5; i++) {
        chain.append({
          agent_id: agentId,
          action: 'update',
          target: `task-${i}`,
          previous_value: null,
          new_value: { value: i },
        });
      }

      // Tamper with entry 2's data
      const entries = chain.getEntries();
      (entries[2] as any).new_value = { tampered: true };

      const result = chain.verify();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // The tampered entry itself should fail hash verification
        expect(result.error_code).toBe('BB-AUDIT-004');
      }
    });
  });

  // ─── getEntries ────────────────────────────────────────────────────

  describe('getEntries', () => {
    it('should return all entries in the chain', () => {
      const agentId = createUUID() as unknown as AgentID;
      for (let i = 0; i < 5; i++) {
        chain.append({
          agent_id: agentId,
          action: 'step',
          target: `task-${i}`,
          previous_value: null,
          new_value: {},
        });
      }

      const entries = chain.getEntries();
      expect(entries.length).toBe(5);
    });

    it('should return a copy of entries (not mutable)', () => {
      const agentId = createUUID() as unknown as AgentID;
      chain.append({
        agent_id: agentId,
        action: 'create',
        target: 'task-1',
        previous_value: null,
        new_value: {},
      });

      const entries = chain.getEntries();
      expect(entries.length).toBe(1);

      // Modifying the returned array should not affect the chain
      entries.push(entries[0]!);
      expect(chain.getEntries().length).toBe(1);
    });

    it('should return empty array for empty chain', () => {
      expect(chain.getEntries()).toEqual([]);
    });
  });

  // ─── getRecent ─────────────────────────────────────────────────────

  describe('getRecent', () => {
    it('should return the last N entries', () => {
      const agentId = createUUID() as unknown as AgentID;
      for (let i = 0; i < 10; i++) {
        chain.append({
          agent_id: agentId,
          action: 'step',
          target: `task-${i}`,
          previous_value: null,
          new_value: {},
        });
      }

      const recent = chain.getRecent(3);
      expect(recent.length).toBe(3);
      expect(recent[0]!.sequence).toBe(7);
      expect(recent[1]!.sequence).toBe(8);
      expect(recent[2]!.sequence).toBe(9);
    });

    it('should return all entries if limit exceeds chain length', () => {
      const agentId = createUUID() as unknown as AgentID;
      chain.append({
        agent_id: agentId,
        action: 'create',
        target: 'task-1',
        previous_value: null,
        new_value: {},
      });

      const recent = chain.getRecent(100);
      expect(recent.length).toBe(1);
    });

    it('should return empty array for empty chain', () => {
      expect(chain.getRecent(5)).toEqual([]);
    });

    it('should return last entry with limit 1', () => {
      const agentId = createUUID() as unknown as AgentID;
      chain.append({
        agent_id: agentId,
        action: 'first',
        target: 'task-1',
        previous_value: null,
        new_value: {},
      });
      chain.append({
        agent_id: agentId,
        action: 'second',
        target: 'task-2',
        previous_value: null,
        new_value: {},
      });

      const recent = chain.getRecent(1);
      expect(recent.length).toBe(1);
      expect(recent[0]!.action).toBe('second');
    });
  });

  // ─── lastHash ─────────────────────────────────────────────────────

  describe('lastHash', () => {
    it('should return genesis hash for empty chain', () => {
      expect(chain.lastHash).toBe('0'.repeat(64));
    });

    it('should return the hash of the last entry', () => {
      const agentId = createUUID() as unknown as AgentID;
      const hash1 = chain.append({
        agent_id: agentId,
        action: 'create',
        target: 'task-1',
        previous_value: null,
        new_value: {},
      });

      expect(chain.lastHash).toBe(hash1);

      const hash2 = chain.append({
        agent_id: agentId,
        action: 'update',
        target: 'task-1',
        previous_value: null,
        new_value: {},
      });

      expect(chain.lastHash).toBe(hash2);
      expect(chain.lastHash).not.toBe(hash1);
    });

    it('should update after each append', () => {
      const agentId = createUUID() as unknown as AgentID;
      const hashes: string[] = [];

      for (let i = 0; i < 5; i++) {
        const hash = chain.append({
          agent_id: agentId,
          action: 'step',
          target: `task-${i}`,
          previous_value: null,
          new_value: {},
        });
        hashes.push(hash);
        expect(chain.lastHash).toBe(hash);
      }

      // All hashes should be unique
      expect(new Set(hashes).size).toBe(5);
    });
  });

  // ─── length ───────────────────────────────────────────────────────

  describe('length', () => {
    it('should return 0 for empty chain', () => {
      expect(chain.length).toBe(0);
    });

    it('should return the number of entries', () => {
      const agentId = createUUID() as unknown as AgentID;
      for (let i = 0; i < 7; i++) {
        chain.append({
          agent_id: agentId,
          action: 'step',
          target: `task-${i}`,
          previous_value: null,
          new_value: {},
        });
      }

      expect(chain.length).toBe(7);
    });
  });

  // ─── Integration: append + verify ──────────────────────────────────

  describe('integration', () => {
    it('should maintain chain integrity across many appends', () => {
      const agentId = createUUID() as unknown as AgentID;
      const actions = ['create', 'claim', 'update', 'release', 'complete'];

      for (let i = 0; i < 100; i++) {
        chain.append({
          agent_id: agentId,
          action: actions[i % actions.length]!,
          target: `task-${i}`,
          previous_value: { step: i - 1 },
          new_value: { step: i },
        });
      }

      expect(chain.length).toBe(100);
      expect(chain.verify().ok).toBe(true);

      const recent = chain.getRecent(5);
      expect(recent.length).toBe(5);
      expect(recent[4]!.sequence).toBe(99);
    });

    it('should detect tampering in the middle of a long chain', () => {
      const agentId = createUUID() as unknown as AgentID;
      for (let i = 0; i < 20; i++) {
        chain.append({
          agent_id: agentId,
          action: 'update',
          target: `task-${i}`,
          previous_value: null,
          new_value: { data: i },
        });
      }

      // Verify before tampering
      expect(chain.verify().ok).toBe(true);

      // Tamper with entry 10
      const entries = chain.getEntries();
      (entries[10] as any).new_value = { hacked: true };

      // Verify should fail
      expect(chain.verify().ok).toBe(false);
    });

    it('should handle entries with complex values', () => {
      const agentId = createUUID() as unknown as AgentID;
      chain.append({
        agent_id: agentId,
        action: 'update',
        target: 'task-complex',
        previous_value: { nested: { deep: [1, 2, 3] } },
        new_value: { nested: { deep: [4, 5, 6] }, extra: true },
      });

      expect(chain.verify().ok).toBe(true);

      const entry = chain.getEntries()[0]!;
      expect(entry.previous_value).toEqual({ nested: { deep: [1, 2, 3] } });
      expect(entry.new_value).toEqual({ nested: { deep: [4, 5, 6] }, extra: true });
    });
  });
});