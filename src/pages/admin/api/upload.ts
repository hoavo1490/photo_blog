import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import * as imagesRepo from '../../../lib/db/images';
import { keyFor, uploadImage, publicUrlForKey } from '../../../lib/r2/images';
import type { SqlDriver } from '../../../lib/db/driver';

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
  const file = form.get('file') as File | null;
  const siteId = form.get('siteId') as string | null;
  const width = Number(form.get('width') ?? 0);
  const height = Number(form.get('height') ?? 0);
  if (!file || !siteId || !width || !height) return new Response('missing fields', { status: 400 });

  const member = await driver.query<{ role: string }>(
    `SELECT role FROM site_members WHERE site_id = $1 AND user_id = $2`,
    [siteId, session.userId],
  );
  if (member.length === 0) return new Response('forbidden', { status: 403 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const r2Key = await keyFor({ siteId, originalName: file.name, bytes });

  await uploadImage(e.PHOTOS as unknown as Parameters<typeof uploadImage>[0], {
    siteId, originalName: file.name, bytes, contentType: file.type || 'image/jpeg',
  }, e);

  const image = await imagesRepo.create(driver, {
    siteId,
    r2Key,
    originalName: file.name,
    sizeBytes: bytes.byteLength,
    width, height,
    uploadedBy: session.userId,
  });

  return new Response(JSON.stringify({ id: image.id, url: publicUrlForKey(r2Key, e) }), {
    headers: { 'content-type': 'application/json' },
  });
};
