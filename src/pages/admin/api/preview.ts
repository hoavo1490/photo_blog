import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { marked } from 'marked';
import type { SqlDriver } from '../../../lib/db/driver';
import { renderPostBody } from '../../../lib/render';
import { rewriteEmbeds } from '../../../lib/embeds';
import { sanitizePostHtml } from '../../../lib/sanitize-html';

interface PreviewBody {
  siteId: string;
  body: string;
}

// Renders the same way the public post page does -- resolves
// `image:<uuid>` tokens via the images table, then runs marked. Used by
// the editor's "preview" tab so what the author sees matches what
// publishes.

export const POST: APIRoute = async (ctx) => {
  const session = ctx.locals.session;
  if (!session) return new Response('unauthorized', { status: 401 });
  const driver = ctx.locals.db! as SqlDriver;
  const b = (await ctx.request.json()) as PreviewBody;
  if (!b.siteId) return new Response('siteId required', { status: 400 });

  // Membership check -- preview reveals image URLs from the images table.
  const member = await driver.query<{ role: string }>(
    `SELECT role FROM site_members WHERE site_id = $1 AND user_id = $2`,
    [b.siteId, session.userId],
  );
  if (member.length === 0) return new Response('forbidden', { status: 403 });

  // Synthesize a Post-shaped object just enough for renderPostBody.
  const synthetic = { siteId: b.siteId, body: b.body ?? '' };
  const env_ = env as unknown as { R2_PUBLIC_BASE?: string; R2_DEV_BASE?: string };
  const rewritten = rewriteEmbeds(await renderPostBody(driver, synthetic as never, env_));
  // Mirror the public path: sanitize before returning HTML so the
  // editor preview matches what publishes (and isn't an XSS vector
  // against admins either).
  const html = sanitizePostHtml(await marked.parse(rewritten));
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};
