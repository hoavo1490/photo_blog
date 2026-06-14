import type { SqlDriver } from './driver';
import { slugify } from '../slug';

// Per-site tag namespace. Slug is the canonical lookup key (lowercased,
// diacritic-stripped via slugify); name preserves display casing.
//
// setPostTags is the only atomic write path the editor calls -- it
// upserts the named tags and rewrites the post_tags rows for that post.
// We accept the (small) double-roundtrip cost over a CTE because it
// keeps the SQL portable between PGLite and Neon's HTTP driver.

export interface Tag {
  id: string;
  siteId: string;
  slug: string;
  name: string;
}

export interface TagWithCount extends Tag {
  publishedCount: number;
}

interface TagRow {
  id: string;
  site_id: string;
  slug: string;
  name: string;
}

function fromRow(r: TagRow): Tag {
  return { id: r.id, siteId: r.site_id, slug: r.slug, name: r.name };
}

export interface FindOrCreateInput {
  siteId: string;
  name: string;
}

export async function findOrCreate(driver: SqlDriver, input: FindOrCreateInput): Promise<Tag> {
  const slug = slugify(input.name);
  if (!slug) throw new Error(`tags.findOrCreate: name '${input.name}' slugifies to empty string`);

  const existing = await driver.query<TagRow>(
    `SELECT id, site_id, slug, name FROM tags WHERE site_id = $1 AND slug = $2`,
    [input.siteId, slug],
  );
  if (existing[0]) return fromRow(existing[0]);

  const inserted = await driver.query<TagRow>(
    `INSERT INTO tags (site_id, slug, name) VALUES ($1, $2, $3)
     RETURNING id, site_id, slug, name`,
    [input.siteId, slug, input.name],
  );
  return fromRow(inserted[0]);
}

export async function findBySlug(
  driver: SqlDriver,
  args: { siteId: string; slug: string },
): Promise<Tag | null> {
  const rows = await driver.query<TagRow>(
    `SELECT id, site_id, slug, name FROM tags WHERE site_id = $1 AND slug = $2`,
    [args.siteId, args.slug],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function listForPost(
  driver: SqlDriver,
  args: { siteId: string; postId: string },
): Promise<Tag[]> {
  const rows = await driver.query<TagRow>(
    `SELECT t.id, t.site_id, t.slug, t.name
     FROM tags t
     JOIN post_tags pt ON pt.tag_id = t.id
     JOIN posts p ON p.id = pt.post_id
     WHERE p.site_id = $1 AND pt.post_id = $2
     ORDER BY t.slug`,
    [args.siteId, args.postId],
  );
  return rows.map(fromRow);
}

export async function listForSite(
  driver: SqlDriver,
  args: { siteId: string },
): Promise<TagWithCount[]> {
  // Count only published posts so the cloud reflects what's actually visible.
  const rows = await driver.query<TagRow & { published_count: string | number }>(
    `SELECT t.id, t.site_id, t.slug, t.name,
            COALESCE(SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END), 0) AS published_count
     FROM tags t
     LEFT JOIN post_tags pt ON pt.tag_id = t.id
     LEFT JOIN posts p ON p.id = pt.post_id AND p.site_id = t.site_id
     WHERE t.site_id = $1
     GROUP BY t.id
     HAVING COALESCE(SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END), 0) > 0
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

export interface SetPostTagsInput {
  siteId: string;
  postId: string;
  tagNames: string[];
}

export async function setPostTags(driver: SqlDriver, input: SetPostTagsInput): Promise<void> {
  // Verify the post belongs to this site before we touch its tags.
  const owner = await driver.query<{ site_id: string }>(
    `SELECT site_id FROM posts WHERE id = $1`,
    [input.postId],
  );
  if (!owner[0] || owner[0].site_id !== input.siteId) {
    throw new Error(`setPostTags: post ${input.postId} does not belong to site ${input.siteId}`);
  }

  // Upsert each tag and collect ids.
  const tagIds: string[] = [];
  for (const name of input.tagNames) {
    const t = await findOrCreate(driver, { siteId: input.siteId, name });
    tagIds.push(t.id);
  }

  // Replace the join rows. Simplest correct approach: delete all then insert.
  await driver.exec(`DELETE FROM post_tags WHERE post_id = $1`, [input.postId]);
  for (const tagId of tagIds) {
    await driver.exec(
      `INSERT INTO post_tags (post_id, tag_id) VALUES ($1, $2)`,
      [input.postId, tagId],
    );
  }
}
