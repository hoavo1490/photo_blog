import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createGitHubOAuth } from '../../lib/auth/oauth';
import { completeLogin } from '../../lib/auth/login-flow';
import { buildSessionCookie } from '../../lib/auth/session-cookie';

export const GET: APIRoute = async (ctx) => {
  const driver = ctx.locals.db;
  if (!driver) return new Response('DB not bound', { status: 500 });

  const code = ctx.url.searchParams.get('code');
  const stateRaw = ctx.url.searchParams.get('state');
  if (!code || !stateRaw) return new Response('Missing code/state', { status: 400 });

  let next = '/admin';
  try {
    const s = JSON.parse(atob(stateRaw)) as { next?: string };
    if (s.next && s.next.startsWith('/')) next = s.next;
  } catch {
    // ignore
  }

  const e = env as unknown as {
    GITHUB_OAUTH_CLIENT_ID: string;
    GITHUB_OAUTH_CLIENT_SECRET: string;
    ALLOWED_USERS?: string;
    COOKIE_DOMAIN?: string;
  };

  const oauth = createGitHubOAuth({
    clientId: e.GITHUB_OAUTH_CLIENT_ID,
    clientSecret: e.GITHUB_OAUTH_CLIENT_SECRET,
  });

  const allowed = (e.ALLOWED_USERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const redirectUri = new URL('/auth/callback', ctx.url).toString();

  let result;
  try {
    result = await completeLogin(driver, oauth, allowed, {
      code,
      redirectUri,
      userAgent: ctx.request.headers.get('user-agent'),
    });
  } catch (err) {
    return new Response(`Login failed: ${(err as Error).message}`, { status: 403 });
  }

  const cookie = buildSessionCookie(result.sessionId, {
    domain: e.COOKIE_DOMAIN,
    secure: ctx.url.protocol === 'https:',
  });

  return new Response(null, {
    status: 302,
    headers: { location: next, 'set-cookie': cookie },
  });
};
