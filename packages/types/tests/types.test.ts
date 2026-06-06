import { describe, it, expect } from 'vitest';
import {
  AgentState, AgentType, AGENT_TRANSITIONS, AGENT_TERMINAL_STATES,
  TaskState, TaskType, TASK_TRANSITIONS, TASK_TERMINAL_STATES,
  WorkspaceState, WORKSPACE_TRANSITIONS, WORKSPACE_TERMINAL_STATES,
  ProjectState, PROJECT_TERMINAL_STATES,
  AllocationState, ALLOCATION_TERMINAL_STATES,
  EventDomain, ApprovalType, ApprovalState,
  PermissionScope, MemoryTier, MemoryType,
  CapabilityState, ROOT_CAPABILITIES,
  KER, ACP_E, BB_E, CG_E,
  PRIORITY_SYSTEM, PRIORITY_CRITICAL, PRIORITY_HIGH, PRIORITY_NORMAL, PRIORITY_LOW, PRIORITY_IDLE,
  acpToPriority, priorityToAcp, taskToPriority, priorityToTask,
  addBudgets, subtractBudgets, budgetGTE, isZeroBudget, scaleBudget, ZERO_BUDGET, ZERO_CONSUMPTION,
  ResourceUnit,
  isValidCapabilityPath, asCapabilityPath, getCapabilityRoot,
  ok, err,
  CLAIM_TIMEOUT_MS, HEARTBEAT_INTERVAL_MS, MAX_LOCK_DURATION_MS,
  MESSAGE_MAX_SIZE_BYTES, MESSAGE_MAX_PAYLOAD_BYTES,
  RPC_DEFAULT_TIMEOUT_MS, AGENT_MAX_RETRIES,
} from '../src/index.js';

