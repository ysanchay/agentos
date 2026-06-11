/**
 * @agentos/capabilities — Production Security Policy
 * Deny-by-default security policy for real-world execution.
 * Shell exec and filesystem write always require approval.
 * HTTP POST/DELETE require approval. Database mutation requires approval.
 */

import type { CapabilityPath } from '@agentos/types';
import type { SecurityPolicy, CapabilityRule } from './types.js';

// ─── Capability Path Prefixes ────────────────────────────────────────────────

const ALLOWED_PATHS: Array<{ path: string; maxInvocationsPerHour?: number }> = [
  // Read-only operations — allowed without approval
  { path: 'actuate.filesystem.read', maxInvocationsPerHour: 600 },
  { path: 'actuate.filesystem.list', maxInvocationsPerHour: 600 },
  { path: 'actuate.filesystem.stat', maxInvocationsPerHour: 600 },
  // HTTP read operations
  { path: 'communicate.http.get', maxInvocationsPerHour: 300 },
  { path: 'communicate.http.head', maxInvocationsPerHour: 300 },
  // LLM/model operations
  { path: 'reason.model.complete', maxInvocationsPerHour: 100 },
  { path: 'reason.model.chat', maxInvocationsPerHour: 100 },
  { path: 'reason.model.embed', maxInvocationsPerHour: 200 },
  // MCP tool operations (compute)
  { path: 'compute.mcp', maxInvocationsPerHour: 200 },
  // MCP resource operations (read-only)
  { path: 'remember.mcp', maxInvocationsPerHour: 300 },
  // MCP prompt operations
  { path: 'reason.mcp', maxInvocationsPerHour: 100 },
  // Browser observe operations (read-only, no side effects)
  { path: 'perceive.browser.screenshot', maxInvocationsPerHour: 100 },
  { path: 'perceive.browser.extract', maxInvocationsPerHour: 200 },
  { path: 'perceive.browser.query', maxInvocationsPerHour: 300 },
  { path: 'perceive.browser.wait', maxInvocationsPerHour: 100 },
  // Desktop observe operations (read-only, no side effects)
  { path: 'perceive.desktop.screenshot', maxInvocationsPerHour: 100 },
  { path: 'perceive.desktop.tree', maxInvocationsPerHour: 50 },
  { path: 'perceive.desktop.query', maxInvocationsPerHour: 200 },
  { path: 'perceive.desktop.read', maxInvocationsPerHour: 300 },
];

const APPROVAL_REQUIRED_PATHS: CapabilityPath[] = [
  // Filesystem mutations
  'actuate.filesystem.write' as CapabilityPath,
  'actuate.filesystem.delete' as CapabilityPath,
  // Shell execution (always requires approval)
  'actuate.shell' as CapabilityPath,
  // HTTP mutations
  'communicate.http.post' as CapabilityPath,
  'communicate.http.put' as CapabilityPath,
  'communicate.http.delete' as CapabilityPath,
  // Database mutations
  'remember.database.mutate' as CapabilityPath,
  // Browser navigation (side effects: page changes, form submissions)
  'navigate.browser.goto' as CapabilityPath,
  'navigate.browser.click' as CapabilityPath,
  'navigate.browser.type' as CapabilityPath,
  'navigate.browser.select' as CapabilityPath,
  // Desktop interaction (side effects: app control)
  'actuate.desktop' as CapabilityPath,
];

const RESTRICTED_PATHS: CapabilityPath[] = [
  'actuate.dangerous' as CapabilityPath,     // Dangerous operations namespace
];

/**
 * Create a production-ready security policy with deny-by-default stance.
 */
