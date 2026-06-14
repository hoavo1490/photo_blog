import type { APIRoute } from 'astro';
import { clearSession } from '../lib/auth';

export const GET: APIRoute = async (ctx) => {
  clearSession(ctx);
  return ctx.redirect('/login');
};
