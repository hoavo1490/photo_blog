import type { APIRoute } from 'astro';
import * as posts from '../../../lib/db/posts';
import type { SqlDriver } from '../../../lib/db/driver';

export const POST: APIRoute = async (ctx) => {
  const session = ctx.locals.session;
  if (!session) return new Response('unauthorized', { status: 401 });
  const driver = ctx.locals.db! as SqlDriver;
  const { postId, siteId } = (await ctx.request.json()) as { postId: string; siteId: string };

  const member = await driver.query<{ role: string }>(
    `SELECT role FROM site_members WHERE site_id = $1 AND user_id = $2`,
    [siteId, session.userId],
  );
  if (member.length === 0) return new Response('forbidden', { status: 403 });

  await posts.del(driver, { siteId, id: postId });
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
};
