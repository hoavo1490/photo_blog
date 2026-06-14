import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { R2Bucket } from '@cloudflare/workers-types';

// TEMPORARY: PUT an arbitrary blob to PHOTOS at a chosen key. Used by
// the AVIF backfill driven from a local laptop -- the local libavif
// encoder writes to a temp file, this endpoint just shuttles bytes
// into the Worker's R2 bucket. Delete once backfill is done.

const ALLOWED_CTYPES = new Set(['image/avif', 'image/webp', 'image/jpeg']);

export const POST: APIRoute = async (ctx) => {
  const u = new URL(ctx.request.url);
  const key = u.searchParams.get('key');
  const ctype = u.searchParams.get('ctype') ?? 'application/octet-stream';
  if (!key) return new Response('key required', { status: 400 });
  if (!ALLOWED_CTYPES.has(ctype)) return new Response('bad ctype', { status: 400 });
  const e = env as unknown as { PHOTOS: R2Bucket };
  const bytes = new Uint8Array(await ctx.request.arrayBuffer());
  if (bytes.byteLength === 0) return new Response('empty body', { status: 400 });
  await e.PHOTOS.put(key, bytes, { httpMetadata: { contentType: ctype } });
  return new Response(JSON.stringify({ key, ctype, bytes: bytes.byteLength }), {
    headers: { 'content-type': 'application/json' },
  });
};
