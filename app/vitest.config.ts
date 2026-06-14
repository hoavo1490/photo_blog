import { defineConfig } from 'vitest/config';

// Phase 1: unit tests only (pure helpers, no bindings needed).
// Phase 2+ will add a second `projects` entry using @cloudflare/vitest-pool-workers
// for DB / R2 / route integration tests.
export default defineConfig({
  test: {
    include: ['src/**/*.unit.test.ts', 'tests/**/*.unit.test.ts'],
    environment: 'node',
  },
});
