import type { APIRoute } from 'astro';
import { tenant } from '../../lib/config';
import { deletePost } from '../../lib/github';

export const POST: APIRoute = async (ctx) => {
  const env = (ctx.locals as any).runtime?.env ?? process.env;
  const session = (ctx.locals as any).session as { token: string; login: string } | undefined;
  if (!session) return new Response('unauthorized', { status: 401 });

  const { slug, sha } = await ctx.request.json() as { slug: string; sha: string };
  if (!slug || !sha) return new Response('slug and sha required', { status: 400 });

  const t = tenant(env);
  try {
    await deletePost(
      session.token,
      t,
      `${slug}.md`,
      sha,
      `delete post: ${slug} (via editor by @${session.login})`,
    );
  } catch (err: any) {
    return new Response(`github error: ${err.message ?? err}`, { status: 500 });
  }
  return new Response(JSON.stringify({ ok: true }), {
    headers: { 'content-type': 'application/json' },
  });
};
