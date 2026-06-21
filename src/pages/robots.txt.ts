import type { APIRoute } from 'astro';

// Dynamic so the sitemap URL tracks the actually-served host. Workers.dev
// preview and the eventual custom domain both get correct sitemap links
// without rebuilding.

export const GET: APIRoute = ({ url }) => {
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin/',
    'Disallow: /admin',
    'Disallow: /login',
    'Disallow: /logout',
    'Disallow: /auth/',
    '',
    `Sitemap: ${url.origin}/sitemap.xml`,
    // Used to emit an `LLM-Content:` hint pointing at /llms.txt -- that
    // directive isn't part of the robots.txt spec (Google's validator
    // flagged the whole file as invalid). LLM crawlers find /llms.txt
    // via the well-known path convention instead; no directive needed.
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
