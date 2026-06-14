import type { CollectionEntry } from 'astro:content';

export function postUrl(post: CollectionEntry<'posts'>): string {
  const d = post.data.date;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const slug = postSlug(post.id);
  return `/${y}/${m}/${day}/${slug}.html`;
}

export function postSlug(id: string): string {
  return id.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '');
}

export function postParams(post: CollectionEntry<'posts'>) {
  const d = post.data.date;
  return {
    year: String(d.getUTCFullYear()),
    month: String(d.getUTCMonth() + 1).padStart(2, '0'),
    day: String(d.getUTCDate()).padStart(2, '0'),
    slug: postSlug(post.id),
  };
}
