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
    // Point LLM-driven crawlers at our /llms.txt summary. Standard
    // robots.txt clients ignore unknown directives; this line is a
    // hint for the emerging convention.
    `LLM-Content: ${url.origin}/llms.txt`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
