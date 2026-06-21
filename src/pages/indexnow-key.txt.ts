// IndexNow ownership-verification file. Serves the INDEXNOW_KEY secret
// as plain text so search engines can confirm we own the host before
// honoring our IndexNow submissions. 404 when unset so misconfigured
// environments don't accidentally expose anything unexpected.

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const GET: APIRoute = () => {
  const key = (env as unknown as { INDEXNOW_KEY?: string }).INDEXNOW_KEY;
  if (!key) return new Response('Not found', { status: 404 });
  return new Response(key, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // Long cache because the key only changes when the operator
      // explicitly rotates the secret.
      'cache-control': 'public, max-age=86400, s-maxage=86400',
    },
  });
};
