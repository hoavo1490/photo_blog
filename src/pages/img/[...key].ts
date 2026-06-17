import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { R2Bucket } from '@cloudflare/workers-types';

// Worker-served image proxy. Reads from the PHOTOS R2 binding so we
// don't depend on the `*.r2.dev` URL pointing at the right bucket,
// and so we can set our own cache headers (R2 dev URLs serve nothing
// useful, which lighthouse keeps flagging).
//
// Keys are content-addressed + immutable -- a write at the same key
// is byte-identical -- so cache-control: immutable is safe.

export const GET: APIRoute = async (ctx) => {
  const key = ctx.params.key;
  if (!key) return new Response('not found', { status: 404 });
  const e = env as unknown as { PHOTOS: R2Bucket; R2_DEV_BASE?: string };
  const obj = await e.PHOTOS.get(key);
  if (!obj) {
    if (e.R2_DEV_BASE) return Response.redirect(`${e.R2_DEV_BASE}/${key}`, 302);
    return new Response('not found', { status: 404 });
  }

  const headers = new Headers();
  const ct = obj.httpMetadata?.contentType;
  if (ct) headers.set('content-type', ct);
  // 1y immutable -- the key encodes the content hash.
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('etag', obj.etag);
  return new Response(obj.body as unknown as ReadableStream, { headers });
};

export const HEAD: APIRoute = async (ctx) => {
  const key = ctx.params.key;
  if (!key) return new Response(null, { status: 404 });
  const e = env as unknown as { PHOTOS: R2Bucket; R2_DEV_BASE?: string };
  const obj = await e.PHOTOS.head(key);
  if (!obj) {
    if (e.R2_DEV_BASE) return Response.redirect(`${e.R2_DEV_BASE}/${key}`, 302);
    return new Response(null, { status: 404 });
  }
  const headers = new Headers();
  const ct = obj.httpMetadata?.contentType;
  if (ct) headers.set('content-type', ct);
  headers.set('content-length', String(obj.size));
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('etag', obj.etag);
  return new Response(null, { headers });
};
