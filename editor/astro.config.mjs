// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import { config as loadDotenv } from 'dotenv';

// Populate process.env from .env for local dev. In Cloudflare prod the env
// comes from bindings via locals.runtime.env, so this is a no-op there.
loadDotenv();

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true },
  }),
  site: 'https://editor.riovv.com',
  vite: {
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
  },
});
