/**
 * @agentos/capabilities — Production Policy Tests
 * Tests createProductionPolicy and createDevelopmentPolicy.
 */

import { describe, it, expect } from 'vitest';
import { createProductionPolicy, createDevelopmentPolicy } from '../src/production-policy.js';
import type { CapabilityPath } from '@agentos/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function cpath(p: string): CapabilityPath { return p as CapabilityPath; }

// ═══════════════════════════════════════════════════════════════════════════

describe('createProductionPolicy', () => {
  it('should have defaultAction deny', () => {
    const policy = createProductionPolicy();
    expect(policy.defaultAction).toBe('deny');
  });

  it('should allow read-only filesystem paths without approval', () => {
    const policy = createProductionPolicy();

    const readPaths = [
      'actuate.filesystem.read',
      'actuate.filesystem.list',
      'actuate.filesystem.stat',
    ] as CapabilityPath[];

    for (const path of readPaths) {
      const rule = policy.capabilityRules.get(path);
      expect(rule, `Rule for ${path} should exist`).toBeDefined();
      expect(rule!.allowed, `${path} should be allowed`).toBe(true);
      expect(rule!.requireApproval, `${path} should not require approval`).toBeUndefined();
    }
  });

  it('should allow HTTP read operations without approval', () => {
    const policy = createProductionPolicy();

    const httpReadPaths = [
      'communicate.http.get',
      'communicate.http.head',
    ] as CapabilityPath[];

    for (const path of httpReadPaths) {
      const rule = policy.capabilityRules.get(path);
      expect(rule, `Rule for ${path} should exist`).toBeDefined();
      expect(rule!.allowed, `${path} should be allowed`).toBe(true);
      expect(rule!.requireApproval, `${path} should not require approval`).toBeUndefined();
    }
  });

  it('should allow reason.model operations without approval', () => {
    const policy = createProductionPolicy();

    const modelPaths = [
      'reason.model.complete',
      'reason.model.chat',
      'reason.model.embed',
    ] as CapabilityPath[];

    for (const path of modelPaths) {
      const rule = policy.capabilityRules.get(path);
      expect(rule, `Rule for ${path} should exist`).toBeDefined();
      expect(rule!.allowed, `${path} should be allowed`).toBe(true);
      expect(rule!.requireApproval, `${path} should not require approval`).toBeUndefined();
    }
  });

  it('should require approval for shell execution', () => {
    const policy = createProductionPolicy();
    const rule = policy.capabilityRules.get(cpath('actuate.shell'));
    expect(rule, 'Shell rule should exist').toBeDefined();
    expect(rule!.allowed).toBe(true);
    expect(rule!.requireApproval).toBe(true);
  });

  it('should require approval for filesystem write and delete', () => {
    const policy = createProductionPolicy();

    const writeRule = policy.capabilityRules.get(cpath('actuate.filesystem.write'));
    expect(writeRule, 'Filesystem write rule should exist').toBeDefined();
    expect(writeRule!.allowed).toBe(true);
    expect(writeRule!.requireApproval).toBe(true);

    const deleteRule = policy.capabilityRules.get(cpath('actuate.filesystem.delete'));
    expect(deleteRule, 'Filesystem delete rule should exist').toBeDefined();
    expect(deleteRule!.allowed).toBe(true);
    expect(deleteRule!.requireApproval).toBe(true);
  });

  it('should require approval for HTTP mutation methods', () => {
    const policy = createProductionPolicy();

    const mutationPaths = [
      'communicate.http.post',
      'communicate.http.put',
      'communicate.http.delete',
    ] as CapabilityPath[];

    for (const path of mutationPaths) {
      const rule = policy.capabilityRules.get(path);
      expect(rule, `Rule for ${path} should exist`).toBeDefined();
      expect(rule!.allowed, `${path} should be allowed`).toBe(true);
      expect(rule!.requireApproval, `${path} should require approval`).toBe(true);
    }
  });

  it('should require approval for browser navigation', () => {
    const policy = createProductionPolicy();
    const rule = policy.capabilityRules.get(cpath('navigate.browser'));
    expect(rule, 'Browser navigation rule should exist').toBeDefined();
    expect(rule!.allowed).toBe(true);
    expect(rule!.requireApproval).toBe(true);
  });

  it('should require approval for desktop interaction', () => {
    const policy = createProductionPolicy();
    const rule = policy.capabilityRules.get(cpath('actuate.desktop'));
    expect(rule, 'Desktop interaction rule should exist').toBeDefined();
    expect(rule!.allowed).toBe(true);
    expect(rule!.requireApproval).toBe(true);
  });

  it('should list actuate.dangerous in restricted paths', () => {
    const policy = createProductionPolicy();
    expect(policy.restricted).toContainEqual(cpath('actuate.dangerous'));
  });

  it('should set per-capability rate limits for allowed paths', () => {
    const policy = createProductionPolicy();

    const fsReadRule = policy.capabilityRules.get(cpath('actuate.filesystem.read'));
    expect(fsReadRule!.maxInvocationsPerHour).toBe(600);

    const httpGetRule = policy.capabilityRules.get(cpath('communicate.http.get'));
    expect(httpGetRule!.maxInvocationsPerHour).toBe(300);

    const modelChatRule = policy.capabilityRules.get(cpath('reason.model.chat'));
    expect(modelChatRule!.maxInvocationsPerHour).toBe(100);
  });

  it('should set rate limits for approval-required paths', () => {
    const policy = createProductionPolicy();

    // Note: The approval-required loop at the end of createProductionPolicy
    // overwrites earlier granular rules with maxInvocationsPerHour: 50 for
    // paths that appear in APPROVAL_REQUIRED_PATHS (actuate.shell, filesystem.write,
    // filesystem.delete, http.post/put/delete, navigate.browser.*, actuate.desktop).
    const shellRule = policy.capabilityRules.get(cpath('actuate.shell'));
    expect(shellRule!.maxInvocationsPerHour).toBe(50);

    const writeRule = policy.capabilityRules.get(cpath('actuate.filesystem.write'));
    expect(writeRule!.maxInvocationsPerHour).toBe(50);

    const deleteRule = policy.capabilityRules.get(cpath('actuate.filesystem.delete'));
    expect(deleteRule!.maxInvocationsPerHour).toBe(50);

    const httpDeleteRule = policy.capabilityRules.get(cpath('communicate.http.delete'));
    expect(httpDeleteRule!.maxInvocationsPerHour).toBe(50);
  });

  it('should set global rate limits', () => {
    const policy = createProductionPolicy();
    expect(policy.globalRateLimit.maxInvocationsPerHour).toBe(1000);
    expect(policy.globalRateLimit.maxConcurrent).toBe(10);
  });

  it('should set budget limits', () => {
    const policy = createProductionPolicy();
    expect(policy.budgetLimits.maxRuPerHour).toBe(5000);
    expect(policy.budgetLimits.maxMuPerHour).toBe(2000);
  });

  it('should set size limits', () => {
    const policy = createProductionPolicy();
    expect(policy.maxInputSizeBytes).toBe(1_000_000);
    expect(policy.maxOutputSizeBytes).toBe(10_000_000);
  });

  it('should include approval-required paths list', () => {
    const policy = createProductionPolicy();
    const required = policy.approvalRequired as CapabilityPath[];

    expect(required).toContainEqual(cpath('actuate.filesystem.write'));
    expect(required).toContainEqual(cpath('actuate.filesystem.delete'));
    expect(required).toContainEqual(cpath('actuate.shell'));
    expect(required).toContainEqual(cpath('communicate.http.post'));
    expect(required).toContainEqual(cpath('communicate.http.put'));
    expect(required).toContainEqual(cpath('communicate.http.delete'));
    expect(required).toContainEqual(cpath('navigate.browser.goto'));
    expect(required).toContainEqual(cpath('navigate.browser.click'));
    expect(required).toContainEqual(cpath('navigate.browser.type'));
    expect(required).toContainEqual(cpath('navigate.browser.select'));
    expect(required).toContainEqual(cpath('actuate.desktop'));
  });

  it('should allow custom maxInvocationsPerHour override', () => {
    const policy = createProductionPolicy({ maxInvocationsPerHour: 500 });
    expect(policy.globalRateLimit.maxInvocationsPerHour).toBe(500);
  });

  it('should allow custom maxConcurrent override', () => {
    const policy = createProductionPolicy({ maxConcurrent: 20 });
    expect(policy.globalRateLimit.maxConcurrent).toBe(20);
  });

  it('should allow custom maxRuPerHour override', () => {
    const policy = createProductionPolicy({ maxRuPerHour: 10000 });
    expect(policy.budgetLimits.maxRuPerHour).toBe(10000);
  });

  it('should allow custom maxMuPerHour override', () => {
    const policy = createProductionPolicy({ maxMuPerHour: 5000 });
    expect(policy.budgetLimits.maxMuPerHour).toBe(5000);
  });

  it('should allow custom maxInputSizeBytes override', () => {
    const policy = createProductionPolicy({ maxInputSizeBytes: 5_000_000 });
    expect(policy.maxInputSizeBytes).toBe(5_000_000);
  });

  it('should allow custom maxOutputSizeBytes override', () => {
    const policy = createProductionPolicy({ maxOutputSizeBytes: 50_000_000 });
    expect(policy.maxOutputSizeBytes).toBe(50_000_000);
  });

  it('should use defaults when no overrides provided', () => {
    const policy = createProductionPolicy();
    expect(policy.globalRateLimit.maxInvocationsPerHour).toBe(1000);
    expect(policy.globalRateLimit.maxConcurrent).toBe(10);
    expect(policy.budgetLimits.maxRuPerHour).toBe(5000);
    expect(policy.budgetLimits.maxMuPerHour).toBe(2000);
    expect(policy.maxInputSizeBytes).toBe(1_000_000);
    expect(policy.maxOutputSizeBytes).toBe(10_000_000);
  });

  it('should allow MCP-related paths', () => {
    const policy = createProductionPolicy();

    const mcpPaths = ['compute.mcp', 'remember.mcp', 'reason.mcp'] as CapabilityPath[];
    for (const path of mcpPaths) {
      const rule = policy.capabilityRules.get(path);
      expect(rule, `Rule for ${path} should exist`).toBeDefined();
      expect(rule!.allowed).toBe(true);
    }
  });

  it('should allow perceive browser and desktop paths', () => {
    const policy = createProductionPolicy();

    const perceivePaths = [
      'perceive.browser.screenshot',
      'perceive.browser.extract',
      'perceive.browser.query',
      'perceive.browser.wait',
      'perceive.desktop.screenshot',
      'perceive.desktop.tree',
      'perceive.desktop.query',
      'perceive.desktop.read',
    ] as CapabilityPath[];

    for (const path of perceivePaths) {
      const rule = policy.capabilityRules.get(path);
      expect(rule, `Rule for ${path} should exist`).toBeDefined();
      expect(rule!.allowed).toBe(true);
    }
  });
});

