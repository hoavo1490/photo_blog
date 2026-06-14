import matter from 'gray-matter';

export interface PostData {
  title: string;
  date: string;     // ISO yyyy-mm-dd
  tags: string[];
  guid?: string;
  cover?: string;
  description?: string;
  body: string;
}

export function parsePost(raw: string): PostData {
  const { data, content } = matter(raw);
  return {
    title: String(data.title ?? ''),
    date: typeof data.date === 'string'
      ? data.date.slice(0, 10)
      : (data.date instanceof Date ? data.date.toISOString().slice(0, 10) : ''),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : (data.tags ? [String(data.tags)] : []),
    guid: data.guid ? String(data.guid) : undefined,
    cover: data.cover ? String(data.cover) : undefined,
    description: data.description ? String(data.description) : undefined,
    body: content,
  };
}

export function stringifyPost(p: PostData): string {
  const data: Record<string, unknown> = {
    title: p.title,
    date: p.date,
    tags: p.tags,
  };
  if (p.guid) data.guid = p.guid;
  if (p.cover) data.cover = p.cover;
  if (p.description) data.description = p.description;
  return matter.stringify(p.body || '\n', data);
}

export function newGuid(): string {
  // Astro Workers runtime exposes globalThis.crypto.
  return `urn:uuid:${crypto.randomUUID()}`;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

export function filenameFor(date: string, slug: string): string {
  return `${date}-${slug}.md`;
}
