import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import * as posts from '../../../lib/db/posts';
import * as tags from '../../../lib/db/tags';
import { slugify } from '../../../lib/slug';
import type { SqlDriver } from '../../../lib/db/driver';
import { pingIndexNow, type IndexNowEnv } from '../../../lib/indexnow';
import { postUrl } from '../../../lib/post-url';

interface SaveBody {
  mode: 'new' | 'edit';
  postId: string | null;
  siteId: string;
  title: string;
  slug?: string;
  date?: string;
  body: string;
  tagNames: string[];
  coverImageId?: string | null;
}

export const POST: APIRoute = async (ctx) => {
  const session = ctx.locals.session;
  if (!session) return new Response('unauthorized', { status: 401 });
  const driver = ctx.locals.db! as SqlDriver;
  const b = (await ctx.request.json()) as SaveBody;

  // Verify the user is a member of the target site.
  const member = await driver.query<{ role: string }>(
    `SELECT role FROM site_members WHERE site_id = $1 AND user_id = $2`,
    [b.siteId, session.userId],
  );
  if (member.length === 0) return new Response('forbidden', { status: 403 });

  if (!b.title?.trim()) return new Response('title required', { status: 400 });

  const slug = (b.slug && b.slug.trim()) || slugify(b.title);
  if (!slug) return new Response('could not derive slug', { status: 400 });

  // coverImageId === null clears cover; undefined leaves untouched.
  const coverImageId = b.coverImageId === undefined ? undefined : (b.coverImageId || null);

  let postId: string;
  if (b.mode === 'new') {
    const created = await posts.createDraft(driver, {
      siteId: b.siteId, slug, title: b.title, body: b.body,
      coverImageId: coverImageId ?? null,
    });
    postId = created.id;
    // First save is the state transition draft -> published; the form's
    // date acts as the published_at stamp.
    const publishedAt = b.date ? new Date(`${b.date}T12:00:00Z`) : undefined;
    await posts.publish(driver, { siteId: b.siteId, id: postId, publishedAt });
  } else {
    if (!b.postId) return new Response('postId required for edit', { status: 400 });
    // Only published posts carry a published_at, and only the date chip
    // in the editor surfaces it. When the editor sends a date for an
    // already-published post, stamp published_at to that day at noon UTC
    // (matching the createDraft -> publish path). For drafts we DO NOT
    // restamp -- editing a draft must not silently publish it.
    const existing = await posts.findById(driver, { siteId: b.siteId, id: b.postId });
    if (!existing) return new Response('not found', { status: 404 });
    const publishedAt = (b.date && existing.status === 'published')
      ? new Date(`${b.date}T12:00:00Z`)
      : undefined;
    const updated = await posts.update(driver, {
      siteId: b.siteId, id: b.postId, title: b.title, body: b.body,
      coverImageId, publishedAt,
    });
    if (!updated) return new Response('not found', { status: 404 });
    postId = updated.id;
  }

  // Replace tag set.
  await tags.setPostTags(driver, { siteId: b.siteId, postId, tagNames: b.tagNames });

  // IndexNow ping: fire-and-forget. Includes the post URL plus the index
  // pages whose content just changed (home, archive, every tag's
  // landing). Search engines pull the URLs and re-crawl within minutes.
  const tenant = ctx.locals.tenant;
  if (tenant) {
    const host = tenant.customDomain ?? ctx.url.hostname;
    const final = await posts.findById(driver, { siteId: b.siteId, id: postId });
    if (final?.publishedAt) {
      const urls = [
        `https://${host}${postUrl({ publishedAt: final.publishedAt, slug: final.slug })}`,
        `https://${host}/`,
        `https://${host}/archive`,
        ...b.tagNames.map((t) => `https://${host}/tags/${slugify(t)}`),
      ];
      const pingPromise = pingIndexNow({ env: env as unknown as IndexNowEnv, host, urls });
      // ctx.locals.waitUntil keeps the work alive after Response returns.
      const wait = (ctx.locals as { waitUntil?: (p: Promise<unknown>) => void }).waitUntil;
      if (wait) wait(pingPromise); else void pingPromise;
    }
  }

  return new Response(JSON.stringify({ id: postId, slug }), {
    headers: { 'content-type': 'application/json' },
  });
};
