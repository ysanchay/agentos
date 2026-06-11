/**
 * @agentos/capabilities — Consumption Tracker
 * Tracks resource consumption per invocation and aggregates
 * totals per agent, workspace, and capability path.
 */

import type { ResourceConsumption, AgentID, WorkspaceID, CapabilityPath, InvocationID } from '@agentos/types';
import { ZERO_CONSUMPTION } from '@agentos/types';

/** Add two ResourceConsumption values (same shape as ResourceBudget). */
function addConsumptions(a: ResourceConsumption, b: ResourceConsumption): ResourceConsumption {
  return {
    ru: a.ru + b.ru,
    mu: a.mu + b.mu,
    eu: a.eu + b.eu,
    vu: a.vu + b.vu,
  };
}

export interface ConsumptionRecord {
  invocationId: InvocationID;
  agentId: AgentID;
  workspaceId: WorkspaceID;
  capabilityPath: CapabilityPath;
  consumed: ResourceConsumption;
  timestamp: number;
}

export class ConsumptionTracker {
  private records: ConsumptionRecord[] = [];
  private agentTotals: Map<string, ResourceConsumption> = new Map();
  private workspaceTotals: Map<string, ResourceConsumption> = new Map();
  private pathTotals: Map<string, ResourceConsumption> = new Map();

  /**
   * Record consumption from a completed invocation.
   */
  record(
    invocationId: InvocationID,
    agentId: AgentID,
    workspaceId: WorkspaceID,
    capabilityPath: CapabilityPath,
    consumed: ResourceConsumption,
    timestamp: number = Date.now(),
  ): void {
    const record: ConsumptionRecord = {
      invocationId,
      agentId,
      workspaceId,
      capabilityPath,
      consumed,
      timestamp,
    };

    this.records.push(record);

    // Aggregate by agent
    const agentKey = agentId as string;
    const existingAgent = this.agentTotals.get(agentKey) ?? { ...ZERO_CONSUMPTION };
    this.agentTotals.set(agentKey, addConsumptions(existingAgent, consumed));

    // Aggregate by workspace
    const wsKey = workspaceId as string;
    const existingWs = this.workspaceTotals.get(wsKey) ?? { ...ZERO_CONSUMPTION };
    this.workspaceTotals.set(wsKey, addConsumptions(existingWs, consumed));

    // Aggregate by capability path
    const pathKey = capabilityPath as string;
    const existingPath = this.pathTotals.get(pathKey) ?? { ...ZERO_CONSUMPTION };
    this.pathTotals.set(pathKey, addConsumptions(existingPath, consumed));
  }

  /**
   * Get total consumption for an agent.
   */
  getByAgent(agentId: AgentID): ResourceConsumption {
    return this.agentTotals.get(agentId as string) ?? { ...ZERO_CONSUMPTION };
  }

  /**
   * Get total consumption for a workspace.
   */
  getByWorkspace(workspaceId: WorkspaceID): ResourceConsumption {
    return this.workspaceTotals.get(workspaceId as string) ?? { ...ZERO_CONSUMPTION };
  }

  /**
   * Get total consumption for a capability path.
   */
  getByPath(capabilityPath: CapabilityPath): ResourceConsumption {
    return this.pathTotals.get(capabilityPath as string) ?? { ...ZERO_CONSUMPTION };
  }

  /**
   * Get all consumption records.
   */
  getRecords(): ReadonlyArray<ConsumptionRecord> {
    return this.records;
  }

  /**
   * Get total consumption across all invocations.
   */
  getTotal(): ResourceConsumption {
    let total: ResourceConsumption = { ...ZERO_CONSUMPTION };
    for (const record of this.records) {
      total = addConsumptions(total, record.consumed);
    }
    return total;
  }

  /**
   * Get the number of recorded invocations.
   */
  get count(): number {
    return this.records.length;
  }

  /**
   * Reset all tracking data.
   */
  reset(): void {
    this.records = [];
    this.agentTotals.clear();
    this.workspaceTotals.clear();
    this.pathTotals.clear();
  }
}