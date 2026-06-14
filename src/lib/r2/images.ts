import type { R2Bucket } from '@cloudflare/workers-types';

// R2 image storage layer. The DB layer (`src/lib/db/images.ts`) tracks
// metadata; this module owns the blob lifecycle and key conventions.
//
// Key layout: `<siteId>/YYYY/MM/DD/<8hex>-<safe-name>`. The 8-hex prefix
// is the first 8 chars of the bytes' SHA-256, so re-uploading identical
// content collapses onto the same key (idempotent PUT). The date segment
// is purely for human navigation in the R2 dashboard -- the content hash
// is what guarantees uniqueness within a site.

export interface UploadInput {
  siteId: string;
  originalName: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface UploadResult {
  r2Key: string;
  publicUrl: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function normalizeFilename(name: string): string {
  // Strip directory components if a path snuck through.
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const extRaw = dot > 0 ? base.slice(dot + 1) : '';

  const cleanStem = stem
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cleanExt = extRaw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

  const finalStem = cleanStem || 'image';
  return cleanExt ? `${finalStem}.${cleanExt}` : finalStem;
}

async function contentHashHex(bytes: Uint8Array): Promise<string> {
  // SubtleCrypto wants an ArrayBuffer; copy into a fresh one so we don't
  // share storage with a SharedArrayBuffer or include bytes outside the
  // view's window.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  const arr = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += arr[i].toString(16).padStart(2, '0');
  }
  // first 8 bytes -> 16 hex chars; we want first 8 hex chars only.
  return hex.slice(0, 8);
}

/** Canonical key: <siteId>/YYYY/MM/DD/<8hex>-<safe-name>. Deterministic
 *  for fixed (siteId, bytes, originalName) within a UTC day. */
export async function keyFor(input: {
  siteId: string;
  originalName: string;
  bytes: Uint8Array;
}): Promise<string> {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = pad2(now.getUTCMonth() + 1);
  const dd = pad2(now.getUTCDate());
  const hash = await contentHashHex(input.bytes);
  const safe = normalizeFilename(input.originalName);
  return `${input.siteId}/${yyyy}/${mm}/${dd}/${hash}-${safe}`;
}

/** Upload to R2. The PUT is content-addressed via the key, so repeats
 *  are safe and overwrite themselves byte-for-byte. The `env` argument
 *  is passed to `publicUrlForKey` so callers get a ready-to-use URL in
 *  the result rather than having to resolve it themselves. */
export async function uploadImage(
  bucket: R2Bucket,
  input: UploadInput,
  env: { R2_PUBLIC_BASE?: string; R2_DEV_BASE?: string },
): Promise<UploadResult> {
  const r2Key = await keyFor(input);
  await bucket.put(r2Key, input.bytes, {
    httpMetadata: { contentType: input.contentType },
  });
  return { r2Key, publicUrl: publicUrlForKey(r2Key, env) };
}

/** Variant key for a stored original. Convention: strip the trailing
 *  image extension and append `.<width>w.jpg`. So an original key
 *  `<site>/<date>/<hash>-photo.jpg` produces `...-photo.800w.jpg`.
 *  All variants are re-encoded as JPEG by the client. */
export function variantKeyForKey(key: string, width: number): string {
  const stripped = key.replace(/\.(jpe?g|png|webp|gif)$/i, '');
  return `${stripped}.${width}w.jpg`;
}

/** Variant URL for a stored original at the given width. */
export function variantUrlForKey(
  key: string,
  width: number,
  env: { R2_PUBLIC_BASE?: string; R2_DEV_BASE?: string },
): string {
  return publicUrlForKey(variantKeyForKey(key, width), env);
}

/** Public URL for a stored key. Images are served through the Worker
 *  at `/img/<key>` -- the PHOTOS R2 binding is the single source of
 *  truth, and routing through the Worker lets us set proper cache
 *  headers (R2's *.r2.dev URLs don't allow custom headers). The env
 *  parameter is kept for back-compat with callers that haven't been
 *  updated, but is no longer consulted. */
export function publicUrlForKey(
  key: string,
  _env?: { R2_PUBLIC_BASE?: string; R2_DEV_BASE?: string },
): string {
  return `/img/${key}`;
}

/** Remove an image. R2 `delete` is already a no-op for missing keys, so
 *  callers don't need to guard. */
export async function deleteImage(bucket: R2Bucket, key: string): Promise<void> {
  await bucket.delete(key);
}

/** Read width/height from the first few bytes of a JPEG/PNG/WebP/GIF.
 *  Intentionally minimal: only enough to populate the `images` table so
 *  PhotoSwipe can avoid layout shift. Throws on unrecognized formats so
 *  the upload endpoint can return a clear 400 instead of writing junk. */
export function readImageDimensions(bytes: Uint8Array): { width: number; height: number } {
  // PNG: 8-byte signature + IHDR(13). Width/height are big-endian u32 at
  // bytes 16 and 20.
  if (
    bytes.length >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }

  // GIF87a / GIF89a: 'GIF' at 0, dimensions are little-endian u16 at 6,8.
  if (
    bytes.length >= 10 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  ) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  }

  // WebP: 'RIFF' at 0, 'WEBP' at 8. Then a chunk:
  //   VP8 (lossy): width/height u16 LE at 26, 28 (with the 0x3fff mask).
  //   VP8L (lossless): packed width-1/height-1 u14 LE at 21.
  //   VP8X (extended): width-1/height-1 u24 LE at 24, 27.
  if (
    bytes.length >= 30 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (fourcc === 'VP8 ') {
      return {
        width: dv.getUint16(26, true) & 0x3fff,
        height: dv.getUint16(28, true) & 0x3fff,
      };
    }
    if (fourcc === 'VP8L') {
      const b0 = bytes[21];
      const b1 = bytes[22];
      const b2 = bytes[23];
      const b3 = bytes[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height };
    }
    if (fourcc === 'VP8X') {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width, height };
    }
    throw new Error(`readImageDimensions: unsupported WebP variant '${fourcc}'`);
  }

  // JPEG: starts with FF D8. Walk segments until SOFn (FFC0..FFCF excluding
  // C4, C8, CC which are DHT/JPG/DAC, not frame headers).
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) {
        throw new Error('readImageDimensions: malformed JPEG (expected marker)');
      }
      // Skip fill bytes (0xff padding between markers).
      while (i < bytes.length && bytes[i] === 0xff) i++;
      const marker = bytes[i];
      i++;
      // Standalone markers (no length): RSTn (D0-D7), SOI (D8), EOI (D9), TEM (01).
      if (marker === 0xd9 || marker === 0xd8 || marker === 0x01) {
        throw new Error('readImageDimensions: JPEG ended before SOF');
      }
      if (marker >= 0xd0 && marker <= 0xd7) continue;
      if (i + 1 >= bytes.length) {
        throw new Error('readImageDimensions: truncated JPEG');
      }
      const segLen = (bytes[i] << 8) | bytes[i + 1];
      // SOF0..SOF15, excluding DHT (C4), JPG (C8), DAC (CC).
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        // segment is: length(2) precision(1) height(2) width(2) ...
        if (i + 7 >= bytes.length) {
          throw new Error('readImageDimensions: truncated JPEG SOF');
        }
        const height = (bytes[i + 3] << 8) | bytes[i + 4];
        const width = (bytes[i + 5] << 8) | bytes[i + 6];
        return { width, height };
      }
      i += segLen;
    }
    throw new Error('readImageDimensions: JPEG ended without SOF');
  }

  throw new Error('readImageDimensions: unrecognized image format');
}
