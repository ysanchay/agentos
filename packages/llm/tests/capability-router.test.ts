/**
 * @agentos/llm — CapabilityRouter tests
 * Tests for capability path → task type mapping.
 */

import { describe, it, expect } from 'vitest';
import { CapabilityRouter } from '../src/capability-router.js';

describe('CapabilityRouter', () => {
  const router = new CapabilityRouter();

  describe('exact path matching', () => {
    it('should map reason.infer.text to reasoning', () => {
      expect(router.resolve('reason.infer.text')).toBe('reasoning');
    });

    it('should map create.code to coding', () => {
      expect(router.resolve('create.code')).toBe('coding');
    });

    it('should map create.code.typescript to coding', () => {
      expect(router.resolve('create.code.typescript')).toBe('coding');
    });

    it('should map reason.decide to decision', () => {
      expect(router.resolve('reason.decide')).toBe('decision');
    });

    it('should map coordinate.plan to planning', () => {
      expect(router.resolve('coordinate.plan')).toBe('planning');
    });

    it('should map validate.review to reasoning', () => {
      expect(router.resolve('validate.review')).toBe('reasoning');
    });
  });

  describe('parent path fallback', () => {
    it('should walk up path segments for unknown sub-paths', () => {
      // 'reason.infer.text.long' → no exact match → try 'reason.infer.text' → 'reasoning'
      expect(router.resolve('reason.infer.text.long')).toBe('reasoning');
    });

    it('should fall back to parent capability for deep paths', () => {
      expect(router.resolve('create.code.rust')).toBe('coding');
    });
  });

  describe('root capability defaults', () => {
    it('should map create root to coding', () => {
      expect(router.resolve('create')).toBe('coding');
    });

    it('should map reason root to reasoning', () => {
      expect(router.resolve('reason')).toBe('reasoning');
    });

    it('should map compute root to coding', () => {
      expect(router.resolve('compute')).toBe('coding');
    });

    it('should map coordinate root to planning', () => {
      expect(router.resolve('coordinate')).toBe('planning');
    });

    it('should map perceive root to reasoning', () => {
      expect(router.resolve('perceive')).toBe('reasoning');
    });
  });

  describe('unknown capabilities', () => {
    it('should return default for completely unknown paths', () => {
      expect(router.resolve('unknown.path')).toBe('default');
    });

    it('should return default for empty string', () => {
      expect(router.resolve('')).toBe('default');
    });
  });

  describe('getTaskTypeHeader', () => {
    it('should return the task type as a string for x-task-type header', () => {
      expect(router.getTaskTypeHeader('reason.infer.text')).toBe('reasoning');
      expect(router.getTaskTypeHeader('create.code')).toBe('coding');
    });
  });
});