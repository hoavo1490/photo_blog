// Render-time helpers that bridge the DB layer to the markdown layer.
// Specifically: resolving `image:<uuid>` tokens in post bodies to real
// URLs from the images table, and computing the card-grid cover URL
// for a post.

import type { SqlDriver } from './db/driver';
import type { Image } from './db/images';
import type { Post } from './db/posts';
import { rewriteImageTokens, type ImageResolver, type ResolvedImage, firstImageUrl, firstImageToken } from './markdown';
import { publicUrlForKey } from './r2/images';

export interface RenderEnv {
  R2_PUBLIC_BASE?: string;
  R2_DEV_BASE?: string;
}

/** Build an ImageResolver that maps image uuids -> public URLs by reading
 *  the images table. Pre-fetches all referenced images so the resolver
 *  is sync (markdown.rewriteImageTokens calls it synchronously). */
export async function buildImageResolver(
  driver: SqlDriver,
  siteId: string,
  imageIds: string[],
  env: RenderEnv,
): Promise<ImageResolver> {
  if (imageIds.length === 0) return () => null;

  // Inline join query -- one SQL call instead of N -- since we want
  // multiple lookups and there's no `findManyByIds` in the repo yet.
  const placeholders = imageIds.map((_, i) => `$${i + 2}`).join(',');
  const rows = await driver.query<{
    id: string; r2_key: string; original_name: string; width: number; height: number;
    variant_widths: number[] | null;
  }>(
    `SELECT id, r2_key, original_name, width, height, variant_widths
     FROM images
     WHERE site_id = $1 AND id IN (${placeholders})`,
    [siteId, ...imageIds],
  );
  const map = new Map<string, ResolvedImage>();
  for (const r of rows) {
    const url = publicUrlForKey(r.r2_key, env);
    map.set(r.id, {
      url,
      width: r.width,
      height: r.height,
      alt: r.original_name,
      variantWidths: (r.variant_widths ?? []).map((n) => typeof n === 'string' ? parseInt(n, 10) : n),
      variantUrlBase: url,
    });
  }
  return (id) => map.get(id) ?? null;
}

export async function renderPostBody(
  driver: SqlDriver,
  post: Post,
  env: RenderEnv,
): Promise<string> {
  // Extract token uuids referenced by the body so we can batch-fetch.
  const tokens = post.body.matchAll(/\(image:([0-9a-f-]{36})\)/g);
  const ids: string[] = [];
  for (const m of tokens) ids.push(m[1]);
  const resolver = await buildImageResolver(driver, post.siteId, ids, env);
  return rewriteImageTokens(post.body, resolver);
}

/** Compute the cover URL for a card-grid entry. Prefers cover_image_id when
 *  set; falls back to the first image token in the body; finally to the
 *  first legacy http(s) URL in the body. Returns null if none found. */
export async function coverUrlFor(
  driver: SqlDriver,
  post: Post,
  env: RenderEnv,
  preloadedCover?: Image,
): Promise<string | null> {
  const info = await coverImageFor(driver, post, env, preloadedCover);
  return info?.url ?? null;
}

export interface CoverImageInfo {
  url: string;
  /** Empty when the cover came from a legacy plain URL in the body. */
  r2Key: string | null;
  variantWidths: number[];
}

/** Same as coverUrlFor but returns the underlying R2 key and variant
 *  widths so renderers can emit srcset. */
export async function coverImageFor(
  driver: SqlDriver,
  post: Post,
  env: RenderEnv,
  preloadedCover?: Image,
): Promise<CoverImageInfo | null> {
  if (preloadedCover) {
    return {
      url: publicUrlForKey(preloadedCover.r2Key, env),
      r2Key: preloadedCover.r2Key,
      variantWidths: preloadedCover.variantWidths ?? [],
    };
  }
  if (post.coverImageId) {
    const rows = await driver.query<{ r2_key: string; variant_widths: number[] | null }>(
      `SELECT r2_key, variant_widths FROM images WHERE site_id = $1 AND id = $2`,
      [post.siteId, post.coverImageId],
    );
    if (rows[0]) {
      return {
        url: publicUrlForKey(rows[0].r2_key, env),
        r2Key: rows[0].r2_key,
        variantWidths: rows[0].variant_widths ?? [],
      };
    }
  }
  const token = firstImageToken(post.body);
  if (token) {
    const rows = await driver.query<{ r2_key: string; variant_widths: number[] | null }>(
      `SELECT r2_key, variant_widths FROM images WHERE site_id = $1 AND id = $2`,
      [post.siteId, token],
    );
    if (rows[0]) {
      return {
        url: publicUrlForKey(rows[0].r2_key, env),
        r2Key: rows[0].r2_key,
        variantWidths: rows[0].variant_widths ?? [],
      };
    }
  }
  const url = firstImageUrl(post.body);
  return url ? { url, r2Key: null, variantWidths: [] } : null;
}

/** Batch variant of coverImageFor for the homepage / archive use case.
 *  Collects every image id referenced by every post (cover_image_id or
 *  first body image:<uuid> token), fetches them all in one SQL round
 *  trip, then resolves each post's cover from the result map.
 *
 *  Cuts N+1 queries to 2 -- one listPublished upstream, plus this one
 *  -- which dominates TTFB on first-paint of the home page. */
export async function batchCoverImagesFor(
  driver: SqlDriver,
  siteId: string,
  posts: Post[],
  env: RenderEnv,
): Promise<Map<string, CoverImageInfo | null>> {
  const out = new Map<string, CoverImageInfo | null>();
  const wantedIds = new Set<string>();
  const lookupPlan = new Map<string, string | null>(); // postId -> imageId or null
  for (const p of posts) {
    if (p.coverImageId) {
      wantedIds.add(p.coverImageId);
      lookupPlan.set(p.id, p.coverImageId);
    } else {
      const tok = firstImageToken(p.body);
      if (tok) {
        wantedIds.add(tok);
        lookupPlan.set(p.id, tok);
      } else {
        lookupPlan.set(p.id, null);
      }
    }
  }

  let imageById = new Map<string, { r2_key: string; variant_widths: number[] | null }>();
  if (wantedIds.size > 0) {
    const ids = [...wantedIds];
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
    const rows = await driver.query<{
      id: string; r2_key: string; variant_widths: number[] | null;
    }>(
      `SELECT id, r2_key, variant_widths
       FROM images
       WHERE site_id = $1 AND id IN (${placeholders})`,
      [siteId, ...ids],
    );
    imageById = new Map(rows.map((r) => [r.id, { r2_key: r.r2_key, variant_widths: r.variant_widths }]));
  }

  for (const p of posts) {
    const id = lookupPlan.get(p.id);
    if (id) {
      const img = imageById.get(id);
      if (img) {
        out.set(p.id, {
          url: publicUrlForKey(img.r2_key, env),
          r2Key: img.r2_key,
          variantWidths: img.variant_widths ?? [],
        });
        continue;
      }
    }
    const url = firstImageUrl(p.body);
    out.set(p.id, url ? { url, r2Key: null, variantWidths: [] } : null);
  }
  return out;
}
