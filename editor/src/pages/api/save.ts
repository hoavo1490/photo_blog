import type { APIRoute } from 'astro';
import { tenant } from '../../lib/config';
import { writePost } from '../../lib/github';
import { filenameFor, slugify, stringifyPost } from '../../lib/post';

export const POST: APIRoute = async (ctx) => {
  const env = (ctx.locals as any).runtime?.env ?? process.env;
  const session = (ctx.locals as any).session as { token: string; login: string } | undefined;
  if (!session) return new Response('unauthorized', { status: 401 });

  const body = await ctx.request.json() as {
    mode: 'new' | 'edit';
    title: string;
    date: string;
    tags: string[];
    cover?: string;
    description?: string;
    guid?: string;
    body: string;
    originalSlug?: string;
    sha?: string;
  };

  if (!body.title?.trim()) return new Response('title required', { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return new Response('date must be YYYY-MM-DD', { status: 400 });

  const t = tenant(env);
  const slug = body.originalSlug ?? `${body.date}-${slugify(body.title)}`;
  const filename = body.mode === 'edit' && body.originalSlug
    ? `${body.originalSlug}.md`
    : filenameFor(body.date, slugify(body.title));

  // If the date or title changed and we're in edit mode, we'd rename. For Phase 1
  // we just keep the original filename to avoid the rename + double-commit dance.
  const content = stringifyPost({
    title: body.title.trim(),
    date: body.date,
    tags: body.tags,
    guid: body.guid,
    cover: body.cover,
    description: body.description,
    body: body.body ?? '',
  });

  try {
    await writePost(
      session.token,
      t,
      filename,
      content,
      body.sha,
      `${body.mode === 'new' ? 'add' : 'edit'} post: ${body.title} (via editor by @${session.login})`,
    );
  } catch (err: any) {
    return new Response(`github error: ${err.message ?? err}`, { status: 500 });
  }

  return new Response(JSON.stringify({ slug: filename.replace(/\.md$/, '') }), {
    headers: { 'content-type': 'application/json' },
  });
};
