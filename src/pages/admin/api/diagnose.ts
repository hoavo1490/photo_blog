import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

// One-shot diagnostic. Tells us whether the R2 binding actually works:
// can we PUT a test object? Can we then GET it back? Do .head() calls
// agree? Reveals the silent failure that's been claiming uploads.

export const GET: APIRoute = async (ctx) => {
  const session = ctx.locals.session;
  if (!session) return new Response('unauthorized', { status: 401 });
  const e = env as Record<string, unknown>;
  const photos = e.PHOTOS as unknown as R2Bucket | undefined;
  const out: Record<string, unknown> = {
    has_PHOTOS: !!photos,
    PHOTOS_type: typeof photos,
    R2_PUBLIC_BASE: e.R2_PUBLIC_BASE ?? null,
    R2_DEV_BASE: e.R2_DEV_BASE ?? null,
    DATABASE_URL_set: !!e.DATABASE_URL,
  };
  if (photos) {
    const testKey = `_diagnose/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
    try {
      await photos.put(testKey, 'diagnose-ok', { httpMetadata: { contentType: 'text/plain' } });
      out.put_ok = true;
      const head = await photos.head(testKey);
      out.head_after_put = head ? { size: head.size, contentType: head.httpMetadata?.contentType } : null;
      const got = await photos.get(testKey);
      out.get_after_put = got ? { size: (await got.arrayBuffer()).byteLength } : null;
      await photos.delete(testKey);
      out.cleanup_ok = true;
    } catch (err) {
      out.put_error = String((err as Error)?.message ?? err);
    }
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
};
