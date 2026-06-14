import type { APIRoute } from 'astro';
import { tenant } from '../../lib/config';
import { writeImage } from '../../lib/github';

export const POST: APIRoute = async (ctx) => {
  const env = (ctx.locals as any).runtime?.env ?? process.env;
  const session = (ctx.locals as any).session as { token: string; login: string } | undefined;
  if (!session) return new Response('unauthorized', { status: 401 });

  const { filename, base64 } = await ctx.request.json() as { filename: string; base64: string };
  if (!filename || !base64) return new Response('filename and base64 required', { status: 400 });

  // Normalize the filename: spaces, weird chars, lowercase the extension.
  const safeBase = filename
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const safe = safeBase || `image-${Date.now()}.jpg`;

  const t = tenant(env);
  try {
    const { url } = await writeImage(
      session.token,
      t,
      safe,
      base64,
      `upload image: ${safe} (via editor by @${session.login})`,
    );
    return new Response(JSON.stringify({ url }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(`github error: ${err.message ?? err}`, { status: 500 });
  }
};
