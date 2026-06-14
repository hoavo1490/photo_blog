import { defineConfig } from 'vitest/config';

// Phase 2: pure unit tests + DB integration tests run in Node pool.
// PGLite is pure JS so it doesn't need workerd. Phase 3 adds a second
// project for R2 + route tests using @cloudflare/vitest-pool-workers.
export default defineConfig({
  test: {
    include: [
      'src/**/*.unit.test.ts',
      'src/**/*.integration.test.ts',
      'tests/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 15_000,
  },
});
