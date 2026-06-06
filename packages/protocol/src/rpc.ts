/**
 * RPCClient/RPCServer: request/response with idempotency key, timeout, retry
 */

import type { ACPMessage, AgentID, MessageType, RPCRequestPayload, RPCResponsePayload, RPCErrorPayload } from '@agentos/types';
import { RPC_DEFAULT_TIMEOUT_MS, RPC_MAX_RETRIES, IDEMPOTENCY_KEY_TTL_MS } from '@agentos/types';
import { ok, err } from '@agentos/types';
import type { Outcome } from '@agentos/types';
import { rpcTimeout, rpcMaxRetries, rpcMethodNotFound, duplicateIdempotencyKey } from './errors.js';
import { createBackoffIterator, sleep } from './retry.js';
import { buildMessage } from './message.js';

export type RPCHandler = (method: string, params: unknown) => Promise<Outcome<unknown>>;

export interface RPCClientOpts {
  timeoutMs?: number;
  maxRetries?: number;
  idempotencyKey?: string;
}

interface PendingRequest {
  resolve: (result: Outcome<unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
  startTime: number;
}

/**
 * RPCServer handles incoming RPC request messages and dispatches them to registered handlers.
 */
export class RPCServer {
  private handlers = new Map<string, RPCHandler>();
  private idempotencyCache = new Map<string, Outcome<unknown>>();

  /**
   * Register a handler for an RPC method.
   */
  registerMethod(method: string, handler: RPCHandler): void {
    this.handlers.set(method, handler);
  }

  /**
   * Unregister a handler for an RPC method.
   */
  unregisterMethod(method: string): void {
    this.handlers.delete(method);
  }

  /**
   * Handle an incoming RPC request message.
   * Checks idempotency, dispatches to handler, returns response.
   */
  async handleRequest(message: ACPMessage): Promise<Outcome<ACPMessage>> {
    const payload = message.payload as RPCRequestPayload;
    if (!payload || typeof payload !== 'object' || !('method' in payload)) {
      return err('ACP-E012', 'Invalid RPC request payload');
    }

    // Idempotency check
    const idempotencyKey = payload.idempotency_key;
    if (idempotencyKey) {
      const cached = this.idempotencyCache.get(idempotencyKey);
      if (cached) {
        // Return cached result but still wrap it as a response message
        const responsePayload: RPCResponsePayload = {
          result: cached.ok ? cached.data : undefined,
          duration_ms: 0,
        };
        if (!cached.ok) {
          const errorPayload: RPCErrorPayload = {
            error_code: cached.error_code,
            error_message: cached.error_message,
            retryable: cached.retryable,
          };
          return ok(this.buildErrorResponse(message, errorPayload));
        }
        return ok(this.buildResponseMessage(message, responsePayload));
      }
    }

    const handler = this.handlers.get(payload.method);
    if (!handler) {
      const errorPayload: RPCErrorPayload = {
        error_code: 'ACP-E012',
        error_message: `Method not found: ${payload.method}`,
        retryable: false,
      };
      return ok(this.buildErrorResponse(message, errorPayload));
    }

    try {
      const result = await handler(payload.method, payload.params);

      // Cache result for idempotency
      if (idempotencyKey) {
        this.idempotencyCache.set(idempotencyKey, result);
        setTimeout(() => this.idempotencyCache.delete(idempotencyKey), IDEMPOTENCY_KEY_TTL_MS);
      }

      if (result.ok) {
        const responsePayload: RPCResponsePayload = {
          result: result.data,
          duration_ms: Date.now() - new Date(message.timestamp).getTime(),
        };
        return ok(this.buildResponseMessage(message, responsePayload));
      } else {
        const errorPayload: RPCErrorPayload = {
          error_code: result.error_code,
          error_message: result.error_message,
          retryable: result.retryable,
          retry_after_ms: result.retry_after as number | undefined,
        };
        return ok(this.buildErrorResponse(message, errorPayload));
      }
    } catch (e) {
      const errorPayload: RPCErrorPayload = {
        error_code: 'ACP-E017',
        error_message: e instanceof Error ? e.message : 'Internal RPC error',
        retryable: false,
      };
      return ok(this.buildErrorResponse(message, errorPayload));
    }
  }

  /**
   * List registered methods.
   */
  listMethods(): string[] {
    return [...this.handlers.keys()];
  }

  private buildResponseMessage(request: ACPMessage, payload: RPCResponsePayload): ACPMessage {
    return buildMessage(
      'rpc.response',
      request.channel,
      request.priority,
      request.recipient as AgentID,
      request.sender,
      payload,
      { correlation_id: request.id },
    );
  }

