import { describe, it, expect } from 'vitest';
import { validateACPMessage, validateMessageType, validateLivenessState } from '../src/validation.js';

describe('validation', () => {
  describe('validateACPMessage', () => {
    it('accepts a valid ACPMessage', () => {
      const message = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        version: '1.0',
        type: 'task.create',
        channel: 'general',
        priority: 3,
        sender: 'agent-001',
        recipient: 'agent-002',
        timestamp: new Date().toISOString(),
        ttl: 3600000,
        payload: { title: 'Test' },
        signature: 'abc123',
        signature_algorithm: 'ed25519',
      };

      const result = validateACPMessage(message);
      expect(result.ok).toBe(true);
    });

    it('rejects invalid message type', () => {
      const message = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        version: '1.0',
        type: 'invalid.type',
        channel: 'general',
        priority: 3,
        sender: 'agent-001',
        recipient: 'agent-002',
        timestamp: new Date().toISOString(),
        payload: {},
        signature: 'abc123',
        signature_algorithm: 'ed25519',
      };

      const result = validateACPMessage(message);
      expect(result.ok).toBe(false);
    });

    it('rejects missing required fields', () => {
      const message = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        version: '1.0',
        // missing type
        channel: 'general',
        priority: 3,
        sender: 'agent-001',
        recipient: 'agent-002',
        timestamp: new Date().toISOString(),
        payload: {},
        signature: 'abc123',
        signature_algorithm: 'ed25519',
      };

      const result = validateACPMessage(message);
      expect(result.ok).toBe(false);
    });

    it('rejects invalid priority value', () => {
      const message = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        version: '1.0',
        type: 'task.create',
        channel: 'general',
        priority: 99,
        sender: 'agent-001',
        recipient: 'agent-002',
        timestamp: new Date().toISOString(),
        payload: {},
        signature: 'abc123',
        signature_algorithm: 'ed25519',
      };

      const result = validateACPMessage(message);
      expect(result.ok).toBe(false);
    });

    it('accepts wildcard recipient', () => {
      const message = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        version: '1.0',
        type: 'broadcast',
        channel: 'general',
        priority: 3,
        sender: 'agent-001',
        recipient: '*',
        timestamp: new Date().toISOString(),
        payload: {},
        signature: 'abc123',
        signature_algorithm: 'ed25519',
      };

      const result = validateACPMessage(message);
      expect(result.ok).toBe(true);
    });
  });

  describe('validateMessageType', () => {
    it('accepts valid message types', () => {
      expect(validateMessageType('task.create').ok).toBe(true);
      expect(validateMessageType('rpc.request').ok).toBe(true);
      expect(validateMessageType('broadcast').ok).toBe(true);
      expect(validateMessageType('dead.letter').ok).toBe(true);
    });

    it('rejects invalid message types', () => {
      expect(validateMessageType('invalid.type').ok).toBe(false);
      expect(validateMessageType('').ok).toBe(false);
    });
  });

  describe('validateLivenessState', () => {
    it('accepts valid liveness states', () => {
      expect(validateLivenessState('healthy').ok).toBe(true);
      expect(validateLivenessState('suspect').ok).toBe(true);
      expect(validateLivenessState('degraded').ok).toBe(true);
      expect(validateLivenessState('failed').ok).toBe(true);
    });

    it('rejects invalid liveness states', () => {
      expect(validateLivenessState('unknown').ok).toBe(false);
      expect(validateLivenessState('').ok).toBe(false);
    });
  });
});