import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { byDateDesc } from '../utils/tags';
import { postUrl } from '../utils/post-url';
import { siteName } from '../data/nav';
import type { APIRoute } from 'astro';

export const GET: APIRoute = async (context) => {
  const posts = (await getCollection('posts')).sort(byDateDesc).slice(0, 10);
  return rss({
    title: siteName,
    description: 'lhzhang.com',
    site: context.site!,
    items: posts.map((p) => ({
      title: p.data.title,
      pubDate: p.data.date,
      link: postUrl(p),
      description: p.data.description,
      customData: p.data.guid ? `<guid isPermaLink="false">${p.data.guid}</guid>` : undefined,
    })),
  });
};
