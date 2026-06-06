import { describe, it, expect } from 'vitest';
import { RPCServer, RPCClient } from '../src/rpc.js';
import { createUUID, asUUID } from '@agentos/types';
import type { ACPMessage, RPCRequestPayload, RPCResponsePayload, RPCErrorPayload } from '@agentos/types';

// Helper to create a valid agent ID
function agentId(): string {
  return createUUID();
}

describe('rpc', () => {
  describe('RPCServer', () => {
    it('registers and lists methods', () => {
      const server = new RPCServer();
      server.registerMethod('echo', async (_method, params) => ({ ok: true as const, data: params }));
      expect(server.listMethods()).toContain('echo');
    });

    it('unregisters a method', () => {
      const server = new RPCServer();
      server.registerMethod('echo', async (_method, params) => ({ ok: true as const, data: params }));
      server.unregisterMethod('echo');
      expect(server.listMethods()).not.toContain('echo');
    });

    it('handles a request and returns response', async () => {
      const server = new RPCServer();
      server.registerMethod('add', async (_method, params) => {
        const p = params as { a: number; b: number };
        return { ok: true as const, data: p.a + p.b };
      });

      const senderId = agentId();
      const recipientId = agentId();
      const request: ACPMessage = {
        id: createUUID(),
        version: '1.0',
        type: 'rpc.request',
        channel: 'rpc',
        priority: 2,
        sender: asUUID<typeof senderId>(senderId),
        recipient: asUUID<typeof recipientId>(recipientId),
        timestamp: new Date().toISOString(),
        ttl: 30000,
        payload: { method: 'add', params: { a: 3, b: 4 }, idempotency_key: undefined, timeout_ms: 30000 },
        signature: '',
        signature_algorithm: 'ed25519',
      };

      const result = await server.handleRequest(request);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.type).toBe('rpc.response');
        const payload = result.data.payload as RPCResponsePayload;
        expect(payload.result).toBe(7);
        expect(payload.duration_ms).toBeGreaterThanOrEqual(0);
      }
    });

    it('returns error for unknown method', async () => {
      const server = new RPCServer();
      const senderId = agentId();
      const request: ACPMessage = {
        id: createUUID(),
        version: '1.0',
        type: 'rpc.request',
        channel: 'rpc',
        priority: 2,
        sender: asUUID<typeof senderId>(senderId),
        recipient: asUUID<typeof agentId()>(agentId()),
        timestamp: new Date().toISOString(),
        ttl: 30000,
        payload: { method: 'unknown', params: {} },
        signature: '',
        signature_algorithm: 'ed25519',
      };

      const result = await server.handleRequest(request);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.type).toBe('rpc.error');
        const payload = result.data.payload as RPCErrorPayload;
        expect(payload.error_code).toBe('ACP-E012');
      }
    });

    it('handles idempotency keys', async () => {
      const server = new RPCServer();
      let callCount = 0;
      server.registerMethod('increment', async () => {
        callCount++;
        return { ok: true as const, data: callCount };
      });

      const senderId = agentId();
      const request: ACPMessage = {
        id: createUUID(),
        version: '1.0',
        type: 'rpc.request',
        channel: 'rpc',
        priority: 2,
        sender: asUUID<typeof senderId>(senderId),
        recipient: asUUID<typeof agentId()>(agentId()),
        timestamp: new Date().toISOString(),
        ttl: 30000,
        payload: { method: 'increment', params: {}, idempotency_key: 'idem-1', timeout_ms: 30000 },
        signature: '',
        signature_algorithm: 'ed25519',
      };

      const result1 = await server.handleRequest(request);
      const result2 = await server.handleRequest(request);
      // Second call should return cached result without incrementing
      expect(callCount).toBe(1);
    });

    it('handles handler errors', async () => {
      const server = new RPCServer();
      server.registerMethod('fail', async () => {
        throw new Error('boom');
      });

      const senderId = agentId();
      const request: ACPMessage = {
        id: createUUID(),
        version: '1.0',
        type: 'rpc.request',
        channel: 'rpc',
        priority: 2,
        sender: asUUID<typeof senderId>(senderId),
        recipient: asUUID<typeof agentId()>(agentId()),
        timestamp: new Date().toISOString(),
        ttl: 30000,
        payload: { method: 'fail', params: {} },
        signature: '',
        signature_algorithm: 'ed25519',
      };

      const result = await server.handleRequest(request);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.type).toBe('rpc.error');
        const payload = result.data.payload as RPCErrorPayload;
        expect(payload.error_message).toBe('boom');
      }
    });

    it('handles handler returning error outcome', async () => {
      const server = new RPCServer();
      server.registerMethod('controlled-fail', async () => {
        return { ok: false as const, error_code: 'ACP-E010', error_message: 'timeout', retryable: true };
      });

      const senderId = agentId();
      const request: ACPMessage = {
        id: createUUID(),
        version: '1.0',
        type: 'rpc.request',
        channel: 'rpc',
        priority: 2,
        sender: asUUID<typeof senderId>(senderId),
        recipient: asUUID<typeof agentId()>(agentId()),
        timestamp: new Date().toISOString(),
        ttl: 30000,
        payload: { method: 'controlled-fail', params: {} },
        signature: '',
        signature_algorithm: 'ed25519',
      };

      const result = await server.handleRequest(request);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.type).toBe('rpc.error');
        const payload = result.data.payload as RPCErrorPayload;
        expect(payload.error_code).toBe('ACP-E010');
        expect(payload.retryable).toBe(true);
      }
    });

    it('handles invalid request payload', async () => {
      const server = new RPCServer();
      const request: ACPMessage = {
        id: createUUID(),
        version: '1.0',
        type: 'rpc.request',
        channel: 'rpc',
        priority: 2,
        sender: asUUID<typeof agentId()>(agentId()),
        recipient: asUUID<typeof agentId()>(agentId()),
        timestamp: new Date().toISOString(),
        ttl: 30000,
        payload: 'not an object',
        signature: '',
        signature_algorithm: 'ed25519',
      };

      const result = await server.handleRequest(request);
      expect(result.ok).toBe(false);
    });
  });

  describe('RPCClient', () => {
    it('builds an RPC request message', () => {
      const senderId = agentId();
      const client = new RPCClient(asUUID<typeof senderId>(senderId));
      const msg = client.buildRequest('rpc', asUUID<typeof agentId()>(agentId()), 'echo', { data: 'test' });

      expect(msg.type).toBe('rpc.request');
      expect(msg.sender).toBe(senderId);
      const payload = msg.payload as RPCRequestPayload;
      expect(payload.method).toBe('echo');
      expect(payload.params).toEqual({ data: 'test' });
    });

    it('builds request with custom options', () => {
      const senderId = agentId();
      const client = new RPCClient(asUUID<typeof senderId>(senderId));
      const msg = client.buildRequest('rpc', asUUID<typeof agentId()>(agentId()), 'echo', {}, {
        timeoutMs: 10000,
        idempotencyKey: 'key-1',
      });

      const payload = msg.payload as RPCRequestPayload;
      expect(payload.timeout_ms).toBe(10000);
      expect(payload.idempotency_key).toBe('key-1');
    });

    it('handles incoming response messages', () => {
      const senderId = agentId();
      const client = new RPCClient(asUUID<typeof senderId>(senderId));
      let resolved = false;

      const requestId = 'test-req-id';
      (client as any).responseResolver.set(requestId, () => { resolved = true; });

      const responseMsg = {
        correlation_id: requestId,
        type: 'rpc.response',
      } as any;

      client.handleResponse(responseMsg);
      expect(resolved).toBe(true);
    });

    it('handles response message without correlation_id', () => {
      const senderId = agentId();
      const client = new RPCClient(asUUID<typeof senderId>(senderId));
      // Should not throw
      client.handleResponse({} as any);
    });

    it('call makes a request and receives response', async () => {
      const server = new RPCServer();
      server.registerMethod('double', async (_method, params) => {
        const n = (params as { n: number }).n;
        return { ok: true as const, data: n * 2 };
      });

      const senderId = agentId();
      const recipientId = agentId();
      const client = new RPCClient(asUUID<typeof senderId>(senderId));

      // Simulate a round-trip: client sends, server handles, client receives response
      const result = await client.call(
        'rpc',
        asUUID<typeof recipientId>(recipientId),
        'double',
        { n: 5 },
        async (requestMsg: ACPMessage) => {
          // Simulate server processing and responding
          const serverResult = await server.handleRequest(requestMsg);
          if (serverResult.ok) {
            // Small delay to let the client set up its listener
            await new Promise(r => setTimeout(r, 10));
            client.handleResponse(serverResult.data);
          }
        },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe(10);
      }
    });

    it('call returns error when server returns rpc.error', async () => {
      const server = new RPCServer();
      server.registerMethod('always-fail', async () => {
        return { ok: false as const, error_code: 'KER-0006', error_message: 'not enough resources', retryable: false };
      });

      const senderId = agentId();
      const recipientId = agentId();
      const client = new RPCClient(asUUID<typeof senderId>(senderId), { timeoutMs: 5000 });

      const result = await client.call(
        'rpc',
        asUUID<typeof recipientId>(recipientId),
        'always-fail',
        {},
        async (requestMsg: ACPMessage) => {
          const serverResult = await server.handleRequest(requestMsg);
          if (serverResult.ok) {
            await new Promise(r => setTimeout(r, 10));
            client.handleResponse(serverResult.data);
          }
        },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_message).toContain('not enough resources');
      }
    });

    it('call times out when no response is received', async () => {
      const senderId = agentId();
      const recipientId = agentId();
      const client = new RPCClient(asUUID<typeof senderId>(senderId), { timeoutMs: 200, maxRetries: 1 });

      // Send to nowhere - no server will respond
      const result = await client.call(
        'rpc',
        asUUID<typeof recipientId>(recipientId),
        'slow',
        {},
        () => { /* no response sent back */ },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error_code).toBeTruthy();
      }
    }, 10000);
  });
});