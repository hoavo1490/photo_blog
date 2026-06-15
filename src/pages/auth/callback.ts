import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createGitHubOAuth } from '../../lib/auth/oauth';
import { completeLogin } from '../../lib/auth/login-flow';
import { buildSessionCookie } from '../../lib/auth/session-cookie';
import {
  safeNext,
  parseStateNonce,
  readOAuthStateCookie,
  buildClearOAuthStateCookie,
} from './callback-validators';

export const GET: APIRoute = async (ctx) => {
  const driver = ctx.locals.db;
  if (!driver) return new Response('DB not bound', { status: 500 });

  const code = ctx.url.searchParams.get('code');
  const stateRaw = ctx.url.searchParams.get('state');
  if (!code || !stateRaw) return new Response('Missing code/state', { status: 400 });

  // CSRF defense: the server-issued nonce inside `state` must match a
  // server-set cookie. Without this, an attacker can paste a forged
  // ?code= into the victim's browser and log them into the attacker's
  // GitHub account (login CSRF).
  const stateNonce = parseStateNonce(stateRaw);
  const cookieNonce = readOAuthStateCookie(ctx.request.headers.get('cookie'));
  if (!stateNonce || !cookieNonce || stateNonce !== cookieNonce) {
    return new Response('Invalid OAuth state', { status: 400 });
  }

  // Same-origin redirect target. Anything else (protocol-relative,
  // absolute external, garbage) falls back to /admin.
  let nextRaw: string | null = null;
  try {
    const s = JSON.parse(atob(stateRaw)) as { next?: unknown };
    if (typeof s.next === 'string') nextRaw = s.next;
  } catch {
    // ignore
  }
  const next = safeNext(nextRaw, ctx.url.origin);

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

  const secure = ctx.url.protocol === 'https:';
  const sessionCookie = buildSessionCookie(result.sessionId, {
    domain: e.COOKIE_DOMAIN,
    secure,
  });
  // Clear the one-shot OAuth state cookie now that we've verified it.
  const clearStateCookie = buildClearOAuthStateCookie({ domain: e.COOKIE_DOMAIN, secure });

  const headers = new Headers();
  headers.set('location', next);
  headers.append('set-cookie', sessionCookie);
  headers.append('set-cookie', clearStateCookie);
  return new Response(null, { status: 302, headers });
};
