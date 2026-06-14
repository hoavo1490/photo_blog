// URL contract: /YYYY/MM/DD/slug.html, UTC-based so the URL is stable
// regardless of the rendering machine's timezone. Inherited from the
// Jekyll era — all 132 historical posts use these URLs.

export interface PostUrlInput {
  publishedAt: Date;
  slug: string;
}

export interface PostUrlParts {
  year: string;
  month: string;
  day: string;
  slug: string;
}

export function postUrl(post: PostUrlInput): string {
  const p = postParams(post);
  return `/${p.year}/${p.month}/${p.day}/${p.slug}.html`;
}

export function postParams(post: PostUrlInput): PostUrlParts {
  if (!post.slug) throw new Error('postUrl: slug is required');
  const d = post.publishedAt;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new Error('postUrl: publishedAt is not a valid Date');
  }
  return {
    year: String(d.getUTCFullYear()),
    month: String(d.getUTCMonth() + 1).padStart(2, '0'),
    day: String(d.getUTCDate()).padStart(2, '0'),
    slug: post.slug,
  };
}

const POST_PATH_RE = /^\/?(\d{4})\/(\d{2})\/(\d{2})\/([a-z0-9][a-z0-9-]*)\.html$/;

export function parsePostPath(path: string): PostUrlParts | null {
  const m = POST_PATH_RE.exec(path);
  if (!m) return null;
  const [, year, month, day, slug] = m;
  const mm = parseInt(month, 10);
  const dd = parseInt(day, 10);
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  return { year, month, day, slug };
}
