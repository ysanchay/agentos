import { describe, it, expect } from 'vitest';
import { serialize, deserialize, validateMessageSize, validateMetadata, byteLength } from '../src/serializer.js';

describe('serializer', () => {
  describe('byteLength', () => {
    it('returns byte length for ASCII strings', () => {
      expect(byteLength('hello')).toBe(5);
    });

    it('returns byte length for UTF-8 multi-byte strings', () => {
      expect(byteLength('hello')).toBe(5);
      // CJK characters are 3 bytes each in UTF-8
      expect(byteLength('世界')).toBe(6);
    });
  });

  describe('validateMetadata', () => {
    it('accepts undefined metadata', () => {
      const result = validateMetadata(undefined);
      expect(result.ok).toBe(true);
    });

    it('accepts valid metadata', () => {
      const result = validateMetadata({ key1: 'value1', key2: 'value2' });
      expect(result.ok).toBe(true);
    });

    it('rejects too many keys', () => {
      const meta: Record<string, string> = {};
      for (let i = 0; i < 17; i++) {
        meta[`k${i}`] = 'v';
      }
      const result = validateMetadata(meta);
      expect(result.ok).toBe(false);
    });

    it('rejects values that are too long', () => {
      const meta = { key: 'a'.repeat(257) };
      const result = validateMetadata(meta);
      expect(result.ok).toBe(false);
    });

    it('allows up to 16 keys', () => {
      const meta: Record<string, string> = {};
      for (let i = 0; i < 16; i++) {
        meta[`k${i}`] = 'v';
      }
      const result = validateMetadata(meta);
      expect(result.ok).toBe(true);
    });

    it('allows values up to 256 chars', () => {
      const meta = { key: 'a'.repeat(256) };
      const result = validateMetadata(meta);
      expect(result.ok).toBe(true);
    });
  });

  describe('serialize', () => {
    it('serializes objects to JSON', () => {
      const result = serialize({ hello: 'world' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(JSON.parse(result.data)).toEqual({ hello: 'world' });
      }
    });

    it('rejects oversized messages', () => {
      const bigObj = { data: 'x'.repeat(1_100_000) };
      const result = serialize(bigObj, { maxMessageSizeBytes: 100 });
      expect(result.ok).toBe(false);
    });

    it('rejects oversized payload', () => {
      const msg = { payload: 'x'.repeat(1000) };
      const result = serialize(msg, { maxPayloadSizeBytes: 100 });
      expect(result.ok).toBe(false);
    });

    it('validates metadata during serialize', () => {
      const meta: Record<string, string> = {};
      for (let i = 0; i < 17; i++) {
        meta[`k${i}`] = 'v';
      }
      const msg = { metadata: meta };
      const result = serialize(msg);
      expect(result.ok).toBe(false);
    });
  });

  describe('deserialize', () => {
    it('parses valid JSON', () => {
      const result = deserialize('{"hello":"world"}');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({ hello: 'world' });
      }
    });

    it('rejects invalid JSON', () => {
      const result = deserialize('not json');
      expect(result.ok).toBe(false);
    });

    it('rejects oversized JSON', () => {
      const result = deserialize('{"a":"' + 'x'.repeat(1000) + '"}', { maxMessageSizeBytes: 100 });
      expect(result.ok).toBe(false);
    });
  });

  describe('validateMessageSize', () => {
    it('accepts messages within limits', () => {
      const result = validateMessageSize({ payload: { small: 'data' } });
      expect(result.ok).toBe(true);
    });

    it('rejects oversized payloads', () => {
      const result = validateMessageSize(
        { payload: 'x'.repeat(1000) },
        { maxPayloadSizeBytes: 100 },
      );
      expect(result.ok).toBe(false);
    });

    it('rejects oversized metadata', () => {
      const meta: Record<string, string> = {};
      for (let i = 0; i < 17; i++) {
        meta[`k${i}`] = 'v';
      }
      const result = validateMessageSize({ metadata: meta });
      expect(result.ok).toBe(false);
    });

    it('accepts messages without payload or metadata', () => {
      const result = validateMessageSize({});
      expect(result.ok).toBe(true);
    });
  });
});