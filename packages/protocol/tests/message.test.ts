import { describe, it, expect } from 'vitest';
import { buildMessage, canonicalForm, validateMessage, replyTo } from '../src/message.js';
import type { ACPMessage } from '@agentos/types';

describe('message', () => {
  const sender = 'agent-sender-001' as any;
  const recipient = 'agent-recipient-001' as any;

  describe('buildMessage', () => {
    it('creates a message with defaults', () => {
      const msg = buildMessage('task.create', 'general', 3, sender, recipient, { title: 'Test' });
      expect(msg.id).toBeTruthy();
      expect(msg.version).toBe('1.0');
      expect(msg.type).toBe('task.create');
      expect(msg.channel).toBe('general');
      expect(msg.priority).toBe(3);
      expect(msg.sender).toBe(sender);
      expect(msg.recipient).toBe(recipient);
      expect(msg.signature).toBe('');
      expect(msg.signature_algorithm).toBe('ed25519');
      expect(msg.timestamp).toBeTruthy();
      expect(msg.ttl).toBe(3_600_000); // DEFAULT_TTL_MS
    });

    it('accepts custom options', () => {
      const msg = buildMessage('rpc.request', 'rpc', 1, sender, recipient, { method: 'test' }, {
        version: '2.0',
        ttl: 60000,
        correlation_id: 'corr-123',
        causation_id: 'cause-456',
        metadata: { trace: 'abc' },
      });
      expect(msg.version).toBe('2.0');
      expect(msg.ttl).toBe(60000);
      expect(msg.correlation_id).toBe('corr-123');
      expect(msg.causation_id).toBe('cause-456');
      expect(msg.metadata).toEqual({ trace: 'abc' });
    });

    it('supports broadcast recipient', () => {
      const msg = buildMessage('broadcast', 'general', 3, sender, '*', { topic: 'test' });
      expect(msg.recipient).toBe('*');
    });
  });

  describe('canonicalForm', () => {
    it('produces deterministic JSON with sorted keys', () => {
      const msg = buildMessage('task.create', 'general', 3, sender, recipient, { title: 'Test' });
      const canonical = canonicalForm(msg);
      const parsed = JSON.parse(canonical);

      // Verify keys are sorted
      const keys = Object.keys(parsed);
      const sortedKeys = [...keys].sort();
      expect(keys).toEqual(sortedKeys);
    });

    it('omits signature from canonical form', () => {
      const msg = buildMessage('task.create', 'general', 3, sender, recipient, { title: 'Test' });
      msg.signature = 'some-signature';
      const canonical = canonicalForm(msg);
      const parsed = JSON.parse(canonical);
      expect(parsed).not.toHaveProperty('signature');
    });

    it('omits undefined optional fields', () => {
      const msg = buildMessage('task.create', 'general', 3, sender, recipient, { title: 'Test' });
      const canonical = canonicalForm(msg);
      const parsed = JSON.parse(canonical);
      expect(parsed).not.toHaveProperty('correlation_id');
      expect(parsed).not.toHaveProperty('causation_id');
    });

    it('includes optional fields when present', () => {
      const msg = buildMessage('rpc.request', 'rpc', 1, sender, recipient, { method: 'test' }, {
        correlation_id: 'corr-123',
      });
      const canonical = canonicalForm(msg);
      const parsed = JSON.parse(canonical);
      expect(parsed).toHaveProperty('correlation_id');
      expect(parsed.correlation_id).toBe('corr-123');
    });

    it('produces same output for same input (deterministic)', () => {
      const msg = buildMessage('task.create', 'general', 3, sender, recipient, { title: 'Test' });
      const c1 = canonicalForm(msg);
      const c2 = canonicalForm(msg);
      expect(c1).toBe(c2);
    });
  });

  describe('validateMessage', () => {
    it('accepts a valid message', () => {
      const msg = buildMessage('task.create', 'general', 3, sender, recipient, { title: 'Test' });
      const result = validateMessage(msg);
      expect(result.ok).toBe(true);
    });

    it('rejects a message with invalid timestamp (too old)', () => {
      const msg = buildMessage('task.create', 'general', 3, sender, recipient, { title: 'Test' });
      msg.timestamp = new Date(Date.now() - 120_000).toISOString(); // 2 min ago, skew is 60s
      const result = validateMessage(msg);
      expect(result.ok).toBe(false);
    });
  });

  describe('replyTo', () => {
    it('creates a reply with correct correlation and causation IDs', () => {
      const original = buildMessage('rpc.request', 'rpc', 1, sender, recipient, { method: 'test' });
      const reply = replyTo(original, 'rpc.response', recipient, { result: 'done' });

      expect(reply.correlation_id).toBe(original.id);
      expect(reply.causation_id).toBe(original.id);
      expect(reply.recipient).toBe(original.sender);
      expect(reply.channel).toBe(original.channel);
    });

    it('uses existing correlation_id if present', () => {
      const original = buildMessage('rpc.request', 'rpc', 1, sender, recipient, { method: 'test' }, {
        correlation_id: 'existing-corr',
      });
      const reply = replyTo(original, 'rpc.response', recipient, { result: 'done' });

      expect(reply.correlation_id).toBe('existing-corr');
      expect(reply.causation_id).toBe(original.id);
    });
  });
});