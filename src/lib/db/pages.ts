import type { SqlDriver } from './driver';

// Editable single-row-per-slug pages (about, contact, legal, etc).
// Distinct from `posts` because these have no date / tags / cover --
// they live at fixed URLs and the author edits the same row over time.
// The (site_id, slug) unique constraint makes upsert trivial.

export interface Page {
  id: string;
  siteId: string;
  slug: string;
  body: string;
  updatedAt: Date;
}

interface PageRow {
  id: string;
  site_id: string;
  slug: string;
  body: string;
  updated_at: string | Date;
}

function fromRow(r: PageRow): Page {
  return {
    id: r.id,
    siteId: r.site_id,
    slug: r.slug,
    body: r.body,
    updatedAt: new Date(r.updated_at as string | Date),
  };
}

const SELECT = `id, site_id, slug, body, updated_at`;

export async function findPage(
  driver: SqlDriver,
  args: { siteId: string; slug: string },
): Promise<Page | null> {
  const rows = await driver.query<PageRow>(
    `SELECT ${SELECT} FROM pages WHERE site_id = $1 AND slug = $2`,
    [args.siteId, args.slug],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export interface UpsertPageInput {
  siteId: string;
  slug: string;
  body: string;
}

/** Insert-or-update keyed by (site_id, slug). Always bumps updated_at
 *  on write so consumers can use it as a cache-buster / change-feed.
 *  Scoped by site -- tenants can't read or overwrite each other's
 *  pages even with a colliding slug. */
export async function upsertPage(
  driver: SqlDriver,
  input: UpsertPageInput,
): Promise<Page> {
  const rows = await driver.query<PageRow>(
    `INSERT INTO pages (site_id, slug, body)
     VALUES ($1, $2, $3)
     ON CONFLICT (site_id, slug) DO UPDATE SET
       body = EXCLUDED.body,
       updated_at = now()
     RETURNING ${SELECT}`,
    [input.siteId, input.slug, input.body],
  );
  return fromRow(rows[0]);
}
