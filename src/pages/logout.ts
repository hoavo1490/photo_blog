import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import * as sessions from '../lib/db/sessions';
import { buildClearCookie } from '../lib/auth/session-cookie';

export const GET: APIRoute = async (ctx) => {
  const driver = ctx.locals.db;
  const session = ctx.locals.session;
  if (driver && session) {
    await sessions.revoke(driver, session.sessionId);
  }
  const e = env as unknown as { COOKIE_DOMAIN?: string };
  const clear = buildClearCookie({ domain: e.COOKIE_DOMAIN, secure: ctx.url.protocol === 'https:' });
  return new Response(null, {
    status: 302,
    headers: { location: '/login', 'set-cookie': clear },
  });
};
