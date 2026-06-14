import type { APIRoute } from 'astro';
import { exchangeCode, fetchGitHubLogin, isAllowed, writeSession } from '../../lib/auth';

export const GET: APIRoute = async (ctx) => {
  const env = (ctx.locals as any).runtime?.env ?? process.env;
  const code = ctx.url.searchParams.get('code');
  const stateRaw = ctx.url.searchParams.get('state');
  if (!code || !stateRaw) return new Response('Bad request', { status: 400 });

  let next = '/';
  try {
    const state = JSON.parse(atob(stateRaw)) as { next?: string };
    if (state.next && state.next.startsWith('/')) next = state.next;
  } catch {
    // ignore
  }

  const redirectUri = new URL('/auth/callback', ctx.url).toString();
  let token: string;
  try {
    token = await exchangeCode(env, code, redirectUri);
  } catch (err) {
    return new Response(`OAuth error: ${(err as Error).message}`, { status: 400 });
  }

  let login: string;
  try {
    login = await fetchGitHubLogin(token);
  } catch (err) {
    return new Response(`GitHub error: ${(err as Error).message}`, { status: 400 });
  }

  if (!isAllowed(login, env)) {
    return new Response(`User '${login}' is not allowed on this instance.`, { status: 403 });
  }

  await writeSession(ctx, { token, login });
  return ctx.redirect(next);
};
