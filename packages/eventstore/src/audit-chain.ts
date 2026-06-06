/**
 * @agentos/eventstore — Audit Chain
 * SHA-256 hash chain for tamper-evident audit trail.
 * Each chain entry links to the previous via hash, forming an immutable ledger.
 */

import type { Event, Outcome } from '@agentos/types';
import { ok, err } from '@agentos/types';

// ─── Chain Entry ─────────────────────────────────────────────────────

interface ChainEntry {
  sequence: number;
  event: Event;
  prev_hash: string;
  hash: string;
}

// ─── AuditChain ──────────────────────────────────────────────────────

const GENESIS_HASH = '0'.repeat(64); // 64 hex chars = 256 bits of zero

export class AuditChain {
  private chain: ChainEntry[] = [];
  private sequence: number = 0;

  /** Append an event to the chain, returns the hash of this entry */
  append(event: Event): string {
    const prevHash = this.chain.length > 0
      ? this.chain[this.chain.length - 1]!.hash
      : GENESIS_HASH;

    const hash = this.computeHash(prevHash, event);

    const entry: ChainEntry = {
      sequence: this.sequence,
      event,
      prev_hash: prevHash,
      hash,
    };

    this.chain.push(entry);
    this.sequence++;

    return hash;
  }

  /** Verify entire chain integrity — returns true if all links are valid */
  verify(): Outcome<boolean> {
    if (this.chain.length === 0) {
      return ok(true);
    }

    // First entry should chain from genesis
    const first = this.chain[0]!;
    if (first.prev_hash !== GENESIS_HASH) {
      return err('CHAIN-0001', 'Genesis hash mismatch: first entry does not link to genesis', {
        retryable: false,
      });
    }

    const firstExpected = this.computeHash(GENESIS_HASH, first.event);
    if (first.hash !== firstExpected) {
      return err('CHAIN-0002', `Hash mismatch at sequence 0`, {
        retryable: false,
        details: { expected: firstExpected, actual: first.hash },
      });
    }

    // Verify every subsequent link
    for (let i = 1; i < this.chain.length; i++) {
      const prev = this.chain[i - 1]!;
      const current = this.chain[i]!;

      // prev_hash must point to previous entry's hash
      if (current.prev_hash !== prev.hash) {
        return err('CHAIN-0003', `Chain link broken at sequence ${current.sequence}: prev_hash does not match previous hash`, {
          retryable: false,
          details: {
            sequence: current.sequence,
            expected_prev_hash: prev.hash,
            actual_prev_hash: current.prev_hash,
          },
        });
      }

      // Recompute hash and verify
      const expectedHash = this.computeHash(prev.hash, current.event);
      if (current.hash !== expectedHash) {
        return err('CHAIN-0004', `Hash mismatch at sequence ${current.sequence}`, {
          retryable: false,
          details: { expected: expectedHash, actual: current.hash },
        });
      }
    }

    return ok(true);
  }

  /** Verify chain integrity from a specific sequence number */
  verifyFrom(fromSequence: number): Outcome<boolean> {
    if (fromSequence < 0 || fromSequence >= this.chain.length) {
      return err('CHAIN-0005', `Invalid sequence ${fromSequence}: must be between 0 and ${this.chain.length - 1}`, {
        retryable: false,
      });
    }

    // If starting from 0, just do full verify
    if (fromSequence === 0) {
      return this.verify();
    }

    // Get the anchor point: the entry just before fromSequence
    const anchor = this.chain[fromSequence - 1]!;
    const anchorHash = anchor.hash;

    for (let i = fromSequence; i < this.chain.length; i++) {
      const current = this.chain[i]!;

      if (i === fromSequence) {
        // First entry being verified must link to anchor
        if (current.prev_hash !== anchorHash) {
          return err('CHAIN-0006', `Chain link broken at sequence ${current.sequence}: prev_hash does not match anchor`, {
            retryable: false,
            details: {
              sequence: current.sequence,
              expected_prev_hash: anchorHash,
              actual_prev_hash: current.prev_hash,
            },
          });
        }
      } else {
        // Subsequent entries must link to previous
        const prev = this.chain[i - 1]!;
        if (current.prev_hash !== prev.hash) {
          return err('CHAIN-0007', `Chain link broken at sequence ${current.sequence}`, {
            retryable: false,
          });
        }
      }

      // Recompute and verify hash
      const prevHash = current.prev_hash;
      const expectedHash = this.computeHash(prevHash, current.event);
      if (current.hash !== expectedHash) {
        return err('CHAIN-0008', `Hash mismatch at sequence ${current.sequence}`, {
          retryable: false,
          details: { expected: expectedHash, actual: current.hash },
        });
      }
    }

    return ok(true);
  }

  /** Get the hash at a specific sequence number */
  getHash(sequence: number): string {
    if (sequence < 0 || sequence >= this.chain.length) {
      throw new Error(`Sequence ${sequence} out of range (0-${this.chain.length - 1})`);
    }
    return this.chain[sequence]!.hash;
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
   * Compute SHA-256 hash of prev_hash + event data.
   * Uses the SubtleCrypto API for cross-platform compatibility.
   */
  private computeHash(prevHash: string, event: Event): string {
    // Canonical JSON serialization of event for deterministic hashing
    const eventJson = JSON.stringify({
      id: event.id,
      domain: event.domain,
      type: event.type,
      source: event.source,
      target: event.target ?? null,
      data: event.data,
      timestamp: event.timestamp,
      correlation_id: event.correlation_id ?? null,
      causation_id: event.causation_id ?? null,
      workspace_id: event.workspace_id ?? null,
    });

    const input = `${prevHash}:${eventJson}`;

    // Synchronous SHA-256 using Node.js crypto when available,
    // falling back to SubtleCrypto. For the in-memory store we
    // use a synchronous hash for simplicity.
    return sha256Sync(input);
  }
}

// ─── Synchronous SHA-256 ─────────────────────────────────────────────

import { createHash } from 'node:crypto';

function sha256Sync(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}