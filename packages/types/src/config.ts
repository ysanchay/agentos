/**
 * @agentos/types — Configuration Loading Utility
 * Reads configuration from environment variables with sensible defaults.
 * Allows production deployment to override hardcoded values without
 * changing source code.
 *
 * ALPHA_FREEZE.md §2.6 — configuration externalization (allowed change).
 */

// ─── Environment Variable Helpers ──────────────────────────────────────────

/**
 * Read a string environment variable with a default value.
 */
export function envString(key: string, defaultValue: string): string {
  const value = process.env[key];
  return value !== undefined && value !== '' ? value : defaultValue;
}

/**
 * Read a numeric environment variable with a default value.
 */
export function envNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Read a boolean environment variable with a default value.
 * Accepts: 'true'/'false', '1'/'0', 'yes'/'no'.
 */
export function envBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') return defaultValue;
  return value === 'true' || value === '1' || value === 'yes';
}

// ─── AgentOS Configuration ─────────────────────────────────────────────────

/**
 * Centralized AgentOS configuration sourced from environment variables.
 * All values have sensible defaults for local development.
 */
export interface AgentOSConfig {
  /** LLM Model Router base URL */
  llmBaseUrl: string;
  /** LLM request timeout in milliseconds */
  llmTimeout: number;
  /** LLM max retries on transient errors */
  llmMaxRetries: number;
  /** LLM API key (passed as Authorization header) */
  llmApiKey: string | undefined;
  /** Health check endpoint URL for connectivity probing */
  healthCheckUrl: string;
  /** Swarm: max workers per manager */
  swarmMaxWorkers: number;
  /** Swarm: max retries for failed tasks */
  swarmMaxRetries: number;
  /** Swarm: validation consensus threshold (0.0-1.0) */
  swarmValidationThreshold: number;
  /** Swarm: validators per result */
  swarmValidatorsPerResult: number;
  /** Data directory for telemetry and cache storage */
  dataDir: string;
  /** Log level: debug, info, warn, error */
  logLevel: string;
}

/**
 * Load AgentOS configuration from environment variables.
 */
export function loadConfig(): AgentOSConfig {
  return {
    llmBaseUrl: envString('AGENTOS_LLM_BASE_URL', 'http://localhost:8080'),
    llmTimeout: envNumber('AGENTOS_LLM_TIMEOUT', 120_000),
    llmMaxRetries: envNumber('AGENTOS_LLM_MAX_RETRIES', 3),
    llmApiKey: process.env['AGENTOS_LLM_API_KEY'],
    healthCheckUrl: envString('AGENTOS_HEALTH_CHECK_URL', 'https://httpbin.org/head'),
    swarmMaxWorkers: envNumber('AGENTOS_SWARM_MAX_WORKERS', 10),
    swarmMaxRetries: envNumber('AGENTOS_SWARM_MAX_RETRIES', 3),
    swarmValidationThreshold: envNumber('AGENTOS_SWARM_VALIDATION_THRESHOLD', 0.7),
    swarmValidatorsPerResult: envNumber('AGENTOS_SWARM_VALIDATORS_PER_RESULT', 3),
    dataDir: envString('AGENTOS_DATA_DIR', '.agentos'),
    logLevel: envString('AGENTOS_LOG_LEVEL', 'info'),
  };
}

/**
 * Default configuration (for testing or when env vars are not set).
 */
export const DEFAULT_CONFIG: AgentOSConfig = loadConfig();