describe('createDevelopmentPolicy', () => {
  it('should have defaultAction allow', () => {
    const policy = createDevelopmentPolicy();
    expect(policy.defaultAction).toBe('allow');
  });

  it('should not require approval for any capability', () => {
    const policy = createDevelopmentPolicy();
    expect(policy.approvalRequired).toEqual([]);
  });

  it('should have no restricted paths', () => {
    const policy = createDevelopmentPolicy();
    expect(policy.restricted).toEqual([]);
  });

  it('should allow all root capability prefixes', () => {
    const policy = createDevelopmentPolicy();
    const roots = ['actuate', 'communicate', 'remember', 'reason', 'compute', 'perceive', 'navigate'];

    for (const root of roots) {
      const rule = policy.capabilityRules.get(root as CapabilityPath);
      expect(rule, `Rule for ${root} should exist`).toBeDefined();
      expect(rule!.allowed).toBe(true);
    }
  });

  it('should have higher global rate limits than production', () => {
    const devPolicy = createDevelopmentPolicy();
    const prodPolicy = createProductionPolicy();

    expect(devPolicy.globalRateLimit.maxInvocationsPerHour).toBeGreaterThan(
      prodPolicy.globalRateLimit.maxInvocationsPerHour,
    );
    expect(devPolicy.globalRateLimit.maxConcurrent).toBeGreaterThan(
      prodPolicy.globalRateLimit.maxConcurrent,
    );
  });

  it('should have higher budget limits than production', () => {
    const devPolicy = createDevelopmentPolicy();
    const prodPolicy = createProductionPolicy();

    expect(devPolicy.budgetLimits.maxRuPerHour).toBeGreaterThan(
      prodPolicy.budgetLimits.maxRuPerHour,
    );
    expect(devPolicy.budgetLimits.maxMuPerHour).toBeGreaterThan(
      prodPolicy.budgetLimits.maxMuPerHour,
    );
  });

  it('should have higher size limits than production', () => {
    const devPolicy = createDevelopmentPolicy();
    const prodPolicy = createProductionPolicy();

    expect(devPolicy.maxInputSizeBytes).toBeGreaterThan(prodPolicy.maxInputSizeBytes);
    expect(devPolicy.maxOutputSizeBytes).toBeGreaterThan(prodPolicy.maxOutputSizeBytes);
  });

  it('should set specific development rate limits', () => {
    const policy = createDevelopmentPolicy();
    expect(policy.globalRateLimit.maxInvocationsPerHour).toBe(10_000);
    expect(policy.globalRateLimit.maxConcurrent).toBe(50);
  });

  it('should set specific development budget limits', () => {
    const policy = createDevelopmentPolicy();
    expect(policy.budgetLimits.maxRuPerHour).toBe(100_000);
    expect(policy.budgetLimits.maxMuPerHour).toBe(50_000);
  });

  it('should set specific development size limits', () => {
    const policy = createDevelopmentPolicy();
    expect(policy.maxInputSizeBytes).toBe(10_000_000);
    expect(policy.maxOutputSizeBytes).toBe(100_000_000);
  });

  it('should not set per-capability rate limits', () => {
    const policy = createDevelopmentPolicy();
    for (const [, rule] of policy.capabilityRules) {
      expect(rule.maxInvocationsPerHour).toBeUndefined();
    }
  });
});

describe('Policy comparison', () => {
  it('production policy denies unknown paths while development allows them', () => {
    const prodPolicy = createProductionPolicy();
    const devPolicy = createDevelopmentPolicy();

    // An unknown path falls through to defaultAction
    expect(prodPolicy.defaultAction).toBe('deny');
    expect(devPolicy.defaultAction).toBe('allow');
  });

  it('production policy has more granular rules than development', () => {
    const prodPolicy = createProductionPolicy();
    const devPolicy = createDevelopmentPolicy();

    // Production has specific per-path rules; development has only root-level
    expect(prodPolicy.capabilityRules.size).toBeGreaterThan(devPolicy.capabilityRules.size);
  });
});