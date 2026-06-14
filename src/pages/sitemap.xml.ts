import type { APIRoute } from 'astro';
import * as posts from '../lib/db/posts';
import { postUrl } from '../lib/post-url';

export const GET: APIRoute = async (ctx) => {
  const tenant = ctx.locals.tenant;
  const driver = ctx.locals.db;
  if (!tenant || !driver) return new Response('Not found', { status: 404 });

  const all = await posts.listPublished(driver, { siteId: tenant.id, limit: 5000 });
  const siteUrl = `https://${tenant.customDomain ?? ctx.url.hostname}`;

  const urls = ['', '/archive.html', '/tags.html', '/about.html'].map(
    (p) => `<url><loc>${siteUrl}${p}</loc></url>`,
  );
  for (const p of all) {
    const u = `${siteUrl}${postUrl({ publishedAt: p.publishedAt!, slug: p.slug })}`;
    urls.push(`<url><loc>${u}</loc><lastmod>${p.updatedAt.toISOString()}</lastmod></url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls.join('\n  ')}
</urlset>`;

  return new Response(xml, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
