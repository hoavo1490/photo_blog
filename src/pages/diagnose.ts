import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

// TEMPORARY public diagnostic. Returns whether the R2 PHOTOS binding
// is wired up and can round-trip a temp key. Delete this route once
// the uploads are fixed.

export const GET: APIRoute = async () => {
  const e = env as unknown as Record<string, unknown>;
  const photos = e.PHOTOS as unknown as R2Bucket | undefined;
  const out: Record<string, unknown> = {
    has_PHOTOS: !!photos,
    PHOTOS_type: typeof photos,
    PHOTOS_ctor: photos ? (photos.constructor?.name ?? 'unknown') : null,
    R2_PUBLIC_BASE: e.R2_PUBLIC_BASE ?? null,
    R2_DEV_BASE: e.R2_DEV_BASE ?? null,
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
      out.put_error_stack = String((err as Error)?.stack ?? '');
    }
    // Also check whether a known-broken key exists.
    try {
      const broken = await photos.head('2bd96ee4-4334-4210-a8ce-c021649001a1/2026/06/14/c64626de-1000045242-1600w.jpg');
      out.broken_exists = !!broken;
      if (broken) out.broken_size = broken.size;
    } catch {}
    // And a known-working older key for comparison.
    try {
      const ok = await photos.head('2bd96ee4-4334-4210-a8ce-c021649001a1/2026/06/14/e9c8c2eb-1000045223-ucwd5.jpg');
      out.older_exists = !!ok;
      if (ok) out.older_size = ok.size;
    } catch {}
  }
  return new Response(JSON.stringify(out, null, 2), {
    headers: { 'content-type': 'application/json' },
  });
};
