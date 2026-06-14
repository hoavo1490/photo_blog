import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { R2Bucket } from '@cloudflare/workers-types';

// TEMPORARY: accept a JPEG body via POST + a `key` query param and write
// it to PHOTOS at `<key>.webp` (assumes caller has already encoded the
// JPEG to WebP locally using cwebp). Delete after backfill.

export const POST: APIRoute = async (ctx) => {
  const key = new URL(ctx.request.url).searchParams.get('key');
  if (!key) return new Response('key required', { status: 400 });
  const e = env as unknown as { PHOTOS: R2Bucket };
  const bytes = new Uint8Array(await ctx.request.arrayBuffer());
  if (bytes.byteLength === 0) return new Response('empty body', { status: 400 });
  await e.PHOTOS.put(key, bytes, { httpMetadata: { contentType: 'image/webp' } });
  return new Response(JSON.stringify({ key, bytes: bytes.byteLength }), {
    headers: { 'content-type': 'application/json' },
  });
};
