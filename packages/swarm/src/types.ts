/**
 * @agentos/swarm — Swarm Types
 * Type definitions for the swarm runtime: agents, goals, workstreams,
 * coordination messages, and metrics.
 *
 * Architecture:
 *   ChiefAgent accepts goals → decomposes into workstreams → allocates budgets
 *   ManagerAgent owns workstreams → creates tasks on Blackboard → monitors progress
 *   WorkerAgent claims tasks → acquires resources → executes work → publishes results
 *   ValidatorAgent reviews outputs → verifies completion → approves/rejects
 *
 * All swarm activity runs inside the Simulation Environment with full
 * EventStore persistence for replay and auditing.
 */

import type {
  AgentID,
  TaskID,
  WorkspaceID,
  ProjectID,
  Priority,
  ResourceBudget,
  ResourceConsumption,
  ISO8601,
  Metadata,
  Tags,
} from '@agentos/types';
import { AgentType, AgentState } from '@agentos/types';

// ─── Swarm Configuration ──────────────────────────────────────────────────

export interface SwarmConfig {
  /** Unique identifier for this swarm run */
  id: string;
  /** Total budget for the swarm */
  totalBudget: ResourceBudget;
  /** Maximum number of concurrent workers per manager */
  maxWorkersPerManager: number;
  /** Maximum number of tasks per worker */
  maxTasksPerWorker: number;
  /** Maximum retry attempts for failed tasks */
  maxRetries: number;
  /** Validation consensus threshold (0-1) */
  validationThreshold: number;
  /** Number of validators required per result */
  validatorsPerResult: number;
  /** LLM integration mode: 'none' = simulation only, 'live' = real LLM calls */
  llmMode: 'none' | 'live';
  /** LLM client config (when llmMode = 'live') */
  llmBaseURL?: string;
  /** Whether to persist all events to EventStore */
  persistEvents: boolean;
  /** Clock speed multiplier for simulation */
  clockSpeed: number;
}

export const DEFAULT_SWARM_CONFIG: SwarmConfig = {
  id: '',
  totalBudget: { ru: 500_000, mu: 200_000, eu: 50_000, vu: 10_000 },
  maxWorkersPerManager: 20,
  maxTasksPerWorker: 3,
  maxRetries: 3,
  validationThreshold: 0.7,
  validatorsPerResult: 3,
  llmMode: 'none',
  persistEvents: true,
  clockSpeed: 10,
};

// ─── Goal & Workstream ────────────────────────────────────────────────────

export interface SwarmGoal {
  id: string;
  title: string;
  description: string;
  priority: Priority;
  budget: ResourceBudget;
  status: GoalStatus;
  workstreamIds: string[];
  createdBy: AgentID;
  createdAt: ISO8601;
  completedAt?: ISO8601;
  metadata: Metadata;
}

export type GoalStatus = 'pending' | 'decomposing' | 'in_progress' | 'completed' | 'failed';

export interface Workstream {
  id: string;
  goalId: string;
  title: string;
  description: string;
  priority: Priority;
  budget: ResourceBudget;
  status: WorkstreamStatus;
  managerId?: AgentID;
  taskIds: TaskID[];
  createdAt: ISO8601;
  completedAt?: ISO8601;
}

export type WorkstreamStatus = 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed';

// ─── Swarm Agent States ───────────────────────────────────────────────────

/**
 * Extended state machine for swarm agents.
 * Wraps AgentState with swarm-specific behaviors.
 */
export type SwarmAgentPhase =
  | 'spawning'        // Agent is being created
  | 'initializing'    // Agent is loading capabilities
  | 'idle'            // Ready but no work assigned
  | 'working'         // Actively processing tasks
  | 'waiting'         // Waiting for dependencies or validation
  | 'recovering'      // Recovering from an error
  | 'terminating';    // Shutting down

// ─── Swarm Message Types ──────────────────────────────────────────────────

export type SwarmMessageType =
  // Goal management
  | 'goal.submit'
  | 'goal.decomposed'
  | 'goal.completed'
  | 'goal.failed'
  // Workstream management
  | 'workstream.assign'
  | 'workstream.progress'
  | 'workstream.completed'
  | 'workstream.failed'
  // Task coordination
  | 'task.announce'
  | 'task.claim'
  | 'task.progress'
  | 'task.complete'
  | 'task.fail'
  | 'task.retry'
  | 'task.block'
  // Validation
  | 'validation.request'
  | 'validation.result'
  | 'validation.approve'
  | 'validation.reject'
  // Resource management
  | 'resource.allocate'
  | 'resource.release'
  | 'resource.exhausted'
  // Agent lifecycle
  | 'agent.spawn'
  | 'agent.ready'
  | 'agent.error'
  | 'agent.heartbeat'
  | 'agent.terminating';

