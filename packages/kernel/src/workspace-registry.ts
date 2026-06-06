/**
 * @agentos/kernel — Workspace Registry
 * In-memory registry of all workspaces.
 * ZERO AI logic — deterministic lookups and mutations only.
 */

import { ok, err, KER } from '@agentos/types';
import type { Outcome, Workspace, WorkspaceID } from '@agentos/types';

// ─── Workspace Registry ─────────────────────────────────────────────

export class WorkspaceRegistry {
  private workspaces: Map<string, Workspace> = new Map();

  /** Create/register a new workspace. */
  create(workspace: Workspace): Outcome<Workspace> {
    if (this.workspaces.has(workspace.id)) {
      return err(KER.ALREADY_EXISTS, `Workspace with id "${workspace.id}" already exists`, {
        retryable: false,
      });
    }
    this.workspaces.set(workspace.id, { ...workspace });
    return ok({ ...workspace });
  }

  /** Get a workspace by ID. Returns undefined if not found. */
  get(workspaceId: WorkspaceID): Workspace | undefined {
    const ws = this.workspaces.get(workspaceId);
    return ws ? { ...ws } : undefined;
  }

  /** List workspaces. */
  list(): Workspace[] {
    return Array.from(this.workspaces.values()).map((w) => ({ ...w }));
  }

  /** Update a workspace with a partial patch. */
  update(workspaceId: WorkspaceID, patch: Partial<Workspace>): Outcome<Workspace> {
    const existing = this.workspaces.get(workspaceId);
    if (!existing) {
      return err(KER.WORKSPACE_NOT_FOUND, `Workspace "${workspaceId}" not found`, {
        retryable: false,
      });
    }
    const updated = { ...existing, ...patch, id: existing.id }; // ID is immutable
    this.workspaces.set(workspaceId, updated);
    return ok({ ...updated });
  }

  /** Delete a workspace by ID. */
  delete(workspaceId: WorkspaceID): Outcome<true> {
    if (!this.workspaces.has(workspaceId)) {
      return err(KER.WORKSPACE_NOT_FOUND, `Workspace "${workspaceId}" not found`, {
        retryable: false,
      });
    }
    this.workspaces.delete(workspaceId);
    return ok(true);
  }

  /** Get the number of registered workspaces. */
  size(): number {
    return this.workspaces.size;
  }

  /** Clear all workspaces. */
  clear(): void {
    this.workspaces.clear();
  }
}