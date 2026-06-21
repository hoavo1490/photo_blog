import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import * as posts from '../lib/db/posts';
import * as tagsRepo from '../lib/db/tags';
import { firstParagraph, rewriteImageTokens, renderPostHtml } from '../lib/markdown';
import { rewriteEmbeds } from '../lib/embeds';
import { sanitizePostHtml } from '../lib/sanitize-html';
import { buildBodyImageResolver } from '../lib/render';
import { postUrl } from '../lib/post-url';

export const GET: APIRoute = async (ctx) => {
  const tenant = ctx.locals.tenant;
  const driver = ctx.locals.db;
  if (!tenant || !driver) return new Response('Not found', { status: 404 });

  // Feed readers commonly expect 20-50 entries; bumping from 10 also
  // gives crawlers more historic anchors to follow back into the site.
  const all = await posts.listPublished(driver, { siteId: tenant.id, limit: 30 });
  const siteUrl = `https://${tenant.customDomain ?? ctx.url.hostname}`;
  const updated = all[0]?.updatedAt.toISOString() ?? new Date().toISOString();
  const env_ = env as unknown as { R2_PUBLIC_BASE?: string; R2_DEV_BASE?: string };

  // Hydrate each post: tag categories + fully-rendered content:encoded.
  // Doing the body render here means RSS readers (and AI ingestion bots)
  // get the same picture-chain + embeds as the public site.
  const itemPromises = all.map(async (p) => {
    const url = `${siteUrl}${postUrl({ publishedAt: p.publishedAt!, slug: p.slug })}`;
    const desc = p.description ?? firstParagraph(p.body) ?? undefined;
    const [tags, bodyResolver] = await Promise.all([
      tagsRepo.listForPost(driver, { siteId: tenant.id, postId: p.id }),
      buildBodyImageResolver(driver, p, env_),
    ]);
    const rewritten = rewriteEmbeds(rewriteImageTokens(p.body, bodyResolver));
    const fullHtml = sanitizePostHtml(await renderPostHtml(rewritten));
    const categories = tags.map((t) => `      <category>${esc(t.name)}</category>`).join('\n');
    return `
    <item>
      <title>${esc(p.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="false">${p.id}</guid>
      <pubDate>${rfc822(p.publishedAt!)}</pubDate>
${categories ? categories + '\n' : ''}      ${desc ? `<description>${esc(desc)}</description>` : ''}
      <content:encoded><![CDATA[${fullHtml}]]></content:encoded>
    </item>`;
  });
  const items = (await Promise.all(itemPromises)).join('');

  const selfHref = `${siteUrl}/atom.xml`;
  const body = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${esc(tenant.name)}</title>
    <link>${siteUrl}</link>
    <atom:link href="${selfHref}" rel="self" type="application/rss+xml" />
    <description>${esc(tenant.name)}</description>
    <language>vi-VN</language>
    <lastBuildDate>${rfc822(new Date(updated))}</lastBuildDate>
    ${items}
  </channel>
</rss>`;

  return new Response(body, {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      // Feeds are polled by aggregators; let the edge absorb the load.
      'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600',
    },
  });
};

function esc(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c] as string),
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Explicit RFC 822 formatter — Date.toUTCString() emits the right shape
 *  on V8 today but the spec doesn't require it. Building the string by
 *  hand keeps the feed valid against W3C's validator regardless of the
 *  Workers runtime version. */
function rfc822(d: Date): string {
  const dow = DAYS[d.getUTCDay()];
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mon = MONTHS[d.getUTCMonth()];
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${dow}, ${dd} ${mon} ${yyyy} ${hh}:${mm}:${ss} +0000`;
}
