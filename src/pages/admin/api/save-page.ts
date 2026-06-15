import type { APIRoute } from 'astro';
import * as pages from '../../../lib/db/pages';
import type { SqlDriver } from '../../../lib/db/driver';

interface SavePageBody {
  siteId: string;
  slug: string;
  body: string;
}

// Slugs are part of the public URL (/about, /contact, ...). Restrict
// to lowercase letters, digits, and hyphens so traversal / weird
// characters can't break routing or smuggle paths through the editor.
const SAFE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export const POST: APIRoute = async (ctx) => {
  const session = ctx.locals.session;
  if (!session) return new Response('unauthorized', { status: 401 });
  const driver = ctx.locals.db! as SqlDriver;
  const b = (await ctx.request.json()) as SavePageBody;

  if (!b.siteId) return new Response('siteId required', { status: 400 });
  if (!b.slug || !SAFE_SLUG.test(b.slug)) {
    return new Response('invalid slug', { status: 400 });
  }

  // Tenant isolation: the user must be a member of the target site.
  const member = await driver.query<{ role: string }>(
    `SELECT role FROM site_members WHERE site_id = $1 AND user_id = $2`,
    [b.siteId, session.userId],
  );
  if (member.length === 0) return new Response('forbidden', { status: 403 });

  const saved = await pages.upsertPage(driver, {
    siteId: b.siteId, slug: b.slug, body: b.body ?? '',
  });
  return new Response(JSON.stringify({ id: saved.id, slug: saved.slug }), {
    headers: { 'content-type': 'application/json' },
  });
};
