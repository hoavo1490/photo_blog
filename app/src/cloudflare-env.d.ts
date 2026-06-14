// Ambient declaration of the bindings exposed by the Workers runtime in
// tests and in production. Astro's Cloudflare adapter resolves the live
// env at runtime via `context.locals.runtime.env`; this declaration
// gives us types for both the production code and the
// `import { env } from 'cloudflare:test'` test helper.

declare namespace Cloudflare {
  interface Env {
    PHOTOS: import('@cloudflare/workers-types').R2Bucket;
    R2_PUBLIC_BASE?: string;
    R2_DEV_BASE?: string;
  }
}

// Astro adapter convenience alias -- some helpers expect a top-level
// `Env` type. Keep them in sync.
interface Env extends Cloudflare.Env {}
