/**
 * @agentos/kernel — Workspace State Machine
 * 8 states from the constitution.
 * ZERO AI logic — all transitions are deterministic based on explicit inputs and guards.
 */

import { WorkspaceState, KER } from '@agentos/types';
import type { Outcome } from '@agentos/types';
import { ok, err } from '@agentos/types';
import { GenericStateMachine, type TransitionDef } from './state-machine.js';

// ─── Workspace Transition Context ────────────────────────────────────

export interface WorkspaceTransitionContext {
  agentsSpawned?: boolean;
  resourcesAllocated?: boolean;
  initFailed?: boolean;
  budgetExhausted?: boolean;
  adminPause?: boolean;
  securityIncident?: boolean;
  archiveRequest?: boolean;
  budgetRestored?: boolean;
  incidentResolved?: boolean;
  irrecoverable?: boolean;
  agentsTerminated?: boolean;
  adminRestore?: boolean;
  deleteRequest?: boolean;
}

// ─── Workspace State Machine ─────────────────────────────────────────

export class WorkspaceStateMachine {
  private machine: GenericStateMachine<WorkspaceState, WorkspaceTransitionContext>;

  constructor(onTransition?: (from: WorkspaceState, to: WorkspaceState, ctx?: WorkspaceTransitionContext) => void) {
    const transitions: TransitionDef<WorkspaceState, WorkspaceTransitionContext>[] = [
      // creating -> active: agents spawned, resources allocated
      {
        from: WorkspaceState.CREATING,
        to: WorkspaceState.ACTIVE,
        guard: (ctx) => ctx?.agentsSpawned === true && ctx?.resourcesAllocated === true,
      },
      // creating -> deleting: init failed
      {
        from: WorkspaceState.CREATING,
        to: WorkspaceState.DELETING,
        guard: (ctx) => ctx?.initFailed === true,
      },
      // active -> paused: budget exhausted or admin
      {
        from: WorkspaceState.ACTIVE,
        to: WorkspaceState.PAUSED,
        guard: (ctx) => ctx?.budgetExhausted === true || ctx?.adminPause === true,
      },
      // active -> locked: security incident
      {
        from: WorkspaceState.ACTIVE,
        to: WorkspaceState.LOCKED,
        guard: (ctx) => ctx?.securityIncident === true,
      },
      // active -> archiving: archive request
      {
        from: WorkspaceState.ACTIVE,
        to: WorkspaceState.ARCHIVING,
        guard: (ctx) => ctx?.archiveRequest === true,
      },
      // paused -> active: budget restored
      {
        from: WorkspaceState.PAUSED,
        to: WorkspaceState.ACTIVE,
        guard: (ctx) => ctx?.budgetRestored === true,
      },
      // paused -> archiving: archive request while paused
      {
        from: WorkspaceState.PAUSED,
        to: WorkspaceState.ARCHIVING,
        guard: (ctx) => ctx?.archiveRequest === true,
      },
      // locked -> active: incident resolved
      {
        from: WorkspaceState.LOCKED,
        to: WorkspaceState.ACTIVE,
        guard: (ctx) => ctx?.incidentResolved === true,
      },
      // locked -> archiving: admin archives locked workspace
      {
        from: WorkspaceState.LOCKED,
        to: WorkspaceState.ARCHIVING,
        guard: (ctx) => ctx?.archiveRequest === true,
      },
      // locked -> deleting: irrecoverable
      {
        from: WorkspaceState.LOCKED,
        to: WorkspaceState.DELETING,
        guard: (ctx) => ctx?.irrecoverable === true,
      },
      // archiving -> archived: agents terminated
      {
        from: WorkspaceState.ARCHIVING,
        to: WorkspaceState.ARCHIVED,
        guard: (ctx) => ctx?.agentsTerminated === true,
      },
      // archived -> active: admin restores
      {
        from: WorkspaceState.ARCHIVED,
        to: WorkspaceState.ACTIVE,
        guard: (ctx) => ctx?.adminRestore === true,
      },
      // archived -> deleting: delete request
      {
        from: WorkspaceState.ARCHIVED,
        to: WorkspaceState.DELETING,
        guard: (ctx) => ctx?.deleteRequest === true,
      },
      // deleting -> deleted: deletion complete
      {
        from: WorkspaceState.DELETING,
        to: WorkspaceState.DELETED,
      },
    ];

    this.machine = new GenericStateMachine(
      WorkspaceState.CREATING,
      transitions,
      [WorkspaceState.DELETED],
      onTransition,
    );
  }

  /** Attempt a state transition. */
  transition(from: WorkspaceState, to: WorkspaceState, ctx?: WorkspaceTransitionContext): Outcome<WorkspaceState> {
    return this.machine.transition(from, to, ctx);
  }

  /** Check if a transition is possible. */
  canTransition(from: WorkspaceState, to: WorkspaceState, ctx?: WorkspaceTransitionContext): boolean {
    return this.machine.canTransition(from, to, ctx);
  }

  /** Get the current workspace state. */
  getCurrentState(): WorkspaceState {
    return this.machine.getCurrentState();
  }

  /** Get transition history. */
  getHistory() {
    return this.machine.getHistory();
  }

  /** Check if the workspace is in a terminal state. */
  isTerminal(): boolean {
    return this.machine.isTerminal();
  }

  /** Reset the state machine. */
  reset(): void {
    this.machine.reset(WorkspaceState.CREATING);
  }
}