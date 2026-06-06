/**
 * Tests for @agentos/eventstore — Audit Chain
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuditChain } from '../src/audit-chain.js';
import { EventDomain } from '@agentos/types';
import type { Event, EventID } from '@agentos/types';
import { asUUID } from '@agentos/types';

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: asUUID<EventID>(crypto.randomUUID()),
    domain: EventDomain.TASK,
    type: 'task.created',
    source: 'agent-1',
    data: { name: 'Test Task' },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ─── TestableAuditChain for coverage of error paths ───────────────────
// We extend AuditChain to expose internal mutation for testing tamper detection.

interface ChainEntry {
  sequence: number;
  event: Event;
  prev_hash: string;
  hash: string;
}

class TestableAuditChain extends AuditChain {
  // Access internal chain via bracket notation to reach private field
  // We use a different approach: expose a tamper method
  public tamperEntry(sequence: number, mutation: (entry: ChainEntry) => void): void {
    // @ts-expect-error accessing private field for test purposes
    const chain: ChainEntry[] = this.chain;
    if (sequence >= 0 && sequence < chain.length) {
      mutation(chain[sequence]!);
    }
  }

  public getChainLength(): number {
    // @ts-expect-error accessing private field for test purposes
    return this.chain.length as number;
  }
}

describe('AuditChain', () => {
  let chain: AuditChain;

  beforeEach(() => {
    chain = new AuditChain();
  });

  describe('append', () => {
    it('should return a SHA-256 hash (64 hex chars)', () => {
      const hash = chain.append(makeEvent());
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should increment chain length on each append', () => {
      expect(chain.length).toBe(0);
      chain.append(makeEvent());
      expect(chain.length).toBe(1);
      chain.append(makeEvent());
      expect(chain.length).toBe(2);
    });

    it('should produce different hashes for different events', () => {
      const hash1 = chain.append(makeEvent({ type: 'task.created' }));
      const hash2 = chain.append(makeEvent({ type: 'task.completed' }));
      expect(hash1).not.toBe(hash2);
    });

    it('should produce deterministic hashes for the same event', () => {
      const event = makeEvent({ type: 'task.created', timestamp: '2026-01-01T00:00:00Z' });
      const chain1 = new AuditChain();
      const chain2 = new AuditChain();
      const hash1 = chain1.append(event);
      const hash2 = chain2.append(event);
      expect(hash1).toBe(hash2);
    });
  });

  describe('verify', () => {
    it('should verify an empty chain as valid', () => {
      const result = chain.verify();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBe(true);
    });

    it('should verify a valid single-entry chain', () => {
      chain.append(makeEvent());
      const result = chain.verify();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBe(true);
    });

    it('should verify a valid multi-entry chain', () => {
      chain.append(makeEvent({ type: 'task.created' }));
      chain.append(makeEvent({ type: 'task.updated' }));
      chain.append(makeEvent({ type: 'task.completed' }));
      const result = chain.verify();
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBe(true);
    });
  });

  describe('verifyFrom', () => {
    beforeEach(() => {
      chain.append(makeEvent({ type: 'task.created' }));
      chain.append(makeEvent({ type: 'task.updated' }));
      chain.append(makeEvent({ type: 'task.completed' }));
    });

    it('should verify from sequence 0 (equivalent to full verify)', () => {
      const result = chain.verifyFrom(0);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBe(true);
    });

    it('should verify from a specific sequence', () => {
      const result = chain.verifyFrom(1);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBe(true);
    });

    it('should return error for out-of-range sequence', () => {
      const result = chain.verifyFrom(10);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('CHAIN-0005');
      }
    });

    it('should return error for negative sequence', () => {
      const result = chain.verifyFrom(-1);
      expect(result.ok).toBe(false);
    });
  });

  describe('getHash', () => {
    it('should return the hash at a given sequence', () => {
      const hash0 = chain.append(makeEvent());
      const hash1 = chain.append(makeEvent());

      expect(chain.getHash(0)).toBe(hash0);
      expect(chain.getHash(1)).toBe(hash1);
    });

    it('should throw for out-of-range sequence', () => {
      chain.append(makeEvent());
      expect(() => chain.getHash(5)).toThrow();
      expect(() => chain.getHash(-1)).toThrow();
    });
  });

  describe('lastHash', () => {
    it('should return genesis hash for empty chain', () => {
      expect(chain.lastHash).toBe('0'.repeat(64));
    });

    it('should return the most recent hash', () => {
      const lastHash = chain.append(makeEvent());
      expect(chain.lastHash).toBe(lastHash);

      const newerHash = chain.append(makeEvent());
      expect(chain.lastHash).toBe(newerHash);
    });
  });

  describe('chain integrity', () => {
    it('each entry should reference the previous hash', () => {
      const hash0 = chain.append(makeEvent({ type: 'a' }));
      const hash1 = chain.append(makeEvent({ type: 'b' }));

      // hash1 should be derived from hash0
      expect(hash0).not.toBe(hash1);

      // Verification should pass
      const result = chain.verify();
      expect(result.ok).toBe(true);
    });

    it('should produce different hashes when event order changes', () => {
      const chainA = new AuditChain();
      const chainB = new AuditChain();

      const event1 = makeEvent({ type: 'task.created', timestamp: '2026-01-01T00:00:00Z' });
      const event2 = makeEvent({ type: 'task.completed', timestamp: '2026-01-02T00:00:00Z' });

      chainA.append(event1);
      const hashA1 = chainA.append(event2);

      chainB.append(event2);
      const hashB1 = chainB.append(event1);

      // Different order produces different hashes
      expect(hashA1).not.toBe(hashB1);
    });
  });

  describe('tamper detection', () => {
    it('should detect modified event data (hash mismatch at entry 0)', () => {
      const testChain = new TestableAuditChain();
      testChain.append(makeEvent({ type: 'task.created' }));

      // Tamper with the event data but leave the hash unchanged
      testChain.tamperEntry(0, (entry) => {
        entry.event = makeEvent({ type: 'task.TAMPERED' });
      });

      const result = testChain.verify();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('CHAIN-0002');
      }
    });

    it('should detect modified event data at later sequence', () => {
      const testChain = new TestableAuditChain();
      testChain.append(makeEvent({ type: 'task.created' }));
      testChain.append(makeEvent({ type: 'task.updated' }));
      testChain.append(makeEvent({ type: 'task.completed' }));

      // Tamper with entry at index 2
      testChain.tamperEntry(2, (entry) => {
        entry.event = makeEvent({ type: 'task.TAMPERED' });
      });

      const result = testChain.verify();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('CHAIN-0004');
      }
    });

    it('should detect broken prev_hash link', () => {
      const testChain = new TestableAuditChain();
      testChain.append(makeEvent({ type: 'task.created' }));
      testChain.append(makeEvent({ type: 'task.updated' }));

      // Tamper with prev_hash of entry 1
      testChain.tamperEntry(1, (entry) => {
        entry.prev_hash = '0'.repeat(64); // Wrong prev_hash
      });

      const result = testChain.verify();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('CHAIN-0003');
      }
    });

    it('should detect tampered genesis link', () => {
      const testChain = new TestableAuditChain();
      testChain.append(makeEvent({ type: 'task.created' }));

      // Tamper with genesis prev_hash
      testChain.tamperEntry(0, (entry) => {
        entry.prev_hash = 'ff'.repeat(32); // Wrong genesis hash
      });

      const result = testChain.verify();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('CHAIN-0001');
      }
    });

    it('verifyFrom should detect broken anchor link', () => {
      const testChain = new TestableAuditChain();
      testChain.append(makeEvent({ type: 'task.created' }));
      testChain.append(makeEvent({ type: 'task.updated' }));
      testChain.append(makeEvent({ type: 'task.completed' }));

      // Tamper with prev_hash of entry at index 1 (breaking anchor for verifyFrom(1))
      testChain.tamperEntry(1, (entry) => {
        entry.prev_hash = 'aa'.repeat(32); // Wrong anchor link
      });

      const result = testChain.verifyFrom(1);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('CHAIN-0006');
      }
    });

    it('verifyFrom should detect broken link between subsequent entries', () => {
      const testChain = new TestableAuditChain();
      testChain.append(makeEvent({ type: 'task.created' }));
      testChain.append(makeEvent({ type: 'task.updated' }));
      testChain.append(makeEvent({ type: 'task.completed' }));

      // Tamper with prev_hash of entry at index 2 (breaking link with entry 1)
      testChain.tamperEntry(2, (entry) => {
        entry.prev_hash = 'bb'.repeat(32); // Wrong link
      });

      const result = testChain.verifyFrom(1);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('CHAIN-0007');
      }
    });

    it('verifyFrom should detect hash mismatch at entry after anchor', () => {
      const testChain = new TestableAuditChain();
      testChain.append(makeEvent({ type: 'task.created' }));
      testChain.append(makeEvent({ type: 'task.updated' }));

      // Tamper with the hash of entry at index 1 (make hash wrong but keep prev_hash correct)
      testChain.tamperEntry(1, (entry) => {
        entry.hash = 'cc'.repeat(32); // Wrong hash
      });

      const result = testChain.verifyFrom(1);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('CHAIN-0008');
      }
    });
  });
});