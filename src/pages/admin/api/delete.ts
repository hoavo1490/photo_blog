import type { APIRoute } from 'astro';
import * as posts from '../../../lib/db/posts';
import { variantKeyForKey } from '../../../lib/r2/images';
import type { SqlDriver } from '../../../lib/db/driver';
import type { R2Bucket } from '@cloudflare/workers-types';
import { allImageTokens } from '../../../lib/markdown';

declare global {
  // Test escape hatch -- integration tests inject a fake R2 bucket so
  // deletion can be exercised without workerd. Production code never
  // sets this.
  // eslint-disable-next-line no-var
  var __RIOVV_TEST_R2__: R2Bucket | undefined;
}

async function r2FromEnv(): Promise<R2Bucket> {
  if (globalThis.__RIOVV_TEST_R2__) return globalThis.__RIOVV_TEST_R2__;
  // Dynamic import so this module can be loaded under the Node unit test
  // pool (which has no `cloudflare:workers` resolver). Production paths
  // run inside workerd where the dynamic import resolves normally.
  const { env } = await import('cloudflare:workers');
  return (env as unknown as { PHOTOS: R2Bucket }).PHOTOS;
}

interface ImageRowForCleanup {
  id: string;
  r2_key: string;
  variant_widths: number[] | null;
  has_avif: boolean | null;
}

/** Return every R2 key that belongs to an image: primary + JPEG/WebP/AVIF
 *  variants for each recorded width. R2's `delete` is a no-op for missing
 *  keys so we can be liberal -- listing AVIF for an image without AVIF
 *  variants is safe. */
function r2KeysForImage(row: ImageRowForCleanup): string[] {
  const keys: string[] = [row.r2_key];
  const widths = row.variant_widths ?? [];
  const hasAvif = row.has_avif ?? false;
  for (const w of widths) {
    const jpegKey = variantKeyForKey(row.r2_key, w);
    keys.push(jpegKey);
    keys.push(jpegKey.replace(/\.jpg$/, '.webp'));
    if (hasAvif) keys.push(jpegKey.replace(/\.jpg$/, '.avif'));
  }
  return keys;
}

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

  // Pull the post so we can enumerate its image references (body tokens
  // plus the cover) before the row goes away. Once the post is deleted
  // its tokens are unrecoverable, so this lookup MUST run first.
  const post = await posts.findById(driver, { siteId, id: postId });
  if (!post) return new Response('not found', { status: 404 });

  const referenced = new Set<string>(allImageTokens(post.body));
  if (post.coverImageId) referenced.add(post.coverImageId);

  // For every referenced image, count how many OTHER posts (in this same
  // site, excluding the one we're about to delete) still reference it --
  // either via cover_image_id or via an `image:<uuid>` token in the body.
  // Cross-site references don't count because images are site-scoped.
  let orphanedRows: ImageRowForCleanup[] = [];
  if (referenced.size > 0) {
    const ids = [...referenced];
    orphanedRows = await driver.query<ImageRowForCleanup>(
      `SELECT i.id, i.r2_key, i.variant_widths, i.has_avif
       FROM images i
       WHERE i.site_id = $1
         AND i.id = ANY($2::uuid[])
         AND NOT EXISTS (
           SELECT 1 FROM posts p
           WHERE p.site_id = $1
             AND p.id <> $3
             AND (
               p.cover_image_id = i.id
               OR p.body ILIKE '%image:' || i.id::text || '%'
             )
         )`,
      [siteId, ids, postId],
    );
  }

  // Delete the post row first. If we crash before R2 cleanup the post is
  // gone and the next attempt will just no-op (post lookup returns null).
  // The R2 + images-row cleanup that follows is "best effort, retryable
  // by deleting again" rather than transactional.
  await posts.del(driver, { siteId, id: postId });

  if (orphanedRows.length > 0) {
    const bucket = await r2FromEnv();
    // Drop R2 objects in parallel; R2 delete is idempotent so this is
    // safe even if a key isn't actually there.
    const allKeys = orphanedRows.flatMap(r2KeysForImage);
    await Promise.all(allKeys.map((k) => bucket.delete(k)));
    // Then drop the images rows.
    await driver.exec(
      `DELETE FROM images WHERE site_id = $1 AND id = ANY($2::uuid[])`,
      [siteId, orphanedRows.map((r) => r.id)],
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
};
