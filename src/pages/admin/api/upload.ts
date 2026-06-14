import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import * as imagesRepo from '../../../lib/db/images';
import { keyFor, variantKeyForKey, publicUrlForKey } from '../../../lib/r2/images';
import type { SqlDriver } from '../../../lib/db/driver';
import type { R2Bucket } from '@cloudflare/workers-types';

// Multi-size image upload.
//
// The client compresses + resizes the photo locally to several widths
// (400 / 800 / 1200 / 1600w by default; widths > original are skipped)
// and posts every variant in one form. The primary key in R2 is derived
// from the LARGEST variant's content hash; smaller variants live next to
// it under `<key>.<W>w.jpg`. The DB records the list of generated widths
// so renderers know what srcset entries to emit.

interface VariantPart { width: number; file: File; format: 'jpeg' | 'webp' }

export const POST: APIRoute = async (ctx) => {
  const session = ctx.locals.session;
  if (!session) return new Response('unauthorized', { status: 401 });
  const driver = ctx.locals.db! as SqlDriver;

  const e = env as unknown as {
    PHOTOS: R2Bucket;
    R2_PUBLIC_BASE?: string;
    R2_DEV_BASE?: string;
  };

  const form = await ctx.request.formData();
  const siteId = form.get('siteId') as string | null;
  const width = Number(form.get('width') ?? 0);
  const height = Number(form.get('height') ?? 0);
  if (!siteId || !width || !height) return new Response('missing fields', { status: 400 });

  // Collect file_<W> (JPEG) and file_<W>_webp (WebP) parts. The JPEG
  // primary (largest) keys the row; everything else lives next to it.
  const parts: VariantPart[] = [];
  for (const [k, v] of form.entries()) {
    const jpegM = /^file_(\d+)$/.exec(k);
    const webpM = /^file_(\d+)_webp$/.exec(k);
    if (jpegM && v instanceof File) {
      parts.push({ width: parseInt(jpegM[1], 10), file: v, format: 'jpeg' });
    } else if (webpM && v instanceof File) {
      parts.push({ width: parseInt(webpM[1], 10), file: v, format: 'webp' });
    }
  }
  const legacy = form.get('file');
  if (legacy instanceof File && parts.length === 0) {
    parts.push({ width, file: legacy, format: 'jpeg' });
  }
  if (parts.length === 0) return new Response('no image files', { status: 400 });
  // JPEGs first, largest-first, then WebPs. Primary = largest JPEG.
  parts.sort((a, b) => {
    if (a.format !== b.format) return a.format === 'jpeg' ? -1 : 1;
    return b.width - a.width;
  });

  const member = await driver.query<{ role: string }>(
    `SELECT role FROM site_members WHERE site_id = $1 AND user_id = $2`,
    [siteId, session.userId],
  );
  if (member.length === 0) return new Response('forbidden', { status: 403 });

  const primary = parts[0];
  const primaryBytes = new Uint8Array(await primary.file.arrayBuffer());
  const r2Key = await keyFor({ siteId, originalName: primary.file.name, bytes: primaryBytes });

  // Upload primary + variants in parallel. The primary JPEG keeps the
  // canonical key; JPEG variants use `<key>.<W>w.jpg`, WebP variants
  // use `<key>.<W>w.webp` (same width).
  await Promise.all(parts.map(async (p, i) => {
    const bytes = i === 0 ? primaryBytes : new Uint8Array(await p.file.arrayBuffer());
    let key: string;
    if (i === 0) {
      key = r2Key;
    } else if (p.format === 'webp') {
      key = variantKeyForKey(r2Key, p.width).replace(/\.jpg$/, '.webp');
    } else {
      key = variantKeyForKey(r2Key, p.width);
    }
    const contentType = p.format === 'webp' ? 'image/webp' : (p.file.type || 'image/jpeg');
    await e.PHOTOS.put(key, bytes, { httpMetadata: { contentType } });
  }));

  // Variant widths recorded for the JPEG track (PostCard derives WebP
  // URLs by string substitution from the same set).
  const variantWidths = [...new Set(
    parts.filter((p, i) => i > 0 && p.format === 'jpeg').map((p) => p.width),
  )].sort((a, b) => a - b);

  const image = await imagesRepo.create(driver, {
    siteId,
    r2Key,
    originalName: primary.file.name,
    sizeBytes: primaryBytes.byteLength,
    width, height,
    uploadedBy: session.userId,
    variantWidths,
  });

  return new Response(JSON.stringify({
    id: image.id,
    url: publicUrlForKey(r2Key, e),
    variantWidths,
  }), {
    headers: { 'content-type': 'application/json' },
  });
};