  private buildErrorResponse(request: ACPMessage, payload: RPCErrorPayload): ACPMessage {
    return buildMessage(
      'rpc.error',
      request.channel,
      request.priority,
      request.recipient as AgentID,
      request.sender,
      payload,
      { correlation_id: request.id },
    );
  }
}

/**
 * RPCClient sends RPC requests and awaits responses.
 * Supports timeout, retry with backoff, and idempotency.
 */
export class RPCClient {
  private senderId: AgentID;
  private defaultTimeoutMs: number;
  private defaultMaxRetries: number;
  private pendingRequests = new Map<string, PendingRequest>();
  private responseResolver = new Map<string, (message: ACPMessage) => void>();

  constructor(senderId: AgentID, opts?: { timeoutMs?: number; maxRetries?: number }) {
    this.senderId = senderId;
    this.defaultTimeoutMs = opts?.timeoutMs ?? RPC_DEFAULT_TIMEOUT_MS;
    this.defaultMaxRetries = opts?.maxRetries ?? RPC_MAX_RETRIES;
  }

  /**
   * Build an RPC request message (does not send).
   */
  buildRequest(
    channel: string,
    recipient: AgentID,
    method: string,
    params: unknown,
    opts?: RPCClientOpts,
  ): ACPMessage {
    const payload: RPCRequestPayload = {
      method,
      params,
      idempotency_key: opts?.idempotencyKey,
      timeout_ms: opts?.timeoutMs ?? this.defaultTimeoutMs,
    };

    return buildMessage(
      'rpc.request',
      channel,
      2, // HIGH priority for RPC
      this.senderId,
      recipient,
      payload,
      { ttl: opts?.timeoutMs ?? this.defaultTimeoutMs },
    );
  }

  /**
   * Execute an RPC call with timeout and retries.
   * The sendFn is called with the request message and should deliver it to the server.
   * The response comes back via handleResponse.
   */
  async call(
    channel: string,
    recipient: AgentID,
    method: string,
    params: unknown,
    sendFn: (message: ACPMessage) => void,
    opts?: RPCClientOpts,
  ): Promise<Outcome<unknown>> {
    const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;
    const maxRetries = opts?.maxRetries ?? this.defaultMaxRetries;
    const backoff = createBackoffIterator({ maxRetries });

    let lastError: Outcome<unknown> | null = null;

    while (true) {
      const state = backoff.next();
      if (state.exhausted && state.nextDelayMs === 0 && backoff.getAttempt() >= maxRetries) {
        break;
      }

      const request = this.buildRequest(channel, recipient, method, params, opts);

      const responsePromise = new Promise<Outcome<ACPMessage>>((resolve) => {
        this.responseResolver.set(request.id, (msg: ACPMessage) => {
          resolve(ok(msg));
        });

        // Set up timeout
        setTimeout(() => {
          this.responseResolver.delete(request.id);
          resolve(ok(this.buildTimeoutResponse(request)));
        }, timeoutMs);
      });

      sendFn(request);

      const responseResult = await responsePromise;
      this.responseResolver.delete(request.id);

      if (responseResult.ok) {
        const response = responseResult.data;
        const payload = response.payload as RPCResponsePayload | RPCErrorPayload;

        if (response.type === 'rpc.response') {
          return ok((payload as RPCResponsePayload).result);
        }

        if (response.type === 'rpc.error') {
          const rpcError = payload as RPCErrorPayload;
          if (!rpcError.retryable) {
            return err(rpcError.error_code, rpcError.error_message);
          }
          lastError = err(rpcError.error_code, rpcError.error_message, { retryable: true });

          // Retry with backoff
          const backoffState = backoff.next();
          if (backoffState.exhausted) break;
          await sleep(backoffState.nextDelayMs);
          continue;
        }
      }

      // Timeout - retry
      lastError = rpcTimeout(method, timeoutMs);
      const backoffState = backoff.next();
      if (backoffState.exhausted) break;
      await sleep(backoffState.nextDelayMs);
    }

    if (lastError) return lastError;
    return rpcMaxRetries(method, maxRetries);
  }

  /**
   * Handle an incoming response message.
   * Resolves the pending request if one exists.
   */
  handleResponse(message: ACPMessage): void {
    if (!message.correlation_id) return;
    const resolver = this.responseResolver.get(message.correlation_id);
    if (resolver) {
      resolver(message);
    }
  }

  private buildTimeoutResponse(request: ACPMessage): ACPMessage {
    const payload: RPCErrorPayload = {
      error_code: 'ACP-E010',
      error_message: `RPC call timed out`,
      retryable: true,
    };
    return buildMessage(
      'rpc.error',
      request.channel,
      request.priority,
      request.recipient as AgentID,
      request.sender,
      payload,
      { correlation_id: request.id },
    );
  }
}