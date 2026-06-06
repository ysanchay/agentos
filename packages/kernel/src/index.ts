/**
 * @agentos/kernel — AgentOS Core Runtime
 * The deterministic heart of the operating system.
 */

export { Kernel } from './kernel.js';
export { GenericStateMachine } from './state-machine.js';
export type { TransitionDef, TransitionRecord } from './state-machine.js';
export { AgentStateMachine } from './agent-lifecycle.js';
export type { AgentTransitionContext } from './agent-lifecycle.js';
export { TaskStateMachine } from './task-lifecycle.js';
export type { TaskTransitionContext } from './task-lifecycle.js';
export { WorkspaceStateMachine } from './workspace-lifecycle.js';
export type { WorkspaceTransitionContext } from './workspace-lifecycle.js';
export { AgentRegistry } from './agent-registry.js';
export { TaskRegistry } from './task-registry.js';
export { WorkspaceRegistry } from './workspace-registry.js';
export { DependencyGraph } from './dependency-graph.js';
export { PermissionEngine } from './permission-engine.js';
export { EventBus } from './event-bus.js';
export { InvariantChecker } from './invariant-checker.js';
export type { InvariantViolation, InvariantReport } from './invariant-checker.js';