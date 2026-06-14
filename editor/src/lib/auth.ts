import { EncryptJWT, jwtDecrypt } from 'jose';
import type { APIContext } from 'astro';
import { oauth } from './config';

const SESSION_COOKIE = 'riovv_session';
const SESSION_TTL_DAYS = 30;

export interface Session {
  token: string;        // GitHub OAuth access token (repo scope)
  login: string;        // GitHub username
  iat?: number;
  exp?: number;
}

function key(secret: string): Uint8Array {
  // Hex string -> bytes; pad/trim to 32 bytes for A256GCM.
  const hex = secret.replace(/^0x/, '').replace(/[^0-9a-f]/gi, '').padEnd(64, '0').slice(0, 64);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function readSession(ctx: APIContext): Promise<Session | null> {
  const cookie = ctx.cookies.get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const env = (ctx.locals as any).runtime?.env ?? process.env;
    const { sessionSecret } = oauth(env);
    const { payload } = await jwtDecrypt(cookie, key(sessionSecret));
    return payload as unknown as Session;
  } catch {
    return null;
  }
}

export async function writeSession(ctx: APIContext, session: Session): Promise<void> {
  const env = (ctx.locals as any).runtime?.env ?? process.env;
  const { sessionSecret, cookieDomain } = oauth(env);
  const jwt = await new EncryptJWT({ ...session })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .encrypt(key(sessionSecret));

  ctx.cookies.set(SESSION_COOKIE, jwt, {
    httpOnly: true,
    secure: ctx.url.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    domain: cookieDomain,
    maxAge: 60 * 60 * 24 * SESSION_TTL_DAYS,
  });
}

export function clearSession(ctx: APIContext): void {
  ctx.cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function isAllowed(login: string, env: Record<string, string | undefined>): boolean {
  const { allowedUsers } = oauth(env);
  return allowedUsers.length === 0 ? true : allowedUsers.includes(login);
}

/** GitHub OAuth URLs. */
export function authorizeUrl(env: Record<string, string | undefined>, state: string, redirectUri: string): string {
  const { clientId } = oauth(env);
  const u = new URL('https://github.com/login/oauth/authorize');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('scope', 'repo');
  u.searchParams.set('state', state);
  return u.toString();
}

export async function exchangeCode(
  env: Record<string, string | undefined>,
  code: string,
  redirectUri: string,
): Promise<string> {
  const { clientId, clientSecret } = oauth(env);
  const r = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!r.ok) throw new Error(`OAuth exchange failed: ${r.status}`);
  const data = (await r.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`OAuth exchange returned: ${data.error ?? 'unknown'}`);
  return data.access_token;
}

export async function fetchGitHubLogin(token: string): Promise<string> {
  const r = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'riovv-editor',
    },
  });
  if (!r.ok) throw new Error(`GitHub user fetch failed: ${r.status}`);
  const data = (await r.json()) as { login?: string };
  if (!data.login) throw new Error('GitHub user has no login');
  return data.login;
}
