/**
 * AgentOS Constitutional Constants
 * All thresholds, timeouts, limits, and defaults from the 6 constitution documents
 */

// ─── Agent Constants (kernel-api) ──────────────────────────────────

export const AGENT_MAX_RETRIES = 3;
export const AGENT_INIT_TIMEOUT_MS = 30_000;
export const AGENT_TERMINATE_TIMEOUT_MS = 60_000;

// ─── Task Constants (kernel-api + blackboard) ──────────────────────

export const CLAIM_TIMEOUT_MS = 60_000;
export const MAX_TASK_RETRIES = 3;

// ─── Heartbeat Constants (acp + blackboard) ──────────────────────

export const HEARTBEAT_INTERVAL_MS = 30_000;
export const HEARTBEAT_JITTER_MS = 5_000;
export const HEARTBEAT_SUSPECT_MS = 60_000; // 1 missed
export const HEARTBEAT_DEGRADED_MS = 90_000; // 2 missed
export const HEARTBEAT_FAILED_MS = 90_000; // 3 missed
export const RECOVERY_TIMEOUT_MS = 300_000; // 5 minutes

// ─── Lock Constants (blackboard) ──────────────────────────────────

export const MAX_LOCK_DURATION_MS = 300_000; // 5 minutes
export const DEADLOCK_CHECK_INTERVAL_MS = 30_000;

// ─── ACP Message Constants ─────────────────────────────────────────

export const MESSAGE_MAX_SIZE_BYTES = 1_048_576; // 1 MB
export const MESSAGE_MAX_PAYLOAD_BYTES = 524_288; // 512 KB
export const MESSAGE_MAX_METADATA_BYTES = 4_096; // 4 KB
export const MESSAGE_MAX_METADATA_KEYS = 16;
export const MESSAGE_MAX_METADATA_VALUE_LENGTH = 256;
export const CHANNEL_NAME_MAX_LENGTH = 128;
export const TIMESTAMP_CLOCK_SKEW_MS = 60_000; // +/-60 seconds
export const DEFAULT_TTL_MS = 3_600_000; // 1 hour

// ─── RPC Constants (acp) ──────────────────────────────────────────

export const RPC_DEFAULT_TIMEOUT_MS = 30_000;
export const RPC_MAX_RETRIES = 3;
export const RPC_BACKOFF_BASE_MS = 1_000;
export const RPC_MAX_DELAY_MS = 30_000;
export const RPC_JITTER_MS = 500;
export const IDEMPOTENCY_KEY_TTL_MS = 86_400_000; // 24 hours

// ─── Circuit Breaker (acp) ────────────────────────────────────────

export const CIRCUIT_BREAKER_TRIGGER_COUNT = 5;
export const CIRCUIT_BREAKER_PAUSE_MS = 60_000;

// ─── DLQ Constants (acp) ──────────────────────────────────────────

export const DLQ_RETENTION_DAYS = 7;

// ─── Approval Constants (acp) ─────────────────────────────────────

export const APPROVAL_DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
export const APPROVAL_URGENCY_CRITICAL_MS = 60_000;
export const APPROVAL_URGENCY_HIGH_MS = 300_000;
export const APPROVAL_URGENCY_NORMAL_MS = 1_800_000;
export const APPROVAL_URGENCY_LOW_MS = 14_400_000;

// ─── Resource Constants (resource-model) ──────────────────────────

export const MIN_RUNTIME_MS = 30_000; // Preemption immunity
export const GRACE_PERIOD_MS = 10_000; // Preemption grace
export const PREEMPTION_PENALTY_THRESHOLD = 3; // In 24h
export const PREEMPTION_FLAG_THRESHOLD = 5; // In 24h
export const BURST_ALLOWANCE_RATIO = 0.20; // 20% of hourly quota
export const FAIR_SHARE_RECALCULATE_MS = 30_000;

// ─── Throttle Levels (resource-model) ─────────────────────────────

