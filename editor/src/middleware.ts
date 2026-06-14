import { defineMiddleware } from 'astro:middleware';
import { readSession } from './lib/auth';

const PUBLIC = new Set([
  '/login',
  '/auth/callback',
  '/logout',
]);

export const onRequest = defineMiddleware(async (ctx, next) => {
  const path = ctx.url.pathname;
  if (PUBLIC.has(path) || path.startsWith('/_') || path === '/favicon.ico') {
    return next();
  }
  const session = await readSession(ctx);
  if (!session) {
    return ctx.redirect(`/login?next=${encodeURIComponent(path + ctx.url.search)}`);
  }
  // Stash session on locals for route handlers.
  (ctx.locals as any).session = session;
  return next();
});
