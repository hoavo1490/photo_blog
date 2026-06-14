import type { CollectionEntry } from 'astro:content';

export function tagCounts(posts: CollectionEntry<'posts'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of posts) {
    for (const t of p.data.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

export function groupByYear<T extends CollectionEntry<'posts'>>(posts: T[]): [number, T[]][] {
  const map = new Map<number, T[]>();
  for (const p of posts) {
    const y = p.data.date.getUTCFullYear();
    const list = map.get(y) ?? [];
    list.push(p);
    map.set(y, list);
  }
  return [...map.entries()].sort((a, b) => b[0] - a[0]);
}

export function byDateDesc<T extends CollectionEntry<'posts'>>(a: T, b: T): number {
  return b.data.date.getTime() - a.data.date.getTime();
}
