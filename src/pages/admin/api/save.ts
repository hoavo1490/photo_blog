import type { APIRoute } from 'astro';
import * as posts from '../../../lib/db/posts';
import * as tags from '../../../lib/db/tags';
import { slugify } from '../../../lib/slug';
import type { SqlDriver } from '../../../lib/db/driver';

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
    const updated = await posts.update(driver, {
      siteId: b.siteId, id: b.postId, title: b.title, body: b.body,
      coverImageId,
    });
    if (!updated) return new Response('not found', { status: 404 });
    postId = updated.id;
    // On edit we deliberately do NOT call posts.publish: publish is a
    // state transition, not a re-save. The form's date input always
    // defaults to today, so passing it through here would silently
    // move published_at on every edit and break the /YYYY/MM/DD/slug
    // URLs of every previously published post.
  }

  // Replace tag set.
  await tags.setPostTags(driver, { siteId: b.siteId, postId, tagNames: b.tagNames });

  return new Response(JSON.stringify({ id: postId, slug }), {
    headers: { 'content-type': 'application/json' },
  });
};
