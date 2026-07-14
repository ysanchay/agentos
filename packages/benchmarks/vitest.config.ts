import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts', 'src/**/*.test.ts', 'src/cli/**', 'src/dogfooding-templates.ts', 'src/feedback-collector.ts', 'src/real-world-tasks.ts'],
      thresholds: { lines: 15, branches: 10, functions: 20, statements: 15 },
    },
  },
});