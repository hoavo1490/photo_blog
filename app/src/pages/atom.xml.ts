import type { APIRoute } from 'astro';
import * as posts from '../lib/db/posts';
import { postUrl } from '../lib/post-url';

export const GET: APIRoute = async (ctx) => {
  const tenant = ctx.locals.tenant;
  const driver = ctx.locals.db;
  if (!tenant || !driver) return new Response('Not found', { status: 404 });

  const all = await posts.listPublished(driver, { siteId: tenant.id, limit: 10 });
  const siteUrl = `https://${tenant.customDomain ?? ctx.url.hostname}`;
  const updated = all[0]?.updatedAt.toISOString() ?? new Date().toISOString();

  const items = all
    .map((p) => {
      const url = `${siteUrl}${postUrl({ publishedAt: p.publishedAt!, slug: p.slug })}`;
      return `
    <item>
      <title>${esc(p.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="false">${p.id}</guid>
      <pubDate>${p.publishedAt!.toUTCString()}</pubDate>
      ${p.description ? `<description>${esc(p.description)}</description>` : ''}
    </item>`;
    })
    .join('');

  const body = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(tenant.name)}</title>
    <link>${siteUrl}</link>
    <description>${esc(tenant.name)}</description>
    <lastBuildDate>${updated}</lastBuildDate>
    ${items}
  </channel>
</rss>`;

  return new Response(body, {
    headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
  });
};

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string),
  );
}
