/**
 * Message validation against Zod schemas from @agentos/types
 */

import { zACPMessage, zMessageType, zLivenessState } from '@agentos/types/zod';
import { ok, err } from '@agentos/types';
import type { Outcome, MessageType, LivenessState } from '@agentos/types';

/**
 * Validate an ACPMessage against the Zod schema.
 * Returns ok(true) if valid, or err with details if invalid.
 */
export function validateACPMessage(message: unknown): Outcome<true> {
  const result = zACPMessage.safeParse(message);
  if (result.success) {
    return ok(true);
  }
  const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  return err('ACP-E007', `Message validation failed: ${issues}`);
}

/**
 * Validate a message type string.
 */
export function validateMessageType(type: string): Outcome<MessageType> {
  const result = zMessageType.safeParse(type);
  if (result.success) {
    return ok(result.data as MessageType);
  }
  return err('ACP-E007', `Invalid message type: ${type}`);
}

/**
 * Validate a liveness state string.
 */
export function validateLivenessState(state: string): Outcome<LivenessState> {
  const result = zLivenessState.safeParse(state);
  if (result.success) {
    return ok(result.data as LivenessState);
  }
  return err('ACP-E007', `Invalid liveness state: ${state}`);
}