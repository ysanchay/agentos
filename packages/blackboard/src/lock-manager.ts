/**
 * @agentos/blackboard — Lock Manager
 * Read/Write/Upgrade locks from blackboard-protocol Article IV.
 *
 * Lock compatibility:
 * - read: shared (multiple readers OK)
 * - write: exclusive (no other readers or writers)
 * - upgrade: single reader that can upgrade to writer
 *
 * Auto-release after MAX_LOCK_DURATION (5 min).
 */

import type { AgentID, LockType, Outcome } from '@agentos/types';
import { ok, err, BB_E, MAX_LOCK_DURATION_MS } from '@agentos/types';

// ─── Types ─────────────────────────────────────────────────────────────

export interface LockEntry {
  resource_id: string;
  agent_id: AgentID;
  lock_type: LockType;
  acquired_at: string;
  expires_at: string;
}

export interface LockWaiter {
  resource_id: string;
  agent_id: AgentID;
  lock_type: LockType;
  waiting_since: string;
}

// ─── LockManager ──────────────────────────────────────────────────────

export class LockManager {
  private locks: Map<string, LockEntry[]> = new Map(); // resourceId -> active locks
  private waiters: Map<string, LockWaiter[]> = new Map(); // resourceId -> waiting agents
  private lockDurationMs: number;

  constructor(lockDurationMs: number = MAX_LOCK_DURATION_MS) {
    this.lockDurationMs = lockDurationMs;
  }

  /**
   * Acquire a lock on a resource.
   *
   * Compatibility rules:
   * - read: multiple readers allowed, no writers
   * - write: exclusive access, no other readers or writers
   * - upgrade: single reader, blocks all others, can upgrade to write
   */
  acquireLock(
    resourceId: string,
    agentId: AgentID,
    lockType: LockType,
    now: string = new Date().toISOString(),
  ): Outcome<LockEntry> {
    // Check if agent already holds a lock on this resource
    const existingLocks = this.locks.get(resourceId) ?? [];
    const agentExisting = existingLocks.find((l) => l.agent_id === agentId);

    if (agentExisting) {
      // If upgrading from read to write
      if (agentExisting.lock_type === 'read' && lockType === 'write') {
        // Can upgrade only if no other readers
        const otherReaders = existingLocks.filter(
          (l) => l.agent_id !== agentId && l.lock_type === 'read',
        );
        if (otherReaders.length > 0) {
          return err(BB_E.LOCK_UNAVAILABLE, 'Cannot upgrade: other readers present', {
            retryable: true,
          });
        }
        // Upgrade: change lock type to write
        agentExisting.lock_type = 'write';
        agentExisting.expires_at = new Date(
          new Date(now).getTime() + this.lockDurationMs,
        ).toISOString();
        return ok(agentExisting);
      }

      // Already holding this lock type
      if (agentExisting.lock_type === lockType) {
        return ok(agentExisting);
      }

      // Incompatible upgrade request
      return err(BB_E.LOCK_UNAVAILABLE, `Agent already holds ${agentExisting.lock_type} lock, cannot acquire ${lockType}`, {
        retryable: false,
      });
    }

    // Check compatibility with existing locks
    if (!this.isCompatible(resourceId, agentId, lockType)) {
      // Add to waiters
      const resourceWaiters = this.waiters.get(resourceId) ?? [];
      resourceWaiters.push({
        resource_id: resourceId,
        agent_id: agentId,
        lock_type: lockType,
        waiting_since: now,
      });
      this.waiters.set(resourceId, resourceWaiters);

      return err(BB_E.LOCK_UNAVAILABLE, `Resource '${resourceId}' is locked by another agent`, {
        retryable: true,
      });
    }

    // Grant the lock
    const lockEntry: LockEntry = {
      resource_id: resourceId,
      agent_id: agentId,
      lock_type: lockType,
      acquired_at: now,
      expires_at: new Date(
        new Date(now).getTime() + this.lockDurationMs,
      ).toISOString(),
    };

    const resourceLocks = this.locks.get(resourceId) ?? [];
    resourceLocks.push(lockEntry);
    this.locks.set(resourceId, resourceLocks);

    return ok(lockEntry);
  }

