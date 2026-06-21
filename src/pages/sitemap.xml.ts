import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import * as posts from '../lib/db/posts';
import * as tagsRepo from '../lib/db/tags';
import * as albumsRepo from '../lib/db/albums';
import { postUrl } from '../lib/post-url';
import { batchCoverImagesFor } from '../lib/render';
import { absoluteUrl } from '../lib/seo';

export const GET: APIRoute = async (ctx) => {
  const tenant = ctx.locals.tenant;
  const driver = ctx.locals.db;
  if (!tenant || !driver) return new Response('Not found', { status: 404 });

  const env_ = env as unknown as { R2_PUBLIC_BASE?: string; R2_DEV_BASE?: string };
  const [all, allTags, albums] = await Promise.all([
    posts.listPublished(driver, { siteId: tenant.id, limit: 5000 }),
    tagsRepo.listForSite(driver, { siteId: tenant.id }),
    albumsRepo.listAlbums(driver, { siteId: tenant.id }),
  ]);
  // Cover images surface inside the post <url> as <image:image> so
  // Google Images can crawl the post's primary photograph alongside
  // the page URL -- a measurable boost for photo-led blogs.
  const coverByPost = await batchCoverImagesFor(driver, tenant.id, all, env_);
  const siteUrl = `https://${tenant.customDomain ?? ctx.url.hostname}`;
  const latestPostLastmod = all[0]?.updatedAt.toISOString();

  const urls: string[] = [];

  // Static routes. Home + archive track the newest post; tag/about/gallery
  // have no single-source lastmod so they ship without one (still valid).
  urls.push(`<url><loc>${siteUrl}/</loc>${latestPostLastmod ? `<lastmod>${latestPostLastmod}</lastmod>` : ''}</url>`);
  urls.push(`<url><loc>${siteUrl}/archive</loc>${latestPostLastmod ? `<lastmod>${latestPostLastmod}</lastmod>` : ''}</url>`);
  urls.push(`<url><loc>${siteUrl}/tags</loc></url>`);
  urls.push(`<url><loc>${siteUrl}/about</loc></url>`);
  urls.push(`<url><loc>${siteUrl}/gallery</loc></url>`);

  // Tag landing pages: listForSite already filters publishedCount > 0.
  for (const t of allTags) {
    urls.push(`<url><loc>${siteUrl}/tags/${t.slug}</loc></url>`);
  }
  // Gallery albums.
  for (const a of albums) {
    urls.push(`<url><loc>${siteUrl}/gallery/${a.slug}</loc><lastmod>${a.updatedAt.toISOString()}</lastmod></url>`);
  }
  // Posts, each with the cover image (when known) as an <image:image>.
  for (const p of all) {
    const u = `${siteUrl}${postUrl({ publishedAt: p.publishedAt!, slug: p.slug })}`;
    const cover = coverByPost.get(p.id);
    // Google's image-sitemap extension requires <image:loc> to be an
    // absolute URL; relative paths get silently dropped from the index.
    const imageXml = cover
      ? `<image:image><image:loc>${esc(absoluteUrl(cover.url, siteUrl))}</image:loc><image:title>${esc(p.title)}</image:title></image:image>`
      : '';
    urls.push(`<url><loc>${u}</loc><lastmod>${p.updatedAt.toISOString()}</lastmod>${imageXml}</url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  ${urls.join('\n  ')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600',
    },
  });
};

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string),
  );
}
