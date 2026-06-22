import type { SqlDriver } from './driver';
import { slugify } from '../slug';

// Per-site topic namespace. A post belongs to at most one topic (FK
// posts.topic_id). Mirrors tags.ts shape so the editor save flow looks
// the same on both sides.

export interface Topic {
  id: string;
  siteId: string;
  slug: string;
  name: string;
}

export interface TopicWithCount extends Topic {
  publishedCount: number;
}

interface TopicRow {
  id: string;
  site_id: string;
  slug: string;
  name: string;
}

function fromRow(r: TopicRow): Topic {
  return { id: r.id, siteId: r.site_id, slug: r.slug, name: r.name };
}

export async function findOrCreate(
  driver: SqlDriver,
  input: { siteId: string; name: string },
): Promise<Topic> {
  const slug = slugify(input.name);
  if (!slug) throw new Error(`topics.findOrCreate: name '${input.name}' slugifies to empty string`);

  const existing = await driver.query<TopicRow>(
    `SELECT id, site_id, slug, name FROM topics WHERE site_id = $1 AND slug = $2`,
    [input.siteId, slug],
  );
  if (existing[0]) return fromRow(existing[0]);

  const inserted = await driver.query<TopicRow>(
    `INSERT INTO topics (site_id, slug, name) VALUES ($1, $2, $3)
     RETURNING id, site_id, slug, name`,
    [input.siteId, slug, input.name],
  );
  return fromRow(inserted[0]);
}

export async function findBySlug(
  driver: SqlDriver,
  args: { siteId: string; slug: string },
): Promise<Topic | null> {
  const rows = await driver.query<TopicRow>(
    `SELECT id, site_id, slug, name FROM topics WHERE site_id = $1 AND slug = $2`,
    [args.siteId, args.slug],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function findById(
  driver: SqlDriver,
  args: { siteId: string; id: string },
): Promise<Topic | null> {
  const rows = await driver.query<TopicRow>(
    `SELECT id, site_id, slug, name FROM topics WHERE site_id = $1 AND id = $2`,
    [args.siteId, args.id],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

/** All topics on a site, with published-post count. Topics that don't
 *  have any published posts are still returned (the editor's topic
 *  picker calls this and needs to show every topic ever created). */
export async function listForSite(
  driver: SqlDriver,
  args: { siteId: string },
): Promise<TopicWithCount[]> {
  const rows = await driver.query<TopicRow & { published_count: string | number }>(
    `SELECT t.id, t.site_id, t.slug, t.name,
            COALESCE(SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END), 0) AS published_count
     FROM topics t
     LEFT JOIN posts p ON p.topic_id = t.id AND p.site_id = t.site_id
     WHERE t.site_id = $1
     GROUP BY t.id, t.site_id, t.slug, t.name
     ORDER BY t.slug`,
    [args.siteId],
  );
  return rows.map((r) => ({
    ...fromRow(r),
    publishedCount: typeof r.published_count === 'string'
      ? parseInt(r.published_count, 10)
      : r.published_count,
  }));
}