  /**
   * Release a lock on a resource.
   */
  releaseLock(resourceId: string, agentId: AgentID): Outcome<true> {
    const existingLocks = this.locks.get(resourceId) ?? [];
    const lockIndex = existingLocks.findIndex((l) => l.agent_id === agentId);

    if (lockIndex === -1) {
      return err(BB_E.LOCK_UNAVAILABLE, `Agent does not hold a lock on resource '${resourceId}'`, {
        retryable: false,
      });
    }

    existingLocks.splice(lockIndex, 1);
    if (existingLocks.length === 0) {
      this.locks.delete(resourceId);
    } else {
      this.locks.set(resourceId, existingLocks);
    }

    // Remove from waiters if present
    const resourceWaiters = this.waiters.get(resourceId) ?? [];
    const waiterIndex = resourceWaiters.findIndex((w) => w.agent_id === agentId);
    if (waiterIndex !== -1) {
      resourceWaiters.splice(waiterIndex, 1);
      if (resourceWaiters.length === 0) {
        this.waiters.delete(resourceId);
      }
    }

    return ok(true);
  }

  /**
   * Get all active locks on a resource.
   */
  getLocks(resourceId: string): LockEntry[] {
    return this.locks.get(resourceId) ?? [];
  }

  /**
   * Get all locks held by an agent.
   */
  getLocksByAgent(agentId: AgentID): LockEntry[] {
    const result: LockEntry[] = [];
    for (const locks of this.locks.values()) {
      for (const lock of locks) {
        if (lock.agent_id === agentId) {
          result.push(lock);
        }
      }
    }
    return result;
  }

  /**
   * Get all agents waiting for a resource.
   */
  getWaiters(resourceId: string): LockWaiter[] {
    return this.waiters.get(resourceId) ?? [];
  }

  /**
   * Expire locks that have exceeded their timeout.
   * Returns the list of resource IDs that had locks expired.
   */
  expireLocks(now: string = new Date().toISOString()): string[] {
    const expired: string[] = [];
    for (const [resourceId, locks] of this.locks) {
      const active = locks.filter((l) => l.expires_at > now);
      if (active.length < locks.length) {
        expired.push(resourceId);
      }
      if (active.length === 0) {
        this.locks.delete(resourceId);
      } else {
        this.locks.set(resourceId, active);
      }
    }
    return expired;
  }

  /**
   * Build the wait-for graph for deadlock detection.
   * Returns edges: [waiting_agent_id, resource_id, holding_agent_id]
   */
  getWaitForGraph(): [AgentID, string, AgentID][] {
    const edges: [AgentID, string, AgentID][] = [];

    for (const [resourceId, resourceWaiters] of this.waiters) {
      for (const waiter of resourceWaiters) {
        const holders = this.locks.get(resourceId) ?? [];
        for (const holder of holders) {
          edges.push([waiter.agent_id, resourceId, holder.agent_id]);
        }
      }
    }

    return edges;
  }

  // ─── Private ──────────────────────────────────────────────────────

  /**
   * Check if a new lock request is compatible with existing locks.
   */
  private isCompatible(resourceId: string, _requestingAgent: AgentID, lockType: LockType): boolean {
    const existingLocks = this.locks.get(resourceId) ?? [];

    if (existingLocks.length === 0) {
      return true;
    }

    switch (lockType) {
      case 'read':
        // Read locks are shared: OK if no write or upgrade locks
        return existingLocks.every((l) => l.lock_type === 'read');

      case 'write':
        // Write locks are exclusive: no other locks allowed
        return false;

      case 'upgrade':
        // Upgrade locks are exclusive: no other locks allowed
        return false;

      default:
        return false;
    }
  }
}