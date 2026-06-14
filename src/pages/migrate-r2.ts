import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { R2Bucket } from '@cloudflare/workers-types';
import type { SqlDriver } from '../lib/db/driver';
import { variantKeyForKey } from '../lib/r2/images';

// TEMPORARY public migration endpoint. Same logic as /admin/api/migrate-r2
// but no session needed so the operator can curl it once. Delete after
// the original images are confirmed in the PHOTOS bucket.

export const GET: APIRoute = async (ctx) => {
  const driver = ctx.locals.db! as SqlDriver;
  const e = env as unknown as { PHOTOS: R2Bucket; R2_DEV_BASE?: string };
  const devBase = e.R2_DEV_BASE;
  if (!devBase) return new Response('R2_DEV_BASE not set', { status: 500 });

  const images = await driver.query<{ r2_key: string; variant_widths: number[] | null }>(
    `SELECT r2_key, variant_widths FROM images`,
  );

  const results: { key: string; status: 'present' | 'copied' | 'missing'; bytes?: number }[] = [];

  async function ensure(key: string) {
    if (await e.PHOTOS.head(key)) { results.push({ key, status: 'present' }); return; }
    const resp = await fetch(`${devBase!.replace(/\/$/, '')}/${key}`);
    if (!resp.ok) { results.push({ key, status: 'missing' }); return; }
    const bytes = new Uint8Array(await resp.arrayBuffer());
    const contentType = resp.headers.get('content-type') ?? 'application/octet-stream';
    await e.PHOTOS.put(key, bytes, { httpMetadata: { contentType } });
    results.push({ key, status: 'copied', bytes: bytes.byteLength });
  }

  for (const img of images) {
    await ensure(img.r2_key);
    for (const w of img.variant_widths ?? []) {
      await ensure(variantKeyForKey(img.r2_key, w));
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
