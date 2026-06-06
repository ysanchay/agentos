/**
 * Ed25519 Key Generation, Signing, Verification, and KeyRegistry
 * Uses @noble/ed25519 for cryptographic operations
 */

import * as ed from '@noble/ed25519';
import { ok, err } from '@agentos/types';
import type { Outcome, AgentID } from '@agentos/types';
import { ACP_E } from '@agentos/types';
import { canonicalForm } from './message.js';
import type { ACPMessage } from '@agentos/types';
import type { ACPError } from '@agentos/types';

export interface KeyEntry {
  agentId: AgentID;
  publicKey: string; // hex
  version: number;
  revoked: boolean;
  registeredAt: string;
  rotatedAt?: string;
}

// Hex conversion utilities (no Buffer dependency)

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Generate an Ed25519 key pair.
 * Returns { privateKey: hex string, publicKey: hex string }
 * Uses async API since @noble/ed25519 v2 uses WebCrypto for SHA-512.
 */
export async function generateKeyPair(): Promise<{ privateKey: string; publicKey: string }> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    privateKey: bytesToHex(privateKey),
    publicKey: bytesToHex(publicKey),
  };
}

/**
 * Sign a message using Ed25519.
 * @param privateKeyHex - hex-encoded private key
 * @param message - the ACPMessage to sign
 * @returns hex-encoded signature
 */
export async function signMessage(privateKeyHex: string, message: ACPMessage): Promise<string> {
  const canonical = canonicalForm(message);
  const messageBytes = new TextEncoder().encode(canonical);
  const privateKey = hexToBytes(privateKeyHex);
  const signature = await ed.signAsync(messageBytes, privateKey);
  return bytesToHex(signature);
}

/**
 * Verify a message signature using Ed25519.
 * @param publicKeyHex - hex-encoded public key
 * @param message - the ACPMessage with signature to verify
 * @returns true if signature is valid
 */
export async function verifySignature(publicKeyHex: string, message: ACPMessage): Promise<boolean> {
  try {
    const canonical = canonicalForm(message);
    const messageBytes = new TextEncoder().encode(canonical);
    const publicKey = hexToBytes(publicKeyHex);
    const signature = hexToBytes(message.signature);
    return await ed.verifyAsync(signature, messageBytes, publicKey);
  } catch {
    return false;
  }
}

/**
 * Sign raw bytes using Ed25519.
 */
export async function signBytes(privateKeyHex: string, data: Uint8Array): Promise<string> {
  const privateKey = hexToBytes(privateKeyHex);
  const signature = await ed.signAsync(data, privateKey);
  return bytesToHex(signature);
}

/**
 * Verify raw bytes signature using Ed25519.
 */
export async function verifyBytes(publicKeyHex: string, signatureHex: string, data: Uint8Array): Promise<boolean> {
  try {
    const publicKey = hexToBytes(publicKeyHex);
    const signature = hexToBytes(signatureHex);
    return await ed.verifyAsync(signature, data, publicKey);
  } catch {
    return false;
  }
}

/**
 * KeyRegistry manages agent public keys with registration, rotation, and revocation.
 */
export class KeyRegistry {
  private keys = new Map<string, KeyEntry>();

  /**
   * Register a new public key for an agent.
   * Returns error if key already registered and not revoked.
   */
  register(agentId: AgentID, publicKey: string): Outcome<KeyEntry> {
    const existing = this.findEntry(agentId);
    if (existing && !existing.revoked) {
      return err(ACP_E.KEY_REVOKED, `Agent ${agentId} already has an active key; use rotate instead`);
    }

    const entry: KeyEntry = {
      agentId,
      publicKey,
      version: existing ? existing.version + 1 : 1,
      revoked: false,
      registeredAt: new Date().toISOString(),
    };
    this.keys.set(this.key(agentId), entry);
    return ok(entry);
  }

  /**
   * Rotate an agent's key: register a new public key, incrementing the version.
   * Returns error if no existing active key.
   */
  rotate(agentId: AgentID, newPublicKey: string): Outcome<KeyEntry> {
    const existing = this.findEntry(agentId);
    if (!existing) {
      return err(ACP_E.KEY_NOT_FOUND, `Key not found: ${agentId}`);
    }
    if (existing.revoked) {
      return err(ACP_E.KEY_REVOKED, `Key has been revoked: ${agentId}`);
    }

    const entry: KeyEntry = {
      agentId,
      publicKey: newPublicKey,
      version: existing.version + 1,
      revoked: false,
      registeredAt: existing.registeredAt,
      rotatedAt: new Date().toISOString(),
    };
    this.keys.set(this.key(agentId), entry);
    return ok(entry);
  }

  /**
   * Revoke an agent's key. After revocation, messages signed with this key are invalid.
   */
  revoke(agentId: AgentID): Outcome<true> {
    const existing = this.findEntry(agentId);
    if (!existing) {
      return err(ACP_E.KEY_NOT_FOUND, `Key not found: ${agentId}`);
    }
    existing.revoked = true;
    return ok(true);
  }

  /**
   * Get the active public key for an agent.
   * Returns error if key not found or revoked.
   */
  getPublicKey(agentId: AgentID): Outcome<string> {
    const existing = this.findEntry(agentId);
    if (!existing) {
      return err(ACP_E.KEY_NOT_FOUND, `Key not found: ${agentId}`);
    }
    if (existing.revoked) {
      return err(ACP_E.KEY_REVOKED, `Key has been revoked: ${agentId}`);
    }
    return ok(existing.publicKey);
  }

  /**
   * Verify a message's signature against the registered key for its sender.
   * Returns a promise since verification is async.
   */
  async verifyMessage(message: ACPMessage): Promise<Outcome<true>> {
    const keyResult = this.getPublicKey(message.sender);
    if (!keyResult.ok) {
      return keyResult;
    }
    const valid = await verifySignature(keyResult.data, message);
    if (!valid) {
      return err(ACP_E.SIGNATURE_INVALID, 'Message signature verification failed');
    }
    return ok(true);
  }

  private key(agentId: string): string {
    return `key:${agentId}`;
  }

  private findEntry(agentId: string): KeyEntry | undefined {
    return this.keys.get(this.key(agentId));
  }
}