export const THROTTLE_MILD = 0.50; // 50% reduction, 5 min
export const THROTTLE_MODERATE = 0.25; // 75% reduction, 15 min
export const THROTTLE_SEVERE = 0.10; // 90% reduction, 1 hour
export const THROTTLE_CRITICAL = 0.05; // 95% reduction, until admin

export const THROTTLE_MILD_DURATION_MS = 300_000;
export const THROTTLE_MODERATE_DURATION_MS = 900_000;
export const THROTTLE_SEVERE_DURATION_MS = 3_600_000;

// ─── Budget Enforcement Thresholds (resource-model) ──────────────

export const BUDGET_WARNING_PERCENT = 80;
export const BUDGET_CRITICAL_PERCENT = 95;
export const BUDGET_EXHAUSTED_PERCENT = 100;
export const BUDGET_FORCE_TERMINATE_AFTER_MS = 30_000; // After 100%, 30s to force kill

// ─── Starvation Max Wait (resource-model) ────────────────────────

export const MAX_PRIORITY_WAIT_MS: Record<number, number> = {
  0: 0, // SYSTEM: never waits
  1: 10_000, // CRITICAL: 10s
  2: 60_000, // HIGH: 1 min
  3: 300_000, // NORMAL: 5 min
  4: -1, // LOW: no guarantee
  5: -1, // IDLE: no guarantee
};

// ─── Priority Inversion (resource-model) ─────────────────────────

export const PRIORITY_INVERSION_MAX_DURATION_MS = 30_000;
export const PRIORITY_INVERSION_MAX_PER_HOUR = 3;

// ─── Capability Graph Constants ──────────────────────────────────

export const CAPABILITY_PATH_MAX_DEPTH = 6;
export const CAPABILITY_PATH_MAX_LENGTH = 128;
export const CAPABILITY_SEMANTIC_THRESHOLD = 0.8;
export const CAPABILITY_CACHE_TTL_MS = 300_000;
export const CAPABILITY_CACHE_MAX_BYTES = 104_857_600; // 100 MB
export const PROVIDER_HEALTH_CHECK_AGENT_MS = 60_000;
export const PROVIDER_HEALTH_CHECK_SERVICE_MS = 300_000;
export const PROVIDER_HEALTH_CHECK_TIMEOUT_MS = 10_000;
export const PROVIDER_DEGRADED_SLOW_RESPONSES = 2;
export const PROVIDER_UNHEALTHY_SUCCESS_RATE = 0.5;
export const BUDGET_OVERRUN_FLAG_PERCENT = 20;

// ─── Blackboard Performance Targets ─────────────────────────────

export const BB_CLAIM_LATENCY_TARGET_MS = 100;
export const BB_CLAIM_LATENCY_MAX_MS = 500;
export const BB_READ_LATENCY_TARGET_MS = 50;
export const BB_READ_LATENCY_MAX_MS = 200;
export const BB_WRITE_LATENCY_TARGET_MS = 100;
export const BB_WRITE_LATENCY_MAX_MS = 500;
export const BB_EVENTS_PER_SECOND_TARGET = 10_000;
export const BB_EVENTS_PER_SECOND_MAX = 50_000;
export const BB_MAX_CONCURRENT_AGENTS = 10_000;
export const BB_MAX_ACTIVE_TASKS = 100_000;
export const BB_MAX_CONTEXT_ENTRIES = 1_000_000;

// ─── Validation (blackboard) ─────────────────────────────────────

export const AUTO_APPROVE_CONFIDENCE_THRESHOLD = 0.7;

// ─── Security Constants (threat-model) ───────────────────────────

export const JWT_ACCESS_TOKEN_TTL_MS = 900_000; // 15 minutes
export const JWT_REFRESH_TOKEN_TTL_MS = 604_800_000; // 7 days
export const AUTH_RATE_LIMIT_PER_MINUTE = 5;
export const REPLAY_NONCE_TTL_MS = 120_000;
export const KEY_ROTATION_PERIOD_DAYS = 90;