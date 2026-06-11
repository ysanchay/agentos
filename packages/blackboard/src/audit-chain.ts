/**
 * @agentos/blackboard — Audit Chain
 * SHA-256 hash chain for tamper-evident blackboard audit trail.
 * Every write to the blackboard creates an append-only audit entry.
 * Each entry includes the SHA-256 hash of the previous entry.
 * From blackboard-protocol Article XVII.
 */

import { createHash } from 'node:crypto';
import type { AgentID, Outcome } from '@agentos/types';
import { ok, err } from '@agentos/types';

// ─── Audit Entry ──────────────────────────────────────────────────────

export interface AuditEntry {
  sequence: number;
  timestamp: string;
  agent_id: AgentID;
  action: string;
  target: string;
  previous_value: unknown;
  new_value: unknown;
  prev_hash: string;
  hash: string;
}

// ─── AuditChain ──────────────────────────────────────────────────────

const GENESIS_HASH = '0'.repeat(64);

export class AuditChain {
  private chain: AuditEntry[] = [];
  private sequence: number = 0;

  /**
   * Append an audit entry to the chain.
   * Returns the new entry's hash.
   */
  append(params: {
    agent_id: AgentID;
    action: string;
    target: string;
    previous_value: unknown;
    new_value: unknown;
  }): string {
    const prevHash = this.chain.length > 0
      ? this.chain[this.chain.length - 1]!.hash
      : GENESIS_HASH;

    const timestamp = new Date().toISOString();
    const entry: AuditEntry = {
      sequence: this.sequence,
      timestamp,
      agent_id: params.agent_id,
      action: params.action,
      target: params.target,
      previous_value: params.previous_value,
      new_value: params.new_value,
      prev_hash: prevHash,
      hash: '',
    };

    // Compute hash of this entry (excluding the hash field itself)
    entry.hash = this.computeHash(prevHash, entry);

    this.chain.push(entry);
    this.sequence++;

    return entry.hash;
  }

  /**
   * Verify the entire chain integrity.
   * Returns true if all links are valid, or an error describing the break.
   */
  verify(): Outcome<boolean> {
    if (this.chain.length === 0) {
      return ok(true);
    }

    // First entry must link to genesis
    const first = this.chain[0]!;
    if (first.prev_hash !== GENESIS_HASH) {
      return err('BB-AUDIT-001', 'Genesis hash mismatch: first entry does not link to genesis', {
        retryable: false,
      });
    }

    const firstExpected = this.computeHash(GENESIS_HASH, first);
    if (first.hash !== firstExpected) {
      return err('BB-AUDIT-002', 'Hash mismatch at sequence 0', {
        retryable: false,
        details: { expected: firstExpected, actual: first.hash },
      });
    }

    // Verify every subsequent link
    for (let i = 1; i < this.chain.length; i++) {
      const prev = this.chain[i - 1]!;
      const current = this.chain[i]!;

      if (current.prev_hash !== prev.hash) {
        return err('BB-AUDIT-003', `Chain link broken at sequence ${current.sequence}: prev_hash does not match previous hash`, {
          retryable: false,
          details: {
            sequence: current.sequence,
            expected_prev_hash: prev.hash,
            actual_prev_hash: current.prev_hash,
          },
        });
      }

      const expectedHash = this.computeHash(prev.hash, current);
      if (current.hash !== expectedHash) {
        return err('BB-AUDIT-004', `Hash mismatch at sequence ${current.sequence}`, {
          retryable: false,
          details: { expected: expectedHash, actual: current.hash },
        });
      }
    }

    return ok(true);
  }

  /** Get all audit entries */
  getEntries(): AuditEntry[] {
    return [...this.chain];
  }

  /** Get the last N audit entries */
  getRecent(limit: number): AuditEntry[] {
    return this.chain.slice(-limit);
  }

  /** Get the current chain length */
  get length(): number {
    return this.chain.length;
  }

  /** Get the last hash in the chain (or genesis hash if empty) */
  get lastHash(): string {
    if (this.chain.length === 0) return GENESIS_HASH;
    return this.chain[this.chain.length - 1]!.hash;
  }

  // ─── Private ──────────────────────────────────────────────────────

  /**
   * Compute SHA-256 hash of prev_hash + canonical entry data.
   */
  private computeHash(prevHash: string, entry: AuditEntry): string {
    // Canonical JSON serialization for deterministic hashing
    const canonical = JSON.stringify({
      sequence: entry.sequence,
      timestamp: entry.timestamp,
      agent_id: entry.agent_id,
      action: entry.action,
      target: entry.target,
      previous_value: entry.previous_value,
      new_value: entry.new_value,
    });

    const input = `${prevHash}:${canonical}`;
    return createHash('sha256').update(input).digest('hex');
  }
}