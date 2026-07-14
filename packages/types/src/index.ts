/**
 * @agentos/types — AgentOS Type System
 * The single source of truth for all TypeScript types, interfaces, enums, and constants
 * derived from the 6 ratified constitution documents.
 */

// Primitives
export type {
  UUID,
  AgentID,
  TaskID,
  WorkspaceID,
  ProjectID,
  CapabilityID,
  PermissionID,
  MemoryID,
  AllocationID,
  EventID,
  ApprovalID,
  UserID,
  OrgID,
  ChannelID,
  ProviderID,
  ServiceID,
  InvocationID,
  SubscriptionID,
  LockID,
  ConsensusID,
} from './primitives.js';
export { isUUID, asUUID, createUUID } from './primitives.js';

// Temporal
export type { ISO8601, Duration, TTL } from './temporal.js';

// Resource types
export {
  ResourceUnit,
  ZERO_BUDGET,
  ZERO_CONSUMPTION,
  addBudgets,
  subtractBudgets,
  budgetGTE,
  isZeroBudget,
  scaleBudget,
} from './resource-types.js';
export type { ResourceBudget, ResourceConsumption } from './resource-types.js';

// Common
export type { Priority, ACPPriority, TaskPriority, Tags, Metadata, Provenance, Result, AgentError, Outcome, PaginatedResult } from './common.js';
export {
  PRIORITY_SYSTEM,
  PRIORITY_CRITICAL,
  PRIORITY_HIGH,
  PRIORITY_NORMAL,
  PRIORITY_LOW,
  PRIORITY_IDLE,
  TASK_PRIORITY_CRITICAL,
  TASK_PRIORITY_HIGH,
  TASK_PRIORITY_NORMAL,
  TASK_PRIORITY_LOW,
  TASK_PRIORITY_BACKGROUND,
  ok,
  err,
  acpToPriority,
  priorityToAcp,
  taskToPriority,
  priorityToTask,
} from './common.js';

// Agents
export { AgentType, AgentState, AGENT_TERMINAL_STATES, AGENT_TRANSITIONS } from './agents.js';
export type { Agent } from './agents.js';

// Tasks
export { TaskType, TaskState, TASK_TERMINAL_STATES, TASK_TRANSITIONS } from './tasks.js';
export type { Task, TaskError, TaskResult, ArtifactRef, PreviousOwner } from './tasks.js';

// Workspaces
export { WorkspaceState, WORKSPACE_TERMINAL_STATES, WORKSPACE_TRANSITIONS } from './workspaces.js';
export type { Workspace } from './workspaces.js';

// Projects
export { ProjectState, PROJECT_TERMINAL_STATES } from './projects.js';
export type { Project } from './projects.js';

// Capabilities
export {
  ROOT_CAPABILITIES,
  CapabilityState,
  asCapabilityPath,
  isValidCapabilityPath,
  getCapabilityRoot,
} from './capabilities.js';
export type {
  RootCapability,
  CapabilityPath,
  CapabilityStability,
  ProviderStatus,
  CostModel,
  Capability,
  CapabilityProvider,
  InvocationStatus,
  CapabilityInvocation,
  InvocationResult,
  InvocationError,
  CapabilityPermission,
  CapabilityDeprecation,
  HealthStatus,
  CapabilityHealth,
  MatchType,
  OptimizationTarget,
  ResolutionRequest,
  ResolutionResult,
  ResourceProfile,
  RateLimit,
} from './capabilities.js';

// Permissions
export { PermissionScope } from './permissions.js';
export type { Permission, PermissionConditions } from './permissions.js';

// Memory
export { MemoryTier, MemoryType } from './memory.js';
export type { MemoryEntry, MemoryRelation } from './memory.js';

// Allocations
export {
  AllocationState,
  ALLOCATION_TERMINAL_STATES,
} from './allocations.js';
export type {
  ResourceAllocation,
  ResourceRequest,
  AgentQuota,
  WorkspaceQuota,
  UserQuota,
  EnterpriseQuota,
  EfficiencyScore,
} from './allocations.js';

// Events
export { EventDomain } from './events.js';
export type { Event } from './events.js';

// Approvals
export { ApprovalType, ApprovalState } from './approvals.js';
export type { Approval } from './approvals.js';

// ACP
export type {
  MessageType,
  ACPMessage,
  AgentSpawnPayload,
  AgentTerminatePayload,
  AgentHeartbeatPayload,
  CapabilityAdvertisePayload,
  AgentStatusPayload,
  TaskCreatePayload,
  TaskAssignPayload,
  TaskClaimPayload,
  TaskReleasePayload,
  TaskCompletePayload,
  TaskFailPayload,
  TaskCancelPayload,
  TaskProgressPayload,
  RPCRequestPayload,
  RPCResponsePayload,
  RPCErrorPayload,
  BroadcastPayload,
  EventPublishPayload,
  EventSubscribePayload,
  EventUnsubscribePayload,
  ApprovalRequestPayload,
  ApprovalGrantPayload,
  ApprovalDenyPayload,
  ApprovalExpiredPayload,
  MemoryStorePayload,
  MemoryRetrievePayload,
  MemorySearchPayload,
  MemoryDeletePayload,
  ResourceAllocatePayload,
  ResourceGrantPayload,
  ResourceDenyPayload,
  ResourceReleasePayload,
  ResourceWarningPayload,
  ErrorTimeoutPayload,
  ErrorRateLimitPayload,
  ErrorUnauthorizedPayload,
  ErrorInvalidPayload,
  DeadLetterPayload,
  ACPError,
  LivenessState,
} from './acp.js';

// Blackboard
export type {
  Blackboard,
  GoalSection,
  TaskSection,
  ClaimSection,
  ResultSection,
  ContextSection,
  ConsensusSection,
  ErrorSection,
  GoalEntry,
  BlackboardError,
  BlackboardTask,
  LockType,
  ConflictStrategy,
  SharedContext,
  ConsensusRecord,
  ConsensusStrategy,
  RetryPolicy,
} from './blackboard.js';

// Error codes
export { KER, ACP_E, BB_E, CG_E } from './errors.js';
export type {
  KernelErrorCode,
  ACPErrorCode,
  BlackboardErrorCode,
  CapabilityErrorCode,
  AgentOSErrorCode,
} from './errors.js';

// Constants
export * from './constants.js';

// Configuration
export { envString, envNumber, envBool, loadConfig, DEFAULT_CONFIG } from './config.js';
export type { AgentOSConfig } from './config.js';