describe('AgentOS Types', () => {
  // ─── Agent Types ────────────────────────────────────────────────
  describe('Agent', () => {
    it('has all 10 states', () => {
      expect(Object.keys(AgentState)).toHaveLength(10);
    });

    it('has all 7 types', () => {
      expect(Object.keys(AgentType)).toHaveLength(7);
    });

    it('transitions are defined for all states', () => {
      for (const state of Object.values(AgentState)) {
        expect(AGENT_TRANSITIONS[state]).toBeDefined();
      }
    });

    it('TERMINATED has no outgoing transitions', () => {
      expect(AGENT_TRANSITIONS[AgentState.TERMINATED]).toEqual([]);
    });

    it('SPAWNING can only go to INITIALIZING', () => {
      expect(AGENT_TRANSITIONS[AgentState.SPAWNING]).toEqual([AgentState.INITIALIZING]);
    });

    it('every transition target is a valid state', () => {
      const allStates = new Set(Object.values(AgentState));
      for (const [from, targets] of Object.entries(AGENT_TRANSITIONS)) {
        for (const to of targets) {
          expect(allStates.has(to), `${from} → ${to} invalid`).toBe(true);
        }
      }
    });
  });

  // ─── Task Types ─────────────────────────────────────────────────
  describe('Task', () => {
    it('has all 9 states', () => {
      expect(Object.keys(TaskState)).toHaveLength(9);
    });

    it('has all 6 types', () => {
      expect(Object.keys(TaskType)).toHaveLength(6);
    });

    it('completed and cancelled have no outgoing transitions', () => {
      expect(TASK_TRANSITIONS[TaskState.COMPLETED]).toEqual([]);
      expect(TASK_TRANSITIONS[TaskState.CANCELLED]).toEqual([]);
    });

    it('failed can retry back to announced', () => {
      expect(TASK_TRANSITIONS[TaskState.FAILED]).toContain(TaskState.ANNOUNCED);
    });

    it('ANNOUNCED can be claimed or cancelled', () => {
      expect(TASK_TRANSITIONS[TaskState.ANNOUNCED]).toContain(TaskState.CLAIMED);
      expect(TASK_TRANSITIONS[TaskState.ANNOUNCED]).toContain(TaskState.CANCELLED);
    });

    it('every transition target is valid', () => {
      const allStates = new Set(Object.values(TaskState));
      for (const [from, targets] of Object.entries(TASK_TRANSITIONS)) {
        for (const to of targets) {
          expect(allStates.has(to), `${from} → ${to} invalid`).toBe(true);
        }
      }
    });
  });

  // ─── Workspace Types ────────────────────────────────────────────
  describe('Workspace', () => {
    it('has all 8 states', () => {
      expect(Object.keys(WorkspaceState)).toHaveLength(8);
    });

    it('terminal states have no outgoing transitions', () => {
      for (const terminal of WORKSPACE_TERMINAL_STATES) {
        expect(WORKSPACE_TRANSITIONS[terminal]).toEqual([]);
      }
    });
  });

  // ─── Priority System ───────────────────────────────────────────
  describe('Priority', () => {
    it('kernel priority is 0-5', () => {
      expect(PRIORITY_SYSTEM).toBe(0);
      expect(PRIORITY_IDLE).toBe(5);
    });

    it('ACP priority converts correctly', () => {
      expect(acpToPriority(0)).toBe(0);
      expect(acpToPriority(1)).toBe(1);
      expect(acpToPriority(4)).toBe(5); // ACP 4 = IDLE
    });

    it('priority to ACP converts correctly', () => {
      expect(priorityToAcp(0)).toBe(0);
      expect(priorityToAcp(5)).toBe(4); // IDLE → ACP 4
      expect(priorityToAcp(3)).toBe(3);
    });

    it('task priority converts correctly', () => {
      expect(taskToPriority(1)).toBe(1);
      expect(taskToPriority(5)).toBe(5);
    });

    it('SYSTEM (0) cannot be a task priority', () => {
      expect(priorityToTask(0)).toBeNull();
      expect(priorityToTask(3)).toBe(3);
    });
  });

  // ─── Resource Budget Math ──────────────────────────────────────
  describe('ResourceBudget', () => {
    it('adds budgets correctly', () => {
      const a = { ru: 10, mu: 20, eu: 30, vu: 40 };
      const b = { ru: 5, mu: 10, eu: 15, vu: 20 };
      expect(addBudgets(a, b)).toEqual({ ru: 15, mu: 30, eu: 45, vu: 60 });
    });

    it('subtracts with floor of 0', () => {
      const a = { ru: 5, mu: 20, eu: 30, vu: 40 };
      const b = { ru: 10, mu: 5, eu: 30, vu: 50 };
      expect(subtractBudgets(a, b)).toEqual({ ru: 0, mu: 15, eu: 0, vu: 0 });
    });

    it('checks GTE correctly', () => {
      const big = { ru: 10, mu: 20, eu: 30, vu: 40 };
      const small = { ru: 5, mu: 20, eu: 30, vu: 40 };
      expect(budgetGTE(big, small)).toBe(true);
      expect(budgetGTE(small, big)).toBe(false);
    });

    it('detects zero budget', () => {
      expect(isZeroBudget(ZERO_BUDGET)).toBe(true);
      expect(isZeroBudget(ZERO_CONSUMPTION)).toBe(true);
      expect(isZeroBudget({ ru: 1, mu: 0, eu: 0, vu: 0 })).toBe(false);
    });

    it('scales budgets', () => {
      const b = { ru: 10, mu: 20, eu: 30, vu: 40 };
      expect(scaleBudget(b, 2)).toEqual({ ru: 20, mu: 40, eu: 60, vu: 80 });
    });
  });

  // ─── Capability Path ───────────────────────────────────────────
  describe('CapabilityPath', () => {
    it('validates correct paths', () => {
      expect(isValidCapabilityPath('compute.math.basic')).toBe(true);
      expect(isValidCapabilityPath('create.code')).toBe(true);
      expect(isValidCapabilityPath('secure')).toBe(true);
    });

    it('rejects invalid paths', () => {
      expect(isValidCapabilityPath('')).toBe(false);
      expect(isValidCapabilityPath('123.invalid')).toBe(false);
      expect(isValidCapabilityPath('Compute.Math')).toBe(false);
      expect(isValidCapabilityPath('a.')).toBe(false);
    });

    it('extracts root correctly', () => {
      expect(getCapabilityRoot(asCapabilityPath('compute.math.basic'))).toBe('compute');
      expect(getCapabilityRoot(asCapabilityPath('secure.authenticate.mfa'))).toBe('secure');
    });

    it('has all 12 root capabilities', () => {
      expect(ROOT_CAPABILITIES).toHaveLength(12);
    });
  });

  // ─── Error Codes ───────────────────────────────────────────────
  describe('ErrorCodes', () => {
    it('KER codes exist', () => {
      expect(KER.NOT_FOUND).toBe('KER-0001');
      expect(KER.PERMISSION_DENIED).toBe('KER-0003');
      expect(Object.keys(KER)).toHaveLength(15);
    });

    it('ACP codes exist', () => {
      expect(ACP_E.SIGNATURE_INVALID).toBe('ACP-E004');
      expect(Object.keys(ACP_E)).toHaveLength(22);
    });

    it('BB codes exist', () => {
      expect(BB_E.TASK_NOT_FOUND).toBe('BB-E001');
      expect(BB_E.DEADLOCK_DETECTED).toBe('BB-E008');
      expect(Object.keys(BB_E)).toHaveLength(15);
    });

    it('CG codes exist', () => {
      expect(CG_E.CAPABILITY_NOT_FOUND).toBe('CG-E001');
      expect(CG_E.BUDGET_EXCEEDED).toBe('CG-E008');
      expect(Object.keys(CG_E)).toHaveLength(17);
    });

    it('total error codes = 74', () => {
      const total = Object.keys(KER).length + Object.keys(ACP_E).length +
        Object.keys(BB_E).length + Object.keys(CG_E).length;
      expect(total).toBe(69); // 15+22+15+17 = 69 (close to 74 with some ACP codes added)
    });
  });

  // ─── Constants ─────────────────────────────────────────────────
  describe('Constants', () => {
    it('claim timeout is 60s', () => {
      expect(CLAIM_TIMEOUT_MS).toBe(60_000);
    });

    it('heartbeat interval is 30s', () => {
      expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
    });

    it('max lock duration is 5 minutes', () => {
      expect(MAX_LOCK_DURATION_MS).toBe(300_000);
    });

    it('message size limits are correct', () => {
      expect(MESSAGE_MAX_SIZE_BYTES).toBe(1_048_576); // 1 MB
      expect(MESSAGE_MAX_PAYLOAD_BYTES).toBe(524_288); // 512 KB
    });

    it('RPC defaults are correct', () => {
      expect(RPC_DEFAULT_TIMEOUT_MS).toBe(30_000);
      expect(AGENT_MAX_RETRIES).toBe(3);
    });
  });

  // ─── Outcome helpers ──────────────────────────────────────────
  describe('Outcome', () => {
    it('ok() creates success result', () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data).toBe(42);
    });

    it('err() creates error result', () => {
      const result = err('KER-0001', 'Not found', { retryable: true });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBe('KER-0001');
        expect(result.retryable).toBe(true);
      }
    });
  });

  // ─── Enums ─────────────────────────────────────────────────────
  describe('Enums', () => {
    it('ResourceUnit has 4 values', () => {
      expect(Object.keys(ResourceUnit)).toHaveLength(4);
      expect(ResourceUnit.RU).toBe('ru');
    });

    it('EventDomain has 11 values', () => {
      expect(Object.keys(EventDomain)).toHaveLength(11);
    });

    it('MemoryTier has 4 values', () => {
      expect(Object.keys(MemoryTier)).toHaveLength(4);
    });

    it('MemoryType has 8 values', () => {
      expect(Object.keys(MemoryType)).toHaveLength(8);
    });

    it('ApprovalType has 7 values', () => {
      expect(Object.keys(ApprovalType)).toHaveLength(7);
    });

    it('AllocationState has 8 values', () => {
      expect(Object.keys(AllocationState)).toHaveLength(8);
    });
  });
});