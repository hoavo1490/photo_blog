import type { APIRoute } from 'astro';
import * as albums from '~/lib/db/albums';
import { slugify } from '~/lib/slug';
import type { SqlDriver } from '~/lib/db/driver';

interface GallerySaveBody {
  mode: 'new' | 'edit';
  albumId: string | null;
  siteId: string;
  title: string;
  slug?: string;
  description?: string | null;
  published?: boolean;
  imageIds: string[];
}

export const POST: APIRoute = async (ctx) => {
  const session = ctx.locals.session;
  if (!session) return new Response('unauthorized', { status: 401 });
  const driver = ctx.locals.db! as SqlDriver;
  const b = (await ctx.request.json()) as GallerySaveBody;

  const member = await driver.query<{ role: string }>(
    `SELECT role FROM site_members WHERE site_id = $1 AND user_id = $2`,
    [b.siteId, session.userId],
  );
  if (member.length === 0) return new Response('forbidden', { status: 403 });

  if (!b.title?.trim()) return new Response('title required', { status: 400 });

  const slug = (b.slug?.trim()) || slugify(b.title);
  if (!slug) return new Response('could not derive slug', { status: 400 });

  let albumId: string;

  if (b.mode === 'new') {
    const created = await albums.createAlbum(driver, {
      siteId: b.siteId,
      title: b.title,
      slug,
      description: b.description ?? null,
    });
    albumId = created.id;
  } else {
    if (!b.albumId) return new Response('albumId required for edit', { status: 400 });
    const existing = await albums.findAlbumById(driver, { siteId: b.siteId, id: b.albumId });
    if (!existing) return new Response('not found', { status: 404 });
    const updated = await albums.updateAlbum(driver, {
      siteId: b.siteId,
      id: b.albumId,
      title: b.title,
      slug,
      description: b.description,
      published: b.published,
    });
    if (!updated) return new Response('not found', { status: 404 });
    albumId = updated.id;
  }

  await albums.setAlbumImages(driver, { albumId, orderedImageIds: b.imageIds ?? [] });

  return new Response(JSON.stringify({ id: albumId, slug }), {
    headers: { 'content-type': 'application/json' },
  });
};
