/**
 * @agentos/swarm — Swarm Runtime for AgentOS
 * Coordinates Chief, Manager, Worker, and Validator agents through
 * ACP messaging, Blackboard task coordination, and Resource scheduling.
 *
 * Architecture:
 *   ChiefAgent   → Goal decomposition, budget allocation, manager creation
 *   ManagerAgent → Workstream → tasks, Blackboard publishing, monitoring
 *   WorkerAgent  → Task claiming, resource acquisition, work execution, LLM integration
 *   ValidatorAgent → Output review, consistency detection, confidence assessment
 *
 * SwarmCoordinator orchestrates the full lifecycle.
 * MissionControl provides live visibility dashboard.
 * SwarmMetrics tracks all operational metrics.
 *
 * All swarm activity persists through EventStore for replay and auditing.
 */

// ─── Agent Classes ─────────────────────────────────────────────────────────

export { SwarmAgent } from './swarm-agent.js';
export type { SwarmAgentContext } from './swarm-agent.js';

export { ChiefAgent } from './chief-agent.js';
export type { ChiefAgentConfig } from './chief-agent.js';

export { ManagerAgent } from './manager-agent.js';
export type { ManagerAgentConfig } from './manager-agent.js';

export { WorkerAgent } from './worker-agent.js';
export type { WorkerAgentConfig } from './worker-agent.js';

export { ValidatorAgent } from './validator-agent.js';
export type { ValidatorAgentConfig } from './validator-agent.js';

// ─── Coordinator & Metrics ─────────────────────────────────────────────────

export { SwarmCoordinator } from './swarm-coordinator.js';
export type { SwarmRunConfig, SwarmResult } from './swarm-coordinator.js';

export { SwarmMetricsCollector } from './swarm-metrics.js';

// ─── Mission Control ───────────────────────────────────────────────────────

export { MissionControl } from './mission-control.js';
export type {
  AgentOverview,
  TaskOverview,
  ResourceOverview,
  MessageTraffic,
  WorkflowProgress,
  MissionControlSnapshot,
} from './mission-control.js';

// ─── Operational Console (Expanded Mission Control) ───────────────────────

export { OperationalConsole } from './operational-console.js';
export type {
  AlertSeverity,
  Alert,
  OfflineStatus,
  SecurityAuditEntry,
  ResourceAlert,
  PerformanceMetric,
  EventTimelineEntry,
  OperationalConsoleData,
} from './operational-console.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export type {
  SwarmConfig,
  SwarmGoal,
  GoalStatus,
  Workstream,
  WorkstreamStatus,
  SwarmAgentPhase,
  SwarmMessageType,
  SwarmMessage,
  SwarmAgentConfig,
  ValidationResult,
  ValidationConsensus,
  SwarmMetrics,
  MissionControlEventType,
  MissionControlEvent,
  WorkerResult,
} from './types.js';

export { DEFAULT_SWARM_CONFIG, createEmptySwarmMetrics } from './types.js';