import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { SqlDriver } from '../../../lib/db/driver';
import { variantKeyForKey } from '../../../lib/r2/images';

// One-time migration. The dev URL (R2_DEV_BASE) and the Worker's PHOTOS
// binding ended up pointing at two different R2 buckets in different CF
// accounts -- so the original 4 imported images live where dev URL
// reads them but PHOTOS.get can't see them. This endpoint walks every
// image row, plus its variant widths, fetches anything PHOTOS doesn't
// already have from the dev URL, and PUTs it into the PHOTOS bucket.
//
// Idempotent: head() before fetching; skip when present. Safe to run
// many times; safe to delete after.

export const POST: APIRoute = async (ctx) => {
  const session = ctx.locals.session;
  if (!session) return new Response('unauthorized', { status: 401 });
  const driver = ctx.locals.db! as SqlDriver;
  const e = env as unknown as { PHOTOS: R2Bucket; R2_DEV_BASE?: string };
  const devBase = e.R2_DEV_BASE;
  if (!devBase) return new Response('R2_DEV_BASE not set', { status: 500 });

  const images = await driver.query<{ r2_key: string; variant_widths: number[] | null }>(
    `SELECT r2_key, variant_widths FROM images`,
  );

  const results: { key: string; status: 'present' | 'copied' | 'missing'; bytes?: number }[] = [];

  async function ensure(key: string) {
    if (await e.PHOTOS.head(key)) {
      results.push({ key, status: 'present' });
      return;
    }
    const resp = await fetch(`${devBase!.replace(/\/$/, '')}/${key}`);
    if (!resp.ok) {
      results.push({ key, status: 'missing' });
      return;
    }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const contentType = resp.headers.get('content-type') ?? 'application/octet-stream';
    await e.PHOTOS.put(key, bytes, { httpMetadata: { contentType } });
    results.push({ key, status: 'copied', bytes: bytes.byteLength });
  }

  for (const img of images) {
    await ensure(img.r2_key);
    for (const w of img.variant_widths ?? []) {
      await ensure(variantKeyForKey(img.r2_key, w));
      // WebP sibling
      await ensure(variantKeyForKey(img.r2_key, w).replace(/\.jpg$/, '.webp'));
    }
  }

  const summary = {
    total: results.length,
    present: results.filter((r) => r.status === 'present').length,
    copied: results.filter((r) => r.status === 'copied').length,
    missing: results.filter((r) => r.status === 'missing').length,
    results,
  };
  return new Response(JSON.stringify(summary, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
};
