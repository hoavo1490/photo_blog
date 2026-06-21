// /llms.txt — emerging convention (proposed by Jeremy Howard, adopted by
// Anthropic, Mintlify, etc.) for telling LLM-driven crawlers what the
// site is about, in markdown they parse perfectly. Pays off as
// ChatGPT/Perplexity/Claude increasingly cite blog posts in answers.
//
// Format: site H1, optional blockquote tagline, then markdown sections
// of links. We surface the 50 most recent published posts so the LLM
// has fresh content to cite without overloading its context budget.

import type { APIRoute } from 'astro';
import * as posts from '../lib/db/posts';
import { firstParagraph } from '../lib/markdown';
import { postUrl } from '../lib/post-url';

export const GET: APIRoute = async (ctx) => {
  const tenant = ctx.locals.tenant;
  const driver = ctx.locals.db;
  if (!tenant || !driver) return new Response('Not found', { status: 404 });

  const siteUrl = `https://${tenant.customDomain ?? ctx.url.hostname}`;
  const all = await posts.listPublished(driver, { siteId: tenant.id, limit: 50 });

  const lines: string[] = [];
  lines.push(`# ${tenant.name}`);
  lines.push('');
  lines.push(`> Photo journal and notes by Rio. ${all.length} published posts.`);
  lines.push('');
  lines.push('## About');
  lines.push('');
  lines.push(`- [About](${siteUrl}/about)`);
  lines.push(`- [Archive](${siteUrl}/archive)`);
  lines.push(`- [Tags](${siteUrl}/tags)`);
  lines.push(`- [Gallery](${siteUrl}/gallery)`);
  lines.push('');
  lines.push('## Recent posts');
  lines.push('');
  for (const p of all) {
    if (!p.publishedAt) continue;
    const u = `${siteUrl}${postUrl({ publishedAt: p.publishedAt, slug: p.slug })}`;
    const desc = p.description ?? firstParagraph(p.body, 120) ?? '';
    lines.push(desc ? `- [${p.title}](${u}): ${desc}` : `- [${p.title}](${u})`);
  }
  lines.push('');
  lines.push('## Feeds');
  lines.push('');
  lines.push(`- [Atom/RSS](${siteUrl}/atom.xml)`);
  lines.push(`- [Sitemap](${siteUrl}/sitemap.xml)`);
  lines.push('');

  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=600, s-maxage=600, stale-while-revalidate=86400',
    },
  });
};
