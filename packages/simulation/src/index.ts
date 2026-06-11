/**
 * @agentos/simulation — AgentOS Simulation Package
 * 100-agent verification that the constitutional architecture works.
 * ZERO AI logic — deterministic simulation only.
 */

// Main simulation
export { Simulation } from './simulation.js';
export type { SimulationResult } from './simulation.js';

// Configuration
export { createConfig, DEFAULT_CONFIG } from './simulation-config.js';
export type { SimulationConfig } from './simulation-config.js';

// Clock
export { SimulationClock } from './simulation-clock.js';

// Reporter
export { SimulationReporter } from './simulation-reporter.js';
export type { SimulationMetrics, VerificationCheck, VerificationResults } from './simulation-reporter.js';

// Verifier
export { SimulationVerifier } from './simulation-verifier.js';
export type { SimulationState } from './simulation-verifier.js';

// Fake Agents
export { FakeAgent, AgentFactory } from './fake-agent.js';
export type { FakeAgentRole, FakeAgentConfig } from './fake-agent.js';

// Workload Generator
export { WorkloadGenerator } from './workload-generator.js';
export type { TaskTemplate, GeneratedTask } from './workload-generator.js';