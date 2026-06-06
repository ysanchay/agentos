import { describe, it, expect } from 'vitest';
import { RPCServer, RPCClient } from '../src/rpc.js';

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

      const request = {
        id: 'req-1',
        version: '1.0',
        type: 'rpc.request' as const,
        channel: 'rpc',
        priority: 2 as const,
        sender: 'agent-1' as any,
        recipient: 'agent-2' as any,
        timestamp: new Date().toISOString(),
        ttl: 30000,
        payload: { method: 'add', params: { a: 3, b: 4 }, idempotency_key: undefined, timeout_ms: 30000 },
        signature: '',
        signature_algorithm: 'ed25519' as const,
      };

      const result = await server.handleRequest(request);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.type).toBe('rpc.response');
        const payload = result.data.payload as any;
        expect(payload.result).toBe(7);
      }
    });

    it('returns error for unknown method', async () => {
      const server = new RPCServer();
      const request = {
        id: 'req-2',
        version: '1.0',
        type: 'rpc.request' as const,
        channel: 'rpc',
        priority: 2 as const,
        sender: 'agent-1' as any,
        recipient: 'agent-2' as any,
        timestamp: new Date().toISOString(),
        ttl: 30000,
        payload: { method: 'unknown', params: {} },
        signature: '',
        signature_algorithm: 'ed25519' as const,
      };

      const result = await server.handleRequest(request);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.type).toBe('rpc.error');
        const payload = result.data.payload as any;
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

      const request = {
        id: 'req-3',
        version: '1.0',
        type: 'rpc.request' as const,
        channel: 'rpc',
        priority: 2 as const,
        sender: 'agent-1' as any,
        recipient: 'agent-2' as any,
        timestamp: new Date().toISOString(),
        ttl: 30000,
        payload: { method: 'increment', params: {}, idempotency_key: 'idem-1', timeout_ms: 30000 },
        signature: '',
        signature_algorithm: 'ed25519' as const,
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

      const request = {
        id: 'req-4',
        version: '1.0',
        type: 'rpc.request' as const,
        channel: 'rpc',
        priority: 2 as const,
        sender: 'agent-1' as any,
        recipient: 'agent-2' as any,
        timestamp: new Date().toISOString(),
        ttl: 30000,
        payload: { method: 'fail', params: {} },
        signature: '',
        signature_algorithm: 'ed25519' as const,
      };

      const result = await server.handleRequest(request);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.type).toBe('rpc.error');
      }
    });
  });

  describe('RPCClient', () => {
    it('builds an RPC request message', () => {
      const client = new RPCClient('agent-1' as any);
      const msg = client.buildRequest('rpc', 'agent-2' as any, 'echo', { data: 'test' });

      expect(msg.type).toBe('rpc.request');
      expect(msg.sender).toBe('agent-1');
      expect(msg.recipient).toBe('agent-2');
      const payload = msg.payload as any;
      expect(payload.method).toBe('echo');
      expect(payload.params).toEqual({ data: 'test' });
    });

    it('builds request with custom options', () => {
      const client = new RPCClient('agent-1' as any);
      const msg = client.buildRequest('rpc', 'agent-2' as any, 'echo', {}, {
        timeoutMs: 10000,
        idempotencyKey: 'key-1',
      });

      const payload = msg.payload as any;
      expect(payload.timeout_ms).toBe(10000);
      expect(payload.idempotency_key).toBe('key-1');
    });

    it('handles incoming response messages', () => {
      const client = new RPCClient('agent-1' as any);
      let resolved = false;

      // Set up a pending request by making the response resolver
      const requestId = 'test-req-id';
      (client as any).responseResolver.set(requestId, () => { resolved = true; });

      const responseMsg = {
        correlation_id: requestId,
        type: 'rpc.response',
      } as any;

      client.handleResponse(responseMsg);
      expect(resolved).toBe(true);
    });
  });
});