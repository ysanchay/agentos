/**
 * @agentos/blackboard — Conflict Resolver
 * 4 conflict strategies from blackboard-protocol Article V:
 * - 'first-wins': first result submitted wins
 * - 'vote': majority (>50%) wins
 * - 'chief-decides': Chief picks best
 * - 'merge': merge results if possible
 */

import type {
  AgentID,
  ConflictStrategy,
  TaskID,
  TaskResult,
  Outcome,
} from '@agentos/types';
import { ok, err, BB_E } from '@agentos/types';

// ─── Types ─────────────────────────────────────────────────────────────

export interface ConflictVote {
  agent_id: AgentID;
  result_id: string;
  timestamp: string;
}

export interface ConflictState {
  task_id: TaskID;
  results: TaskResult[];
  votes: ConflictVote[];
  strategy: ConflictStrategy;
  resolved: boolean;
  winner?: TaskResult;
}

export interface MergeResult {
  merged_output: unknown;
  source_results: string[];
  merge_strategy: string;
}

// ─── ConflictResolver ─────────────────────────────────────────────────

export class ConflictResolver {
  private conflicts: Map<TaskID, ConflictState> = new Map();

  /**
   * Register a conflict for a task (called when multiple results are submitted).
   */
  registerConflict(taskId: TaskID, results: TaskResult[], strategy: ConflictStrategy): Outcome<ConflictState> {
    if (results.length < 2) {
      return err(BB_E.VALIDATION_FAILED, 'Conflict requires at least 2 results', {
        retryable: false,
      });
    }

    const state: ConflictState = {
      task_id: taskId,
      results,
      votes: [],
      strategy,
      resolved: false,
    };

    this.conflicts.set(taskId, state);
    return ok(state);
  }

  /**
   * Cast a vote for a specific result in a conflict.
   */
  vote(taskId: TaskID, agentId: AgentID, resultId: string): Outcome<true> {
    const state = this.conflicts.get(taskId);
    if (!state) {
      return err(BB_E.TASK_NOT_FOUND, 'No conflict registered for this task', {
        retryable: false,
      });
    }

    // Check if agent already voted
    const alreadyVoted = state.votes.find((v) => v.agent_id === agentId);
    if (alreadyVoted) {
      return err(BB_E.VALIDATION_FAILED, 'Agent has already voted', {
        retryable: false,
      });
    }

    state.votes.push({
      agent_id: agentId,
      result_id: resultId,
      timestamp: new Date().toISOString(),
    });

    return ok(true);
  }

  /**
   * Resolve a conflict using the configured strategy.
   */
  resolveConflict(
    taskId: TaskID,
    strategy: ConflictStrategy,
    chiefId?: AgentID,
  ): Outcome<TaskResult> {
    const state = this.conflicts.get(taskId);
    if (!state) {
      return err(BB_E.TASK_NOT_FOUND, 'No conflict registered for this task', {
        retryable: false,
      });
    }

    if (state.resolved) {
      return ok(state.winner!);
    }

    let result: Outcome<TaskResult>;

    switch (strategy) {
      case 'first-wins':
        result = this.resolveFirstWins(state);
        break;
      case 'vote':
        result = this.resolveByVote(state);
        break;
      case 'chief-decides':
        result = this.resolveChiefDecides(state, chiefId);
        break;
      case 'merge':
        result = this.resolveMerge(state);
        break;
      default:
        result = err(BB_E.VALIDATION_FAILED, `Unknown conflict strategy: ${strategy}`, {
          retryable: false,
        });
    }

    if (result.ok) {
      state.resolved = true;
      state.winner = result.data;
    }

    return result;
  }

  /**
   * Get the conflict state for a task.
   */
  getConflict(taskId: TaskID): ConflictState | undefined {
    return this.conflicts.get(taskId);
  }

  // ─── Strategy Implementations ──────────────────────────────────────

  /**
   * first-wins: The first result submitted wins.
   */
  private resolveFirstWins(state: ConflictState): Outcome<TaskResult> {
    // Sort by completion time, earliest wins
    const sorted = [...state.results].sort(
      (a, b) => a.completed_at.localeCompare(b.completed_at),
    );
    return ok(sorted[0]!);
  }

  /**
   * vote: Majority (>50%) wins.
   * Each result is identified by its agent_id.
   */
  private resolveByVote(state: ConflictState): Outcome<TaskResult> {
    if (state.votes.length === 0) {
      return err(BB_E.VALIDATION_FAILED, 'No votes cast for vote-based conflict resolution', {
        retryable: false,
      });
    }

    // Count votes per result agent (result_id maps to agent_id of result submitter)
    const voteCounts = new Map<string, number>();
    for (const vote of state.votes) {
      const count = voteCounts.get(vote.result_id) ?? 0;
      voteCounts.set(vote.result_id, count + 1);
    }

    const totalVotes = state.votes.length;
    const majority = Math.floor(totalVotes / 2) + 1;

    // Find result with majority
    for (const [resultId, count] of voteCounts) {
      if (count >= majority) {
        const winner = state.results.find(
          (r) => r.agent_id === resultId,
        );
        if (winner) {
          return ok(winner);
        }
      }
    }

    // No majority — fall back to first-wins
    return this.resolveFirstWins(state);
  }

  /**
   * chief-decides: The Chief agent picks the best result.
   */
  private resolveChiefDecides(state: ConflictState, chiefId?: AgentID): Outcome<TaskResult> {
    if (!chiefId) {
      return err(BB_E.PERMISSION_DENIED, 'Chief agent ID required for chief-decides strategy', {
        retryable: false,
      });
    }

    // Find the result from the chief, or highest confidence result
    const chiefResult = state.results.find((r) => r.agent_id === chiefId);
    if (chiefResult) {
      return ok(chiefResult);
    }

    // Chief hasn't submitted a result — pick highest confidence
    const sorted = [...state.results].sort(
      (a, b) => b.confidence - a.confidence,
    );
    return ok(sorted[0]!);
  }

  /**
   * merge: Attempt to merge results if possible.
   * If merge fails, fall back to first-wins.
   */
  private resolveMerge(state: ConflictState): Outcome<TaskResult> {
    // Check if results can be merged (same type of output)
    const outputs = state.results.map((r) => r.output);

    // Try to merge arrays
    if (outputs.every((o) => Array.isArray(o))) {
      const merged = outputs.flatMap((o) => o as unknown[]);
      const first = state.results[0]!;
      const mergedResult: TaskResult = {
        ...first,
        output: merged,
        confidence: Math.min(...state.results.map((r) => r.confidence)),
        artifacts: state.results.flatMap((r) => r.artifacts),
      };
      return ok(mergedResult);
    }

    // Try to merge objects
    if (outputs.every((o) => typeof o === 'object' && o !== null && !Array.isArray(o))) {
      const merged = Object.assign({}, ...outputs as Record<string, unknown>[]);
      const first = state.results[0]!;
      const mergedResult: TaskResult = {
        ...first,
        output: merged,
        confidence: Math.min(...state.results.map((r) => r.confidence)),
        artifacts: state.results.flatMap((r) => r.artifacts),
      };
      return ok(mergedResult);
    }

    // Cannot merge — fall back to first-wins
    return this.resolveFirstWins(state);
  }
}