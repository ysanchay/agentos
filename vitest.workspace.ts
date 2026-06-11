import { defineWorkspace } from 'vitest/workspace';

export default defineWorkspace([
  'packages/types/vitest.config.ts',
  'packages/protocol/vitest.config.ts',
  'packages/kernel/vitest.config.ts',
  'packages/eventstore/vitest.config.ts',
  'packages/blackboard/vitest.config.ts',
  'packages/resources/vitest.config.ts',
  'packages/simulation/vitest.config.ts',
  'packages/llm/vitest.config.ts',
  'packages/swarm/vitest.config.ts',
  'packages/memory/vitest.config.ts',
  'packages/capabilities/vitest.config.ts',
  'packages/browser/vitest.config.ts',
  'packages/desktop/vitest.config.ts',
]);