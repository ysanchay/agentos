import { describe, it, expect } from 'vitest';
import { generateKeyPair, signMessage, verifySignature, signBytes, verifyBytes, KeyRegistry } from '../src/signing.js';
import { buildMessage } from '../src/message.js';

describe('signing', () => {
  describe('generateKeyPair', () => {
    it('generates hex-encoded key pair', async () => {
      const { privateKey, publicKey } = await generateKeyPair();
      expect(privateKey).toBeTruthy();
      expect(publicKey).toBeTruthy();
      expect(privateKey).toMatch(/^[0-9a-f]+$/);
      expect(publicKey).toMatch(/^[0-9a-f]+$/);
      expect(privateKey.length).toBe(64); // 32 bytes hex
      expect(publicKey.length).toBe(64); // 32 bytes hex
    });

    it('generates unique key pairs', async () => {
      const pair1 = await generateKeyPair();
      const pair2 = await generateKeyPair();
      expect(pair1.privateKey).not.toBe(pair2.privateKey);
      expect(pair1.publicKey).not.toBe(pair2.publicKey);
    });
  });

  describe('signMessage / verifySignature', () => {
    it('signs and verifies a message', async () => {
      const { privateKey, publicKey } = await generateKeyPair();
      const sender = 'agent-001' as any;
      const msg = buildMessage('task.create', 'general', 3, sender, 'agent-002' as any, { title: 'Test' });

      const signature = await signMessage(privateKey, msg);
      expect(signature).toBeTruthy();

      msg.signature = signature;
      expect(await verifySignature(publicKey, msg)).toBe(true);
    });

    it('rejects tampered messages', async () => {
      const { privateKey, publicKey } = await generateKeyPair();
      const sender = 'agent-001' as any;
      const msg = buildMessage('task.create', 'general', 3, sender, 'agent-002' as any, { title: 'Test' });

      msg.signature = await signMessage(privateKey, msg);
      expect(await verifySignature(publicKey, msg)).toBe(true);

      // Tamper with payload
      msg.payload = { title: 'Tampered' };
      expect(await verifySignature(publicKey, msg)).toBe(false);
    });

    it('rejects wrong public key', async () => {
      const { privateKey } = await generateKeyPair();
      const { publicKey: wrongPublicKey } = await generateKeyPair();
      const sender = 'agent-001' as any;
      const msg = buildMessage('task.create', 'general', 3, sender, 'agent-002' as any, { title: 'Test' });

      msg.signature = await signMessage(privateKey, msg);
      expect(await verifySignature(wrongPublicKey, msg)).toBe(false);
    });
  });

  describe('signBytes / verifyBytes', () => {
    it('signs and verifies raw bytes', async () => {
      const { privateKey, publicKey } = await generateKeyPair();
      const data = new TextEncoder().encode('hello world');
      const signature = await signBytes(privateKey, data);
      expect(await verifyBytes(publicKey, signature, data)).toBe(true);
    });

    it('rejects tampered data', async () => {
      const { privateKey, publicKey } = await generateKeyPair();
      const data = new TextEncoder().encode('hello world');
      const signature = await signBytes(privateKey, data);
      const tampered = new TextEncoder().encode('hello worle');
      expect(await verifyBytes(publicKey, signature, tampered)).toBe(false);
    });
  });

  describe('KeyRegistry', () => {
    it('registers a key and retrieves it', async () => {
      const registry = new KeyRegistry();
      const { publicKey } = await generateKeyPair();
      const agentId = 'agent-001' as any;

      const result = registry.register(agentId, publicKey);
      expect(result.ok).toBe(true);

      const keyResult = registry.getPublicKey(agentId);
      expect(keyResult.ok).toBe(true);
      if (keyResult.ok) {
        expect(keyResult.data).toBe(publicKey);
      }
    });

    it('rejects duplicate registration for same agent', async () => {
      const registry = new KeyRegistry();
      const { publicKey } = await generateKeyPair();
      const agentId = 'agent-001' as any;

      registry.register(agentId, publicKey);
      const pair2 = await generateKeyPair();
      const result = registry.register(agentId, pair2.publicKey);
      expect(result.ok).toBe(false);
    });

    it('allows rotation of keys', async () => {
      const registry = new KeyRegistry();
      const { publicKey: pub1 } = await generateKeyPair();
      const { publicKey: pub2 } = await generateKeyPair();
      const agentId = 'agent-001' as any;

      registry.register(agentId, pub1);
      const result = registry.rotate(agentId, pub2);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.version).toBe(2);
      }

      const keyResult = registry.getPublicKey(agentId);
      expect(keyResult.ok).toBe(true);
      if (keyResult.ok) {
        expect(keyResult.data).toBe(pub2);
      }
    });

    it('rejects rotation for unknown agent', () => {
      const registry = new KeyRegistry();
      const result = registry.rotate('agent-999' as any, 'somekey');
      expect(result.ok).toBe(false);
    });

    it('revokes a key', async () => {
      const registry = new KeyRegistry();
      const { publicKey } = await generateKeyPair();
      const agentId = 'agent-001' as any;

      registry.register(agentId, publicKey);
      const revokeResult = registry.revoke(agentId);
      expect(revokeResult.ok).toBe(true);

      const keyResult = registry.getPublicKey(agentId);
      expect(keyResult.ok).toBe(false);
    });

    it('allows re-registration after revocation', async () => {
      const registry = new KeyRegistry();
      const { publicKey: pub1 } = await generateKeyPair();
      const { publicKey: pub2 } = await generateKeyPair();
      const agentId = 'agent-001' as any;

      registry.register(agentId, pub1);
      registry.revoke(agentId);

      const result = registry.register(agentId, pub2);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.version).toBe(2);
      }
    });

    it('verifyMessage works with registered keys', async () => {
      const registry = new KeyRegistry();
      const { privateKey, publicKey } = await generateKeyPair();
      const agentId = 'agent-001' as any;

      registry.register(agentId, publicKey);
      const msg = buildMessage('task.create', 'general', 3, agentId, 'agent-002' as any, { title: 'Test' });
      msg.signature = await signMessage(privateKey, msg);

      const result = await registry.verifyMessage(msg);
      expect(result.ok).toBe(true);
    });

    it('verifyMessage fails for unregistered agent', async () => {
      const registry = new KeyRegistry();
      const msg = buildMessage('task.create', 'general', 3, 'agent-999' as any, 'agent-002' as any, { title: 'Test' });
      const result = await registry.verifyMessage(msg);
      expect(result.ok).toBe(false);
    });
  });
});