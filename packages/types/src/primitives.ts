/**
 * AgentOS Primitive Types
 * Branded UUID types for type-safe identification across the system.
 * All IDs are UUID v7 (time-ordered, sortable).
 */

// Branded type factory for type-safe IDs
type Brand<T, B extends string> = T & { readonly __brand: B };

export type UUID = Brand<string, 'UUID'>;
export type AgentID = Brand<string, 'AgentID'>;
export type TaskID = Brand<string, 'TaskID'>;
export type WorkspaceID = Brand<string, 'WorkspaceID'>;
export type ProjectID = Brand<string, 'ProjectID'>;
export type CapabilityID = Brand<string, 'CapabilityID'>;
export type PermissionID = Brand<string, 'PermissionID'>;
export type MemoryID = Brand<string, 'MemoryID'>;
export type AllocationID = Brand<string, 'AllocationID'>;
export type EventID = Brand<string, 'EventID'>;
export type ApprovalID = Brand<string, 'ApprovalID'>;
export type UserID = Brand<string, 'UserID'>;
export type OrgID = Brand<string, 'OrgID'>;
export type ChannelID = Brand<string, 'ChannelID'>;
export type ProviderID = Brand<string, 'ProviderID'>;
export type ServiceID = Brand<string, 'ServiceID'>;
export type InvocationID = Brand<string, 'InvocationID'>;
export type SubscriptionID = Brand<string, 'SubscriptionID'>;
export type LockID = Brand<string, 'LockID'>;
export type ConsensusID = Brand<string, 'ConsensusID'>;

// UUID v7 validation regex (simplified — 8-4-4-4-12 hex format with version 7 indicator)
const UUID_V7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validate that a string is a valid UUID v7 */
export function isUUID(value: string): value is UUID {
  return UUID_V7_REGEX.test(value);
}

/** Cast a string to a branded UUID type (use only when you know the value is valid) */
export function asUUID<T extends UUID>(value: string): T {
  return value as T;
}

/** Create a UUID v7 (simplified — uses crypto.randomUUID which is v4 in most runtimes;
 * production should use a proper v7 library) */
export function createUUID(): UUID {
  // For now, use crypto.randomUUID(). In production, replace with uuid v7.
  return crypto.randomUUID() as UUID;
}