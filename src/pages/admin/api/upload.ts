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

interface VariantPart { width: number; file: File }

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

  // Collect file_<W> parts. Client always sends file_<largest> as the
  // primary. We sort largest-first; the largest is the row's r2_key,
  // smaller siblings are variants.
  const parts: VariantPart[] = [];
  for (const [k, v] of form.entries()) {
    const m = /^file_(\d+)$/.exec(k);
    if (m && v instanceof File) {
      parts.push({ width: parseInt(m[1], 10), file: v });
    }
  }
  // Back-compat: also accept the legacy `file` field (single-size upload).
  const legacy = form.get('file');
  if (legacy instanceof File && parts.length === 0) {
    parts.push({ width, file: legacy });
  }
  if (parts.length === 0) return new Response('no image files', { status: 400 });
  parts.sort((a, b) => b.width - a.width);

  const member = await driver.query<{ role: string }>(
    `SELECT role FROM site_members WHERE site_id = $1 AND user_id = $2`,
    [siteId, session.userId],
  );
  if (member.length === 0) return new Response('forbidden', { status: 403 });

  const primary = parts[0];
  const primaryBytes = new Uint8Array(await primary.file.arrayBuffer());
  const r2Key = await keyFor({ siteId, originalName: primary.file.name, bytes: primaryBytes });

  // Upload primary + variants in parallel. Each variant lives at a
  // derived key; the primary itself uses the canonical hash-based key.
  await Promise.all(parts.map(async ({ width: w, file }, i) => {
    const bytes = i === 0 ? primaryBytes : new Uint8Array(await file.arrayBuffer());
    const key = i === 0 ? r2Key : variantKeyForKey(r2Key, w);
    await e.PHOTOS.put(key, bytes, {
      httpMetadata: { contentType: file.type || 'image/jpeg' },
    });
  }));

  // Variant widths are all widths EXCEPT the primary's (which is the
  // canonical r2_key, addressed via the row's original src).
  const variantWidths = parts.slice(1).map((p) => p.width).sort((a, b) => a - b);

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
