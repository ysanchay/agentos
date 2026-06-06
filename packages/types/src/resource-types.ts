/**
 * AgentOS Resource Types
 * The 4 fundamental resource units: RU, MU, EU, VU
 */

/** The 4 fundamental resource unit types */
export enum ResourceUnit {
  RU = 'ru',
  MU = 'mu',
  EU = 'eu',
  VU = 'vu',
}

/** Resource budget — allocated or requested resources */
export interface ResourceBudget {
  ru: number;
  mu: number;
  eu: number;
  vu: number;
}

/** Resource consumption — actually consumed resources */
export interface ResourceConsumption {
  ru: number;
  mu: number;
  eu: number;
  vu: number;
}

/** Empty/zero resource budget */
export const ZERO_BUDGET: ResourceBudget = Object.freeze({ ru: 0, mu: 0, eu: 0, vu: 0 });

/** Empty/zero resource consumption */
export const ZERO_CONSUMPTION: ResourceConsumption = Object.freeze({ ru: 0, mu: 0, eu: 0, vu: 0 });

/** Add two resource budgets */
export function addBudgets(a: ResourceBudget, b: ResourceBudget): ResourceBudget {
  return { ru: a.ru + b.ru, mu: a.mu + b.mu, eu: a.eu + b.eu, vu: a.vu + b.vu };
}

/** Subtract b from a (returns 0 floor per unit) */
export function subtractBudgets(a: ResourceBudget, b: ResourceBudget): ResourceBudget {
  return {
    ru: Math.max(0, a.ru - b.ru),
    mu: Math.max(0, a.mu - b.mu),
    eu: Math.max(0, a.eu - b.eu),
    vu: Math.max(0, a.vu - b.vu),
  };
}

/** Check if budget a >= budget b for all units */
export function budgetGTE(a: ResourceBudget, b: ResourceBudget): boolean {
  return a.ru >= b.ru && a.mu >= b.mu && a.eu >= b.eu && a.vu >= b.vu;
}

/** Check if budget is zero */
export function isZeroBudget(b: ResourceBudget): boolean {
  return b.ru === 0 && b.mu === 0 && b.eu === 0 && b.vu === 0;
}

/** Scale a budget by a multiplier */
export function scaleBudget(b: ResourceBudget, factor: number): ResourceBudget {
  return { ru: b.ru * factor, mu: b.mu * factor, eu: b.eu * factor, vu: b.vu * factor };
}