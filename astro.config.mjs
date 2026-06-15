// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  site: 'https://hoavv.com',
  // Inline the tiny per-component stylesheets directly into the HTML
  // instead of emitting separate render-blocking <link rel="stylesheet">
  // requests. Astro hashes their content so re-renders stay cache-stable.
  build: { inlineStylesheets: 'always' },
  // Automatic prefetch on hover for every internal <a>. Cards on the
  // home page prefetch their post HTML when the user starts hovering,
  // so clicks feel instant. Respects Save-Data and reduced-data
  // connections automatically.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
});
