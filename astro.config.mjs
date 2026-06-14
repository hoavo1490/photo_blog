// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  site: 'https://riovv.com',
  // Inline the tiny per-component stylesheets directly into the HTML
  // instead of emitting separate render-blocking <link rel="stylesheet">
  // requests. Astro hashes their content so re-renders stay cache-stable.
  build: { inlineStylesheets: 'always' },
});
