/**
 * @agentos/blackboard — Deadlock Detector
 * Wait-for graph cycle detection from blackboard-protocol Article IV.3.
 *
 * Maintain wait-for graph: agent -> resource -> waiting_agent
 * Detect cycles using DFS.
 * Resolution: abort lock held by lowest priority agent;
 *   if same priority, youngest lock (most recently acquired).
 */

import type { AgentID, Outcome } from '@agentos/types';
import { ok, err, BB_E } from '@agentos/types';
import type { LockEntry, LockWaiter } from './lock-manager.js';

// ─── Types ─────────────────────────────────────────────────────────────

export interface DeadlockInfo {
  cycle: AgentID[];
  resource_ids: string[];
  detected_at: string;
}

export interface AgentPriority {
  agent_id: AgentID;
  priority: number; // 0-5, lower = higher priority
}

// ─── DeadlockDetector ─────────────────────────────────────────────────

export class DeadlockDetector {
  /**
   * Detect deadlocks from the wait-for graph.
   *
   * The wait-for graph has edges: waiter_agent -> holder_agent
   * A cycle in this graph indicates a deadlock.
   *
   * Returns all detected cycles (deadlocks).
   */
  detectDeadlocks(
    waitForEdges: [AgentID, string, AgentID][],
    now: string = new Date().toISOString(),
  ): DeadlockInfo[] {
    // Build adjacency list from wait-for edges
    // waiter -> [holders they are waiting for]
    const adjacency = new Map<AgentID, Set<AgentID>>();
    const edgeResources = new Map<string, string>(); // "waiter->holder" -> resourceId

    for (const [waiter, resourceId, holder] of waitForEdges) {
      if (!adjacency.has(waiter)) {
        adjacency.set(waiter, new Set());
      }
      adjacency.get(waiter)!.add(holder);
      edgeResources.set(`${waiter}->${holder}`, resourceId);
    }

    // Find all cycles using DFS
    const cycles: DeadlockInfo[] = [];
    const visited = new Set<AgentID>();
    const recursionStack = new Set<AgentID>();
    const path: AgentID[] = [];

    const dfs = (node: AgentID) => {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const neighbors = adjacency.get(node);
      if (neighbors) {
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            dfs(neighbor);
          } else if (recursionStack.has(neighbor)) {
            // Found a cycle — extract it
            const cycleStart = path.indexOf(neighbor);
            const cycle = path.slice(cycleStart);
            const resourceIds: string[] = [];

            // Collect resource IDs for edges in the cycle
            for (let i = 0; i < cycle.length; i++) {
              const from = cycle[i]!;
              const to = cycle[(i + 1) % cycle.length]!;
              const key = `${from}->${to}`;
              const resourceId = edgeResources.get(key);
              if (resourceId) {
                resourceIds.push(resourceId);
              }
            }

            cycles.push({
              cycle: [...cycle],
              resource_ids: resourceIds,
              detected_at: now,
            });
          }
        }
      }

      path.pop();
      recursionStack.delete(node);
    };

    for (const node of adjacency.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }

  /**
   * Resolve a deadlock by selecting the victim.
   * Resolution: abort lock held by lowest priority agent;
   *   if same priority, youngest lock (most recently acquired).
   *
   * Returns the agent ID of the victim whose lock should be aborted.
   */
  resolveDeadlock(
    deadlock: DeadlockInfo,
    agentPriorities: Map<AgentID, number>,
    activeLocks: LockEntry[],
  ): Outcome<AgentID> {
    // Find all agents involved in the cycle
    const cycleAgents = new Set(deadlock.cycle);

    // Find all locks held by cycle agents
    const cycleLocks = activeLocks.filter((l) => cycleAgents.has(l.agent_id));

    if (cycleLocks.length === 0) {
      return err(BB_E.DEADLOCK_DETECTED, 'No locks found for deadlock agents', {
        retryable: false,
      });
    }

    // Sort by priority (higher number = lower priority = victim first)
    // Then by acquisition time (later = younger = victim first)
    const sorted = [...cycleLocks].sort((a, b) => {
      const priorityA = agentPriorities.get(a.agent_id) ?? 5;
      const priorityB = agentPriorities.get(b.agent_id) ?? 5;

      // Higher priority number = lower priority = prefer as victim
      if (priorityA !== priorityB) {
        return priorityB - priorityA; // descending: lower priority first
      }

      // Same priority: youngest lock (most recently acquired) is victim
      return b.acquired_at.localeCompare(a.acquired_at);
    });

    // The first in sorted list is the victim
    const victim = sorted[0]!;
    return ok(victim.agent_id);
  }
}