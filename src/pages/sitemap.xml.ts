import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import * as posts from '../lib/db/posts';
import * as tagsRepo from '../lib/db/tags';
import * as topicsRepo from '../lib/db/topics';
import * as albumsRepo from '../lib/db/albums';
import * as pagesRepo from '../lib/db/pages';
import { postUrl } from '../lib/post-url';
import { batchCoverImagesFor } from '../lib/render';
import { absoluteUrl } from '../lib/seo';

export const GET: APIRoute = async (ctx) => {
  const tenant = ctx.locals.tenant;
  const driver = ctx.locals.db;
  if (!tenant || !driver) return new Response('Not found', { status: 404 });

  const env_ = env as unknown as { R2_PUBLIC_BASE?: string; R2_DEV_BASE?: string };
  const [all, allTags, allTopics, albums, aboutPage] = await Promise.all([
    posts.listPublished(driver, { siteId: tenant.id, limit: 5000 }),
    tagsRepo.listForSite(driver, { siteId: tenant.id }),
    topicsRepo.listForSite(driver, { siteId: tenant.id }),
    albumsRepo.listAlbums(driver, { siteId: tenant.id }),
    pagesRepo.findPage(driver, { siteId: tenant.id, slug: 'about' }),
  ]);
  // Cover images surface inside the post <url> as <image:image> so
  // Google Images can crawl the post's primary photograph alongside
  // the page URL -- a measurable boost for photo-led blogs.
  const coverByPost = await batchCoverImagesFor(driver, tenant.id, all, env_);
  const siteUrl = `https://${tenant.customDomain ?? ctx.url.hostname}`;

  // Per-source freshness. The "site-wide" lastmod is the most recent
  // of any tracked content; it stamps the home and archive (which
  // surface that content), while each section uses its own narrower
  // signal. Honest freshness signals matter: Google notices when
  // sitemap lastmod is inflated and starts ignoring it.
  const latestPostLastmod = all[0]?.updatedAt;
  const latestAlbumLastmod = albums[0]?.updatedAt;
  const latestPageLastmod = aboutPage?.updatedAt;
  const sitewideLastmod = [latestPostLastmod, latestAlbumLastmod, latestPageLastmod]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const iso = (d: Date | undefined) => d?.toISOString();

  const urls: string[] = [];

  // Static routes. lastmod tracks the narrowest honest source: home and
  // archive reflect the newest content of any kind; /tags reflects the
  // newest post (tag pages list post titles); /gallery reflects the
  // newest album; /about reflects the about-page row.
  urls.push(`<url><loc>${siteUrl}/</loc>${sitewideLastmod ? `<lastmod>${iso(sitewideLastmod)}</lastmod>` : ''}</url>`);
  urls.push(`<url><loc>${siteUrl}/archive</loc>${latestPostLastmod ? `<lastmod>${iso(latestPostLastmod)}</lastmod>` : ''}</url>`);
  urls.push(`<url><loc>${siteUrl}/tags</loc>${latestPostLastmod ? `<lastmod>${iso(latestPostLastmod)}</lastmod>` : ''}</url>`);
  urls.push(`<url><loc>${siteUrl}/topics</loc>${latestPostLastmod ? `<lastmod>${iso(latestPostLastmod)}</lastmod>` : ''}</url>`);
  urls.push(`<url><loc>${siteUrl}/gallery</loc>${latestAlbumLastmod ? `<lastmod>${iso(latestAlbumLastmod)}</lastmod>` : ''}</url>`);
  urls.push(`<url><loc>${siteUrl}/about</loc>${latestPageLastmod ? `<lastmod>${iso(latestPageLastmod)}</lastmod>` : ''}</url>`);

  // Tag landing pages: listForSite already filters publishedCount > 0.
  // Each tag's freshness floor is the latest post update across the
  // whole site -- a tag page lists post titles, so any post change
  // could surface differently here. Cheaper than per-tag aggregation.
  for (const t of allTags) {
    urls.push(`<url><loc>${siteUrl}/tags/${t.slug}</loc>${latestPostLastmod ? `<lastmod>${iso(latestPostLastmod)}</lastmod>` : ''}</url>`);
  }
  for (const t of allTopics) {
    if (t.publishedCount === 0) continue;
    urls.push(`<url><loc>${siteUrl}/topics/${t.slug}</loc>${latestPostLastmod ? `<lastmod>${iso(latestPostLastmod)}</lastmod>` : ''}</url>`);
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
