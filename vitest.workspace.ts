import { defineWorkspace } from 'vitest/workspace';

export default defineWorkspace([
  'packages/types/vitest.config.ts',
  'packages/protocol/vitest.config.ts',
  'packages/kernel/vitest.config.ts',
  'packages/eventstore/vitest.config.ts',
  'packages/blackboard/vitest.config.ts',
  'packages/resources/vitest.config.ts',
  'packages/simulation/vitest.config.ts',
]);