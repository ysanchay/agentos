/**
 * @agentos/resources — Conservation Invariant Enforcement
 * 7 conservation laws from resource-model-v1.md Section 3.4.
 *
 * 1. RU conservation: sum(consumed) <= total_ru
 * 2. MU conservation
 * 3. EU conservation
 * 4. VU conservation
 * 5. Per-agent: consumed <= allocated for every type
 * 6. Non-negative: all counts >= 0
 * 7. No double-counting
 */

import type { ResourceBudget, ResourceConsumption, Outcome } from '@agentos/types';
import { ok, err, KER } from '@agentos/types';
import type { AllocationRecord } from './allocator.js';

// ─── Conservation Violation ──────────────────────────────────────────

export interface ConservationViolation {
  law: string;
  message: string;
  details?: unknown;
}

export interface ConservationResult {
  valid: boolean;
  violations: ConservationViolation[];
}

// ─── Conservation Laws ────────────────────────────────────────────────

export class ConservationEnforcer {
  /**
   * Enforce all 7 conservation laws against a set of allocations.
   * totalCapacity is the total system capacity.
   */
  enforce(
    allocations: AllocationRecord[],
    totalCapacity: ResourceBudget,
  ): ConservationResult {
    const violations: ConservationViolation[] = [];

    // Law 1: RU conservation
    this.checkUnitConservation(allocations, totalCapacity.ru, 'ru', violations);

    // Law 2: MU conservation
    this.checkUnitConservation(allocations, totalCapacity.mu, 'mu', violations);

    // Law 3: EU conservation
    this.checkUnitConservation(allocations, totalCapacity.eu, 'eu', violations);

    // Law 4: VU conservation
    this.checkUnitConservation(allocations, totalCapacity.vu, 'vu', violations);

    // Law 5: Per-agent: consumed <= allocated for every type
    this.checkPerAgentConservation(allocations, violations);

    // Law 6: Non-negative: all counts >= 0
    this.checkNonNegative(allocations, violations);

    // Law 7: No double-counting (each allocation counted once)
    this.checkNoDoubleCounting(allocations, violations);

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  /**
   * Quick check: verify that a single allocation doesn't violate per-agent conservation.
   */
  checkAllocation(allocation: AllocationRecord): ConservationResult {
    const violations: ConservationViolation[] = [];

    // Per-agent conservation
    this.checkSingleAgentConservation(allocation, violations);

    // Non-negative
    this.checkSingleNonNegative(allocation, violations);

    return {
      valid: violations.length === 0,
      violations,
    };
  }

  /**
   * Verify that adding a new allocation won't exceed total capacity.
   */
  checkCapacity(
    existingAllocations: AllocationRecord[],
    newAllocation: AllocationRecord,
    totalCapacity: ResourceBudget,
  ): ConservationResult {
    // Include the new allocation in the check
    const all = [...existingAllocations, newAllocation];
    return this.enforce(all, totalCapacity);
  }

  // ─── Private Helpers ────────────────────────────────────────────────

  /**
   * Laws 1-4: sum(allocated) <= total for each unit type.
   */
  private checkUnitConservation(
    allocations: AllocationRecord[],
    total: number,
    unit: 'ru' | 'mu' | 'eu' | 'vu',
    violations: ConservationViolation[],
  ): void {
    if (total <= 0) return; // No capacity defined

    const allocatedKey = `${unit}_allocated` as const;
    const sumAllocated = allocations.reduce((sum, a) => sum + a[allocatedKey], 0);

    if (sumAllocated > total) {
      violations.push({
        law: `${unit.toUpperCase()}_CONSERVATION`,
        message: `Total ${unit} allocated (${sumAllocated}) exceeds capacity (${total})`,
        details: { unit, sumAllocated, total },
      });
    }
  }

  /**
   * Law 5: Per-agent, consumed <= allocated for every type.
   */
  private checkPerAgentConservation(
    allocations: AllocationRecord[],
    violations: ConservationViolation[],
  ): void {
    for (const alloc of allocations) {
      this.checkSingleAgentConservation(alloc, violations);
    }
  }

  private checkSingleAgentConservation(
    alloc: AllocationRecord,
    violations: ConservationViolation[],
  ): void {
    if (alloc.ru_consumed > alloc.ru_allocated) {
      violations.push({
        law: 'PER_AGENT_CONSERVATION',
        message: `Agent ${alloc.agent_id}: RU consumed (${alloc.ru_consumed}) > allocated (${alloc.ru_allocated})`,
      });
    }
    if (alloc.mu_consumed > alloc.mu_allocated) {
      violations.push({
        law: 'PER_AGENT_CONSERVATION',
        message: `Agent ${alloc.agent_id}: MU consumed (${alloc.mu_consumed}) > allocated (${alloc.mu_allocated})`,
      });
    }
    if (alloc.eu_consumed > alloc.eu_allocated) {
      violations.push({
        law: 'PER_AGENT_CONSERVATION',
        message: `Agent ${alloc.agent_id}: EU consumed (${alloc.eu_consumed}) > allocated (${alloc.eu_allocated})`,
      });
    }
    if (alloc.vu_consumed > alloc.vu_allocated) {
      violations.push({
        law: 'PER_AGENT_CONSERVATION',
        message: `Agent ${alloc.agent_id}: VU consumed (${alloc.vu_consumed}) > allocated (${alloc.vu_allocated})`,
      });
    }
  }

  /**
   * Law 6: Non-negative — all counts >= 0.
   */
  private checkNonNegative(
    allocations: AllocationRecord[],
    violations: ConservationViolation[],
  ): void {
    for (const alloc of allocations) {
      this.checkSingleNonNegative(alloc, violations);
    }
  }

  private checkSingleNonNegative(
    alloc: AllocationRecord,
    violations: ConservationViolation[],
  ): void {
    const fields = [
      'ru_allocated', 'mu_allocated', 'eu_allocated', 'vu_allocated',
      'ru_consumed', 'mu_consumed', 'eu_consumed', 'vu_consumed',
    ] as const;

    for (const field of fields) {
      if (alloc[field] < 0) {
        violations.push({
          law: 'NON_NEGATIVE',
          message: `Agent ${alloc.agent_id}: ${field} is negative (${alloc[field]})`,
        });
      }
    }
  }

  /**
   * Law 7: No double-counting — each allocation ID appears only once.
   */
  private checkNoDoubleCounting(
    allocations: AllocationRecord[],
    violations: ConservationViolation[],
  ): void {
    const seen = new Set<string>();
    for (const alloc of allocations) {
      const id = alloc.id as string;
      if (seen.has(id)) {
        violations.push({
          law: 'NO_DOUBLE_COUNTING',
          message: `Allocation ${id} appears more than once`,
        });
      }
      seen.add(id);
    }
  }
}