export function createProductionPolicy(overrides?: Partial<{
  maxInvocationsPerHour: number;
  maxConcurrent: number;
  maxRuPerHour: number;
  maxMuPerHour: number;
  maxInputSizeBytes: number;
  maxOutputSizeBytes: number;
}>): SecurityPolicy {
  const capabilityRules = new Map<CapabilityPath, CapabilityRule>();

  // Add allowed capability rules
  for (const entry of ALLOWED_PATHS) {
    capabilityRules.set(entry.path as CapabilityPath, {
      path: entry.path as CapabilityPath,
      allowed: true,
      maxInvocationsPerHour: entry.maxInvocationsPerHour,
    });
  }

  // Add shell exec as allowed-but-requires-approval
  capabilityRules.set('actuate.shell' as CapabilityPath, {
    path: 'actuate.shell' as CapabilityPath,
    allowed: true,
    requireApproval: true,
    maxInvocationsPerHour: 50,
  });

  // Add filesystem write as allowed-but-requires-approval
  capabilityRules.set('actuate.filesystem.write' as CapabilityPath, {
    path: 'actuate.filesystem.write' as CapabilityPath,
    allowed: true,
    requireApproval: true,
    maxInvocationsPerHour: 50,
  });

  capabilityRules.set('actuate.filesystem.delete' as CapabilityPath, {
    path: 'actuate.filesystem.delete' as CapabilityPath,
    allowed: true,
    requireApproval: true,
    maxInvocationsPerHour: 20,
  });

  // Add HTTP mutation rules
  capabilityRules.set('communicate.http.post' as CapabilityPath, {
    path: 'communicate.http.post' as CapabilityPath,
    allowed: true,
    requireApproval: true,
    maxInvocationsPerHour: 50,
  });

  capabilityRules.set('communicate.http.put' as CapabilityPath, {
    path: 'communicate.http.put' as CapabilityPath,
    allowed: true,
    requireApproval: true,
    maxInvocationsPerHour: 50,
  });

  capabilityRules.set('communicate.http.delete' as CapabilityPath, {
    path: 'communicate.http.delete' as CapabilityPath,
    allowed: true,
    requireApproval: true,
    maxInvocationsPerHour: 20,
  });

  // Add browser navigation rules (allowed but requires approval — side effects)
  capabilityRules.set('navigate.browser' as CapabilityPath, {
    path: 'navigate.browser' as CapabilityPath,
    allowed: true,
    requireApproval: true,
    maxInvocationsPerHour: 50,
  });

  // Add desktop interaction rules (allowed but requires approval — high privilege)
  capabilityRules.set('actuate.desktop' as CapabilityPath, {
    path: 'actuate.desktop' as CapabilityPath,
    allowed: true,
    requireApproval: true,
    maxInvocationsPerHour: 30,
  });

  // Add approval-required capability rules
  for (const path of APPROVAL_REQUIRED_PATHS) {
    capabilityRules.set(path, {
      path,
      allowed: true,
      requireApproval: true,
      maxInvocationsPerHour: 50,
    });
  }

  return {
    defaultAction: 'deny',
    capabilityRules,
    globalRateLimit: {
      maxInvocationsPerHour: overrides?.maxInvocationsPerHour ?? 1000,
      maxConcurrent: overrides?.maxConcurrent ?? 10,
    },
    budgetLimits: {
      maxRuPerHour: overrides?.maxRuPerHour ?? 5000,
      maxMuPerHour: overrides?.maxMuPerHour ?? 2000,
    },
    approvalRequired: APPROVAL_REQUIRED_PATHS,
    restricted: RESTRICTED_PATHS,
    maxInputSizeBytes: overrides?.maxInputSizeBytes ?? 1_000_000,  // 1MB
    maxOutputSizeBytes: overrides?.maxOutputSizeBytes ?? 10_000_000, // 10MB
  };
}

/**
 * Create a permissive development policy that allows all capabilities
 * without approval. Useful for testing and local development only.
 */
export function createDevelopmentPolicy(): SecurityPolicy {
  const capabilityRules = new Map<CapabilityPath, CapabilityRule>();

  // Allow all known capability roots
  const roots = ['actuate', 'communicate', 'remember', 'reason', 'compute', 'perceive', 'navigate'];
  for (const root of roots) {
    capabilityRules.set(root as CapabilityPath, {
      path: root as CapabilityPath,
      allowed: true,
    });
  }

  return {
    defaultAction: 'allow',
    capabilityRules,
    globalRateLimit: {
      maxInvocationsPerHour: 10_000,
      maxConcurrent: 50,
    },
    budgetLimits: {
      maxRuPerHour: 100_000,
      maxMuPerHour: 50_000,
    },
    approvalRequired: [],  // No approval required in dev
    restricted: [],
    maxInputSizeBytes: 10_000_000,  // 10MB
    maxOutputSizeBytes: 100_000_000, // 100MB
  };
}