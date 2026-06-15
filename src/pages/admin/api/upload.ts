import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import * as imagesRepo from '../../../lib/db/images';
import {
  keyFor,
  variantKeyForKey,
  publicUrlForKey,
  editorPreviewUrlForKey,
  readImageDimensions,
  detectImageFormat,
  contentTypeForFormat,
} from '../../../lib/r2/images';
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
  // width/height are now derived from the primary bytes server-side.
  // The form may still carry them (legacy clients) but they're ignored.
  if (!siteId) return new Response('missing fields', { status: 400 });

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
    // Legacy single-file uploads have no width annotation; use a
    // sentinel of 0 since the legacy path doesn't emit variants.
    parts.push({ width: 0, file: legacy, format: 'jpeg' });
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

  // Trust the server-detected format, NEVER the client-supplied
  // file.type. `p.file.type` from the multipart form is whatever the
  // browser/attacker put there; an HTML upload with type=text/html
  // would be served back by /img/<key> with that Content-Type and
  // become stored XSS.
  const primaryFormat = detectImageFormat(primaryBytes);
  if (!primaryFormat) return new Response('unsupported image format', { status: 400 });
  // readImageDimensions throws on non-image bytes; pair the throw with
  // a 400 so attackers get a clear rejection rather than a 500.
  let detectedDims: { width: number; height: number };
  try {
    detectedDims = readImageDimensions(primaryBytes);
  } catch {
    return new Response('unsupported image format', { status: 400 });
  }

  const r2Key = await keyFor({ siteId, originalName: primary.file.name, bytes: primaryBytes });

  // Upload primary + variants in parallel. The primary JPEG keeps the
  // canonical key; JPEG variants use `<key>.<W>w.jpg`, WebP variants
  // use `<key>.<W>w.webp` (same width). Every variant's bytes are
  // re-sniffed -- the client could lie about which slot is webp vs jpeg.
  //
  // PUTs are deliberately overwrite-on-write: the key encodes siteId +
  // content hash, so an existing object with the same key is necessarily
  // a previous upload of identical bytes from the same site -- re-PUTing
  // the same bytes is a no-op. This is the path that lets the user reuse
  // an image they've already uploaded (e.g. a logo) without hitting a
  // bogus 409.
  class UploadError extends Error {
    constructor(message: string, public statusCode: number) {
      super(message);
    }
  }
  try {
    await Promise.all(parts.map(async (p, i) => {
      const bytes = i === 0 ? primaryBytes : new Uint8Array(await p.file.arrayBuffer());
      const fmt = i === 0 ? primaryFormat : detectImageFormat(bytes);
      if (!fmt) throw new UploadError('unsupported image format', 400);
      let key: string;
      if (i === 0) {
        key = r2Key;
      } else if (fmt === 'webp') {
        key = variantKeyForKey(r2Key, p.width).replace(/\.jpg$/, '.webp');
      } else {
        key = variantKeyForKey(r2Key, p.width);
      }
      await e.PHOTOS.put(key, bytes, {
        httpMetadata: { contentType: contentTypeForFormat(fmt) },
      });
    }));
  } catch (err) {
    if (err instanceof UploadError) {
      return new Response(err.message, { status: err.statusCode });
    }
    throw err;
  }

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
    // Use the dimensions decoded from the primary bytes -- form values
    // are attacker-controllable and would let a client lie about size.
    width: detectedDims.width,
    height: detectedDims.height,
    uploadedBy: session.userId,
    variantWidths,
  });

  return new Response(JSON.stringify({
    id: image.id,
    url: publicUrlForKey(r2Key, e),
    // editorUrl points at a smaller variant (800w preferred) so the WYSIWYG
    // editor renders the image instantly instead of waiting for the 1600w
    // primary to download. Public site keeps using `url` as srcset fallback.
    editorUrl: editorPreviewUrlForKey(r2Key, variantWidths),
    variantWidths,
  }), {
    headers: { 'content-type': 'application/json' },
  });
};
