import type { APIRoute } from 'astro';
import * as posts from '../lib/db/posts';
import * as tagsRepo from '../lib/db/tags';
import { postUrl } from '../lib/post-url';

export const GET: APIRoute = async (ctx) => {
  const tenant = ctx.locals.tenant;
  const driver = ctx.locals.db;
  if (!tenant || !driver) return new Response('Not found', { status: 404 });

  const [all, allTags] = await Promise.all([
    posts.listPublished(driver, { siteId: tenant.id, limit: 5000 }),
    tagsRepo.listForSite(driver, { siteId: tenant.id }),
  ]);
  const siteUrl = `https://${tenant.customDomain ?? ctx.url.hostname}`;

  // Static routes are extensionless -- the Jekyll-era `.html` URLs 404.
  const urls = ['', '/archive', '/tags', '/about'].map(
    (p) => `<url><loc>${siteUrl}${p}</loc></url>`,
  );
  // Per-tag listing pages, only when the tag has at least one published
  // post (listForSite already filters `publishedCount > 0`).
  for (const t of allTags) {
    urls.push(`<url><loc>${siteUrl}/tags/${t.slug}</loc></url>`);
  }
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