export interface SwarmMessage {
  id: string;
  type: SwarmMessageType;
  sender: AgentID;
  recipient: AgentID | '*';
  payload: unknown;
  timestamp: number;
  correlationId?: string;
}

// ─── Swarm Agent Config ───────────────────────────────────────────────────

export interface SwarmAgentConfig {
  id: AgentID;
  type: AgentType.CHIEF | AgentType.MANAGER | AgentType.WORKER | AgentType.VALIDATOR;
  workspaceId: WorkspaceID;
  projectId: ProjectID;
  capabilities: string[];
  budget: ResourceBudget;
  priority: Priority;
  maxConcurrentTasks: number;
  failureRate: number;
}

// ─── Validation ───────────────────────────────────────────────────────────

export interface ValidationResult {
  taskId: TaskID;
  validatorId: AgentID;
  approved: boolean;
  confidence: number;
  issues: string[];
  suggestions: string[];
  timestamp: number;
}

export interface ValidationConsensus {
  taskId: TaskID;
  results: ValidationResult[];
  finalDecision: 'approved' | 'rejected' | 'needs_review';
  averageConfidence: number;
  timestamp: number;
}

// ─── Swarm Metrics ────────────────────────────────────────────────────────

export interface SwarmMetrics {
  // Task metrics
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  cancelledTasks: number;
  pendingTasks: number;
  completionRate: number;

  // Agent metrics
  totalAgents: number;
  activeAgents: number;
  idleAgents: number;
  erroredAgents: number;

  // Workstream metrics
  totalWorkstreams: number;
  completedWorkstreams: number;
  failedWorkstreams: number;

  // Resource metrics
  ruAllocated: number;
  ruConsumed: number;
  muAllocated: number;
  muConsumed: number;
  euAllocated: number;
  euConsumed: number;
  vuAllocated: number;
  vuConsumed: number;
  resourceUtilization: number;

  // Coordination metrics
  taskDuplication: number;
  averageTaskLatencyMs: number;
  deadlockCount: number;
  recoverySuccessRate: number;

  // Validation metrics
  validationRequests: number;
  validationApprovals: number;
  validationRejections: number;
  validationAccuracy: number;

  // Message throughput
  messagesSent: number;
  messagesPerSecond: number;

  // Timing
  startTime: number;
  endTime: number;
  durationMs: number;
}

export function createEmptySwarmMetrics(): SwarmMetrics {
  return {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    cancelledTasks: 0,
    pendingTasks: 0,
    completionRate: 0,
    totalAgents: 0,
    activeAgents: 0,
    idleAgents: 0,
    erroredAgents: 0,
    totalWorkstreams: 0,
    completedWorkstreams: 0,
    failedWorkstreams: 0,
    ruAllocated: 0,
    ruConsumed: 0,
    muAllocated: 0,
    muConsumed: 0,
    euAllocated: 0,
    euConsumed: 0,
    vuAllocated: 0,
    vuConsumed: 0,
    resourceUtilization: 0,
    taskDuplication: 0,
    averageTaskLatencyMs: 0,
    deadlockCount: 0,
    recoverySuccessRate: 0,
    validationRequests: 0,
    validationApprovals: 0,
    validationRejections: 0,
    validationAccuracy: 0,
    messagesSent: 0,
    messagesPerSecond: 0,
    startTime: 0,
    endTime: 0,
    durationMs: 0,
  };
}

// ─── Mission Control Events ───────────────────────────────────────────────

export type MissionControlEventType =
  | 'agent.state_change'
  | 'agent.spawned'
  | 'agent.terminated'
  | 'task.state_change'
  | 'task.created'
  | 'task.claimed'
  | 'task.completed'
  | 'task.failed'
  | 'workstream.created'
  | 'workstream.completed'
  | 'resource.allocated'
  | 'resource.released'
  | 'message.sent'
  | 'validation.result'
  | 'deadlock.detected'
  | 'deadlock.resolved'
  | 'error';

export interface MissionControlEvent {
  id: string;
  type: MissionControlEventType;
  agentId?: AgentID;
  taskId?: TaskID;
  timestamp: number;
  data: Record<string, unknown>;
}

// ─── Worker Execution Result ──────────────────────────────────────────────

export interface WorkerResult {
  taskId: TaskID;
  agentId: AgentID;
  output: unknown;
  confidence: number;
  resourcesConsumed: ResourceConsumption;
  durationMs: number;
  llmCallsUsed: number;
  capabilityPath: string;
}