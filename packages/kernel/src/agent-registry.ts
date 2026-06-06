/**
 * @agentos/kernel — Agent Registry
 * In-memory registry of all agents.
 * ZERO AI logic — deterministic lookups and mutations only.
 */

import { ok, err, KER } from '@agentos/types';
import type { Outcome, Agent, AgentID, WorkspaceID, AgentState, CapabilityID } from '@agentos/types';

// ─── Agent Registry ──────────────────────────────────────────────────

export class AgentRegistry {
  private agents: Map<string, Agent> = new Map();

  /** Register a new agent. Rejects if an agent with the same ID already exists. */
  register(agent: Agent): Outcome<Agent> {
    if (this.agents.has(agent.id)) {
      return err(KER.ALREADY_EXISTS, `Agent with id "${agent.id}" already registered`, {
        retryable: false,
      });
    }
    this.agents.set(agent.id, { ...agent });
    return ok({ ...agent });
  }

  /** Deregister an agent by ID. */
  deregister(agentId: AgentID): Outcome<true> {
    if (!this.agents.has(agentId)) {
      return err(KER.AGENT_NOT_FOUND, `Agent "${agentId}" not found`, {
        retryable: false,
      });
    }
    this.agents.delete(agentId);
    return ok(true);
  }

  /** Get an agent by ID. Returns undefined if not found. */
  get(agentId: AgentID): Agent | undefined {
    const agent = this.agents.get(agentId);
    return agent ? { ...agent } : undefined;
  }

  /** List agents, optionally filtered. */
  list(filter?: { workspace_id?: WorkspaceID; state?: AgentState; capability?: string }): Agent[] {
    let result = Array.from(this.agents.values());

    if (filter?.workspace_id) {
      result = result.filter((a) => a.workspace_id === filter.workspace_id);
    }
    if (filter?.state) {
      result = result.filter((a) => a.state === filter.state);
    }
    if (filter?.capability) {
      result = result.filter((a) => a.capabilities.includes(filter.capability as unknown as CapabilityID));
    }

    return result.map((a) => ({ ...a }));
  }

  /** Update an agent with a partial patch. */
  update(agentId: AgentID, patch: Partial<Agent>): Outcome<Agent> {
    const existing = this.agents.get(agentId);
    if (!existing) {
      return err(KER.AGENT_NOT_FOUND, `Agent "${agentId}" not found`, {
        retryable: false,
      });
    }
    const updated = { ...existing, ...patch, id: existing.id }; // ID is immutable
    this.agents.set(agentId, updated);
    return ok({ ...updated });
  }

  /** Find agents by workspace. */
  findByWorkspace(workspaceId: WorkspaceID): Agent[] {
    return this.list({ workspace_id: workspaceId });
  }

  /** Find agents by capability. */
  findByCapability(capability: string): Agent[] {
    return this.list({ capability });
  }

  /** Find agents by state. */
  findByState(state: AgentState): Agent[] {
    return this.list({ state });
  }

  /** Get the number of registered agents. */
  size(): number {
    return this.agents.size;
  }

  /** Clear all agents. */
  clear(): void {
    this.agents.clear();
  }
}