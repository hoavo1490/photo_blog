import { defineConfig } from 'vitest/config';
import { cloudflarePool, cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Two projects:
//   * `unit`    -- pure helpers + DB integration tests. Runs in Node;
//                  PGLite is pure JS so it doesn't need workerd.
//   * `workers` -- anything that touches a Cloudflare binding (R2 today,
//                  KV/D1/route handlers later). Runs in workerd via the
//                  `@cloudflare/vitest-pool-workers` integration.
//
// `@cloudflare/vitest-pool-workers@0.16.x` (built for vitest 4) does NOT
// export `defineWorkersProject`. The supported wiring is:
//   * `pool: cloudflarePool(opts)` -- the PoolRunnerInitializer
//   * `plugins: [cloudflareTest(opts)]` -- the Vite plugin
// with the *same* options passed to both.
// Bindings are declared inline rather than via `wrangler.configPath`
// because the production wrangler.jsonc points `main` at the Astro
// Cloudflare entrypoint, which imports Astro virtual modules that don't
// resolve outside an Astro build. The test pool only needs R2 + vars.
const workersOptions = {
  miniflare: {
    compatibilityDate: '2026-06-01',
    compatibilityFlags: ['nodejs_compat'],
    r2Buckets: ['PHOTOS'],
    bindings: {
      R2_PUBLIC_BASE: 'https://media.test',
      R2_DEV_BASE: 'https://test.r2.dev',
    },
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: [
            'src/**/*.unit.test.ts',
            'src/**/*.integration.test.ts',
            'tests/**/*.test.ts',
          ],
          environment: 'node',
          testTimeout: 15_000,
          // PGLite cold-start is ~1-3s; under parallel file execution
          // the default 10s hook timeout can be exceeded when multiple
          // integration test files spin up at once.
          hookTimeout: 30_000,
        },
      },
      {
        plugins: [cloudflareTest(workersOptions)],
        test: {
          name: 'workers',
          include: ['src/**/*.workers.test.ts'],
          pool: cloudflarePool(workersOptions),
        },
      },
    ],
  },
});
