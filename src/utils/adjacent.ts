import type { CollectionEntry } from 'astro:content';
import { postUrl } from './post-url';

export function adjacentPosts(
  all: CollectionEntry<'posts'>[],
  current: CollectionEntry<'posts'>,
): { previous: { url: string; title: string } | null; next: { url: string; title: string } | null } {
  const sorted = [...all].sort((a, b) => a.data.date.getTime() - b.data.date.getTime());
  const i = sorted.findIndex((p) => p.id === current.id);
  const prev = i > 0 ? sorted[i - 1] : null;
  const next = i < sorted.length - 1 ? sorted[i + 1] : null;
  return {
    previous: prev ? { url: postUrl(prev), title: prev.data.title } : null,
    next: next ? { url: postUrl(next), title: next.data.title } : null,
  };
}
